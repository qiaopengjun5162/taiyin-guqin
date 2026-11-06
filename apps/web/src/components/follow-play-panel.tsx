"use client";

/**
 * 跟弹判定 —— 你自己弹，我们听。
 *
 * ## 这一条和「慢练」的区别
 *
 * 慢练是**放给你听**，你跟着在心里过；这里是把播放器关掉，只留预备拍与谱面高亮，
 * 由麦克风听你弹得准不准。所以「跟着弹」这件事第一次有了反馈：
 * 不是「我弹完了」，而是「我弹对了几个」。
 *
 * ## 为什么一定要关掉参考音
 *
 * 只要扬声器在放谱子，麦克风就会把它收进去，判定结果必然是满分——
 * 那是自己给自己打分。所以这个面板从不调用播放器，只有预备拍的咔哒声，
 * 并且开始前会主动把正在跑的播放/节拍器停掉。
 *
 * 代价是：没听过的谱子弹不出来。这是对的——判定属于「练」，不属于「听」。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteColumn } from "@/lib/types";
import { buildSchedule } from "@/lib/player";
import { scheduleClick } from "@/lib/audio-synth";
import { detectPitch } from "@/lib/pitch-detect";
import {
  expectedFromSchedule,
  judgeTake,
  segmentNotes,
  type JudgeResult,
  type PitchSample,
} from "@/lib/play-along";
import { PRACTICE_COUNT_IN_BEATS } from "@/lib/use-score-player";
import type { ScorePhrase } from "@/lib/score-phrases";
import type { TuningId } from "@/lib/tuning";

/** 采样节奏与调音器一致：80ms 一次。再快只是让读数抖，人耳也跟不上。 */
const SAMPLE_INTERVAL_MS = 80;
/** 最后一个音之后再多听一会儿，把余音收进来（散音能响三五秒）。 */
const TAIL_SECONDS = 0.6;

type Phase = "idle" | "arming" | "countin" | "listening" | "result";

