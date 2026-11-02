"use client";

/**
 * 调音 · 定弦面板。
 *
 * 两件事合成一个面板，因为它们是同一件事的两头：
 * - 定弦：告诉页面「这床琴七根弦各是什么音」，减字反推音高、试听、导出都靠它；
 * - 调音：用麦克风测当前音高，跟目标比，指到「准」为止。
 *
 * 全程本地：音频只进 AnalyserNode 算基频，不上传、不录音、不留存。
 * 麦克风需要安全上下文（https 或 localhost），非安全环境会明确提示而不是静默失败。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  TUNINGS,
  getTuning,
  getServerTuning,
  setTuning,
  subscribeTuning,
  nearestString,
  type TuningId,
} from "@/lib/tuning";
import {
  getConcertPitch,
  getServerConcertPitch,
  subscribeConcertPitch,
} from "@/lib/concert-pitch";
import { detectPitch } from "@/lib/pitch-detect";

/** 判定「准」的音分容差。人耳对五度相生的偏差更敏感，5 音分是常见调音器阈值。 */
const IN_TUNE_CENTS = 5;
/** 显示范围 ±50 音分（半音的一半），超出只贴边显示。 */
const RANGE_CENTS = 50;

interface Reading {
  freq: number;
  clarity: number;
}

export function TunerPanel() {
  const tuning = useSyncExternalStore(subscribeTuning, getTuning, getServerTuning);
  const concertPitch = useSyncExternalStore(
    subscribeConcertPitch,
    getConcertPitch,
    getServerConcertPitch,
  );

  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const bufRef = useRef<Float32Array | null>(null);
  const historyRef = useRef<number[]>([]);
  const lastRunRef = useRef(0);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    bufRef.current = null;
    historyRef.current = [];
    lastRunRef.current = 0;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setReading(null);
    setListening(false);
  }, []);

  // 组件卸载/切页时务必关掉麦克风，否则浏览器的录音指示灯一直亮着
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("这个浏览器不支持麦克风采集，或页面不在 https / localhost 下。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 这三项开着会把音高「修」掉：降噪把衰减尾音吃掉、自动增益让读数忽大忽小
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        stream.getTracks().forEach((t) => t.stop());
        setError("这个浏览器不支持 Web Audio，无法分析音高。");
        return;
      }
      const ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);

      ctxRef.current = ctx;
      streamRef.current = stream;
      analyserRef.current = analyser;
      bufRef.current = new Float32Array(analyser.fftSize);
      historyRef.current = [];
      setListening(true);

      const loop = () => {
        const el = analyserRef.current;
        const frame = bufRef.current;
        if (!el || !frame) return;
        rafRef.current = requestAnimationFrame(loop);

        // 每 80ms 算一次就够：再快只是让读数抖，人眼睛也跟不上
        const t = performance.now();
        if (t - lastRunRef.current < 80) return;
        lastRunRef.current = t;

        el.getFloatTimeDomainData(frame as Float32Array<ArrayBuffer>);
        const result = detectPitch(frame, el.context.sampleRate, {
          minFreq: 55,
          maxFreq: 1200,
        });
        if (!result.freq) {
          // 拨弦后自然衰减，读数保留几帧再清，避免闪烁
          if (historyRef.current.length > 0) historyRef.current.shift();
          if (historyRef.current.length === 0) setReading(null);
          return;
        }

        // 取中位数：单帧误检（换把、手指摩擦）不该让指针跳一下
        const hist = historyRef.current;
        hist.push(result.freq);
        if (hist.length > 5) hist.shift();
        const sorted = [...hist].sort((a, b) => a - b);
        setReading({ freq: sorted[Math.floor(sorted.length / 2)], clarity: result.clarity });
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      // DOMException 在部分环境（含测试 mock）不是同一个构造器，按 Error 取 name 更稳
      const name = e instanceof Error ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "麦克风权限被拒绝。请在浏览器地址栏的权限里允许本站使用麦克风后重试。"
          : name === "NotFoundError"
            ? "没有找到麦克风设备。"
            : "打不开麦克风，请检查系统权限或换个浏览器。",
      );
      setListening(false);
    }
  }, []);

  const match = reading ? nearestString(reading.freq, tuning, concertPitch) : null;
  const cents = match ? match.cents : null;
  const inTune = cents !== null && Math.abs(cents) < IN_TUNE_CENTS;
  const current = tuning === undefined ? TUNINGS[0] : TUNINGS.find((t) => t.id === tuning)!;
  const needle = cents === null ? 0 : Math.max(-RANGE_CENTS, Math.min(RANGE_CENTS, cents));

  return (
    <div className="flex flex-col gap-3">
      {/* 定弦 */}
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="tuning-select"
          className="text-[10px] tracking-wider text-amber-800/80 whitespace-nowrap"
        >
          定弦
        </label>
        <select
          id="tuning-select"
          value={tuning}
          onChange={(e) => setTuning(e.target.value as TuningId)}
          aria-label="定弦（调式）"
          className="min-h-[44px] rounded border border-amber-700/25 bg-transparent px-2 py-1 text-[11px] tracking-wider text-stone-700 outline-none focus:border-amber-600/60"
        >
          {TUNINGS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}（{t.alias}）
            </option>
          ))}
        </select>
      </div>
      <p className="text-[10px] leading-relaxed tracking-wider text-stone-600">{current.hint}</p>

      {/* 七弦目标音 */}
      <div className="grid grid-cols-7 gap-1" data-testid="tuner-strings">
        {current.noteNames.map((name, i) => {
          const active = match?.index === i;
          return (
            <div
              key={name}
              className={`flex flex-col items-center rounded border px-0.5 py-1 transition-colors ${
                active
                  ? "border-[var(--vermillion)]/50 bg-[var(--vermillion)]/10"
                  : "border-stone-300/70 bg-white/35"
              }`}
            >
              <span className="text-[9px] tracking-wider text-stone-500">
                {"一二三四五六七"[i]}
              </span>
              <span className="text-[11px] font-semibold tracking-wide text-stone-800">{name}</span>
            </div>
          );
        })}
      </div>

      {/* 麦克风控制 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={listening ? stop : start}
          aria-label={listening ? "停止调音" : "开始调音"}
          className="min-h-[44px] rounded border border-amber-700/30 px-3 py-1.5 text-[10px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60 hover:text-amber-900"
        >
          {listening ? "停止调音" : "开始调音（用麦克风）"}
        </button>
        <span className="text-[10px] tracking-wider text-stone-500">
          只在本机分析，不录音、不上传
        </span>
      </div>

      {error && (
        <p className="rounded border border-[var(--vermillion)]/30 bg-[var(--vermillion)]/10 px-2 py-1.5 text-[10px] leading-relaxed tracking-wider text-stone-700">
          {error}
        </p>
      )}

      {/* 实时读数 */}
      {listening && (
        <div className="rounded border border-stone-300/70 bg-white/35 p-3" data-testid="tuner-readout">
          {reading && match ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-lg text-stone-800">{reading.freq.toFixed(1)} Hz</span>
                <span className="text-[11px] tracking-wider text-stone-600">
                  目标 {match.stringNumber}弦 {current.noteNames[match.index]} ·{" "}
                  {match.target.toFixed(1)} Hz
                </span>
              </div>

              {/* 偏差刻度：-50…+50 音分，中间为「准」 */}
              <div className="relative mt-2 h-9" aria-hidden>
                <div className="absolute inset-x-0 top-4 h-px bg-stone-300" />
                {/* 「准」的容差带：±5 音分，指针进绿带即合格 */}
                <div
                  className="absolute top-3 h-3 bg-emerald-600/15"
                  style={{
                    left: `${((-IN_TUNE_CENTS + RANGE_CENTS) / (RANGE_CENTS * 2)) * 100}%`,
                    width: `${((IN_TUNE_CENTS * 2) / (RANGE_CENTS * 2)) * 100}%`,
                  }}
                />
                {[-50, -25, 0, 25, 50].map((c) => (
                  <div
                    key={c}
                    className={`absolute top-2 h-2 w-px ${c === 0 ? "bg-stone-500" : "bg-stone-300"}`}
                    style={{ left: `${((c + RANGE_CENTS) / (RANGE_CENTS * 2)) * 100}%` }}
                  />
                ))}
                <div
                  className={`absolute top-0 h-3.5 w-0.5 -translate-x-1/2 transition-[left] duration-150 ${
                    inTune ? "bg-emerald-600" : "bg-[var(--vermillion)]"
                  }`}
                  style={{ left: `${((needle + RANGE_CENTS) / (RANGE_CENTS * 2)) * 100}%` }}
                />
                <span className="absolute left-0 top-5 text-[9px] text-stone-400">偏低</span>
                <span className="absolute right-0 top-5 text-[9px] text-stone-400">偏高</span>
              </div>

              <p
                className={`mt-1 text-[11px] tracking-wider ${
                  inTune ? "text-emerald-700" : "text-stone-700"
                }`}
                data-testid="tuner-status"
              >
                {inTune
                  ? `准了（${cents! > 0 ? "+" : ""}${cents!.toFixed(0)} 音分）`
                  : cents! < 0
                    ? `偏低 ${Math.abs(cents!).toFixed(0)} 音分 · 顺时针拧紧${match.stringNumber}弦`
                    : `偏高 ${cents!.toFixed(0)} 音分 · 逆时针放松${match.stringNumber}弦`}
              </p>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed tracking-wider text-stone-600">
              拨一下要调的那根弦（弹散音、别按弦），保持环境安静。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