export function FollowPlayPanel({
  notes,
  phrase,
  bpm,
  tempo,
  concertPitch,
  tuning,
  onBeforeStart,
  onPass,
  onLog,
  onHighlight,
}: {
  notes: NoteColumn[];
  /** 要判的那一句；没选句时为 undefined（面板整体不出现）。 */
  phrase: ScorePhrase | undefined;
  bpm: number;
  /** 倍率，跟慢练同一个档位。 */
  tempo: number;
  concertPitch: number;
  tuning: TuningId;
  /** 开始前先停掉播放与节拍器——不停就会录进参考音。 */
  onBeforeStart?: () => void;
  /** 这一遍过了：交给页面记档（该句该档位）。 */
  onPass?: (tempo: number) => void;
  /** 记一笔练琴：秒数。 */
  onLog?: (seconds: number) => void;
  /** 谱面高亮当前该弹的音（与播放共用同一条高亮）。 */
  onHighlight?: (index: number | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [logged, setLogged] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const samplesRef = useRef<PitchSample[]>([]);
  const expectedRef = useRef<ReturnType<typeof expectedFromSchedule>>([]);
  const entryWallRef = useRef(0);
  const lastSampleRef = useRef(0);
  /** 这一遍的谱面长度（秒），记一笔练习时用。 */
  const spanRef = useRef(0);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  // 卸载时必须关麦克风，否则浏览器的录音指示灯一直亮着
  useEffect(() => cleanup, [cleanup]);

  const finish = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    onHighlight?.(null);
    const detected = segmentNotes(samplesRef.current);
    setResult(judgeTake(expectedRef.current, detected));
    setPhase("result");
    setLevel(0);
  }, [onHighlight]);

  const start = useCallback(async () => {
    if (!phrase) return;
    setError(null);
    setResult(null);
    setLogged(false);
    setPhase("arming");

    // 先把会出声的东西都停掉：留在后台播放的谱子会被麦克风当成"你弹的"
    onBeforeStart?.();

    // 先算「这一句能不能判」再谈权限：一句没有简谱的音，弹得再好也判不出来，
    // 这时候去弹一个麦克风授权框是白白吓人一跳。
    const beatMs = 60000 / (bpm * tempo);
    const beatSeconds = beatMs / 1000;
    const schedule = buildSchedule(notes, beatMs, concertPitch, tuning);
    const expected = expectedFromSchedule(schedule, phrase.start, phrase.end);
    if (expected.length === 0) {
      setError("这一句没有标简谱的音，没法判定。先补上音高再来。");
      setPhase("idle");
      return;
    }
    expectedRef.current = expected;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("这个浏览器不支持麦克风采集，或页面不在 https / localhost 下。");
      setPhase("idle");
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      setError("这个浏览器不支持 Web Audio，没法分析音高。");
      setPhase("idle");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 这三项是为语音通话设计的：降噪吃掉衰减尾音、自动增益让强弱全平，
          // 音高读数会跟着飘，判定就没意义了。
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "麦克风权限被拒绝。请在地址栏的权限里允许本站使用麦克风后重试。"
          : name === "NotFoundError"
            ? "没有找到麦克风设备。"
            : "打不开麦克风，检查一下系统权限或换个浏览器。",
      );
      setPhase("idle");
      return;
    }

    const ctx = new Ctor();
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);

    ctxRef.current = ctx;
    streamRef.current = stream;
    samplesRef.current = [];
    lastSampleRef.current = 0;

    // 预备拍与第一个音的时间都挂在 AudioContext 的时钟上，再用墙钟换算成
    // 采样时刻——两个时钟各管一段，不混着算。
    const entry = ctx.currentTime + 0.1 + PRACTICE_COUNT_IN_BEATS * beatSeconds;
    entryWallRef.current = performance.now() + (entry - ctx.currentTime) * 1000;

    for (let b = 0; b < PRACTICE_COUNT_IN_BEATS; b++) {
      // 最后一拍重音，它正好是「落手」的那一拍
      scheduleClick(ctx, entry - (PRACTICE_COUNT_IN_BEATS - b) * beatSeconds, b === PRACTICE_COUNT_IN_BEATS - 1);
    }

    setPhase("countin");
    const buf = new Float32Array(analyser.fftSize);
    const loop = () => {
      if (!ctxRef.current) return;
      rafRef.current = requestAnimationFrame(loop);
      const now = performance.now();
      const t = (now - entryWallRef.current) / 1000;
      if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
      lastSampleRef.current = now;

      analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
      const reading = detectPitch(buf, ctx.sampleRate, { minFreq: 55, maxFreq: 1200 });
      samplesRef.current.push({
        t,
        freq: reading.freq,
        clarity: reading.clarity,
        rms: reading.rms,
      });
      // ×6 只是让电平条看得见，不是声压级
      setLevel(Math.min(1, reading.rms * 6));
      // 用函数式更新而不是读闭包里的 phase：那个值是 start() 那一刻的，
      // 永远是 arming，会在每 80ms 重复 setState 一次
      if (t >= 0) setPhase((p) => (p === "listening" ? p : "listening"));
    };
    rafRef.current = requestAnimationFrame(loop);

    // 谱面高亮：从第一个音开始逐个点亮，让手知道现在该弹哪个
    const msToEntry = (entry - ctx.currentTime) * 1000;
    for (const note of expected) {
      timersRef.current.push(
        setTimeout(() => onHighlight?.(note.index), msToEntry + note.start * 1000),
      );
    }

    const spanEnd = expected.reduce((end, n) => Math.max(end, n.start + n.duration), 0);
    spanRef.current = spanEnd;
    timersRef.current.push(
      setTimeout(() => finish(), msToEntry + (spanEnd + TAIL_SECONDS) * 1000),
    );
  }, [phrase, notes, bpm, tempo, concertPitch, tuning, onBeforeStart, onHighlight, finish]);

  const stop = useCallback(() => {
    cleanup();
    onHighlight?.(null);
    setPhase("idle");
    setLevel(0);
    setResult(null);
  }, [cleanup, onHighlight]);

  if (!phrase) return null;

  const running = phase === "arming" || phase === "countin" || phase === "listening";

  return (
    // col-span-full：演奏控制台是两列栅格，判定结果挤在一列里会把
    // 「第 10、11、12 音按错位置」折成好几行，读不下去
    <div className="no-print col-span-full mt-2 w-full flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] tracking-wider text-amber-600/50">跟弹</span>
        {!running && (
          <button
            onClick={() => void start()}
            aria-label={`跟弹判定第 ${(phrase.start ?? 0) + 1} 音起这一句`}
            className="min-h-[44px] px-2.5 rounded border border-amber-600/50 bg-amber-800/20 text-[10px] tracking-wider text-amber-100 hover:bg-amber-800/35 transition-all"
          >
            {result ? "再听一遍" : "听我弹"}
          </button>
        )}
        {running && (
          <button
            onClick={stop}
            aria-label="停止跟弹判定"
            className="min-h-[44px] px-2.5 rounded border border-rose-700/40 text-[10px] tracking-wider text-rose-200/80 hover:bg-rose-900/20 transition-all"
          >
            停
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-[10px] tracking-wider text-amber-600/50">
          {phase === "arming" && "等麦克风…"}
          {phase === "countin" && "预备拍——最后一响就落手"}
          {phase === "listening" && `正在听 · ${tempo}×`}
          {phase === "idle" && !result && "不放参考音，只听你弹"}
          {phase === "result" && "这一遍听完了"}
        </span>
        {running && (
          <span
            aria-label="麦克风电平"
            className="h-1.5 w-16 overflow-hidden rounded-full bg-amber-900/40"
          >
            <span
              className="block h-full rounded-full bg-[var(--verdigris)] transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[10px] leading-relaxed text-rose-300/80">
          {error}
        </p>
      )}

      {phase === "result" && result && (
        <div
          data-testid="judge-result"
          className={`rounded border p-2 ${
            result.passed
              ? "border-emerald-700/40 bg-emerald-900/15"
              : "border-amber-700/30 bg-amber-900/10"
          }`}
        >
          <p className="text-[11px] leading-relaxed tracking-wider text-stone-200">
            {result.summary}
          </p>

          {result.notes.some((n) => n.verdict !== "ok" && n.verdict !== "missed") && (
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {result.notes
                .filter((n) => n.verdict !== "ok" && n.verdict !== "missed")
                .slice(0, 8)
                .map((n) => (
                  <li
                    key={n.expected.index}
                    className="text-[10px] tabular-nums tracking-wider text-stone-400"
                  >
                    第 {n.expected.index + 1} 音
                    <span className="ml-1 text-rose-300/80">
                      {n.verdict === "wrong"
                        ? "按错位置"
                        : `${(n.cents ?? 0) > 0 ? "+" : ""}${Math.round(n.cents ?? 0)} 音分`}
                    </span>
                  </li>
                ))}
            </ul>
          )}

          <div className="mt-2 flex items-center gap-2">
            {result.passed && !logged && (
              <button
                onClick={() => {
                  onPass?.(tempo);
                  onLog?.(spanRef.current);
                  setLogged(true);
                }}
                className="min-h-[44px] px-2.5 rounded border border-emerald-700/50 bg-emerald-900/25 text-[10px] tracking-wider text-emerald-100 hover:bg-emerald-900/40 transition-all"
              >
                记下这一遍
              </button>
            )}
            {logged && (
              <span className="text-[10px] tracking-wider text-emerald-300/70">
                已记下 · 这一句到 {tempo}×
              </span>
            )}
            <button
              onClick={() => void start()}
              className="min-h-[44px] px-2.5 rounded border border-amber-700/30 text-[10px] tracking-wider text-stone-400 hover:text-stone-200 hover:border-amber-600/50 transition-all"
            >
              再来一遍
            </button>
          </div>
        </div>
      )}

      <p className="text-[9px] leading-relaxed tracking-wider text-stone-500/70">
        只判音准，不判快慢：古琴本来就有散板与伸缩，拿拍子卡分只会让人为了分数弹得机械。
        整体偏晚会在结果里说一句，但不扣分。
      </p>
    </div>
  );
}
