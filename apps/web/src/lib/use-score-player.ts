"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteColumn } from "./types";
import { buildSchedule } from "./player";
import { CONCERT_PITCH_DEFAULT } from "./concert-pitch";
import { DEFAULT_TUNING, type TuningId } from "./tuning";
import { scheduleClick, schedulePluck, TONE_PROFILE } from "./audio-synth";

/**
 * 拨弦合成逻辑（Karplus-Strong）已抽到 ./audio-synth，
 * 播放与音频导出共用，保证两者音色一致。
 */

/**
 * 按句慢练的参数。不给它 = 原来的「从某音播到曲末」。
 *
 * `endIndex` 含两端；`tempo` 是相对当前 BPM 的倍率（0.6 就是慢下来六成）。
 * 练琴时真正需要的不是「整首放慢」——那会把已经会的地方也拖一遍——
 * 而是「这一句、慢一点、连着来几遍」，所以区间、速度、遍数三件事都要能单独给。
 */
export interface PracticeRange {
  /** 结束音下标（含）。 */
  endIndex: number;
  /** 连弹几遍。 */
  repeat: number;
  /** 相对当前 BPM 的倍率，0.6 = 六成速。 */
  tempo: number;
}

/**
 * 慢练起步前空几拍。
 *
 * 两拍，不是一拍：**一拍听不出速度**——单独一声你分不清它是「这一拍」还是
 * 一声无关的响动，手就不知道该往哪儿放。第二拍一落，节奏才立起来。
 * 之前点下去就响，第一遍永远是慌慌张张追上去的，练的其实是「反应」不是「指法」。
 */
export const PRACTICE_COUNT_IN_BEATS = 2;

/**
 * 乐谱流播放：把整首排程一次性交给 AudioContext，stop 时全部断开。
 * 休止符与无简谱标注的音静默但占位时值。
 *
 * @param bpm 速度（拍/分钟），默认 120；调速后下次播放生效。
 * @param concertPitch A4 频率（默认 440）；古琴整床偏低时用它对齐。
 * @param tuning 定弦：决定空弦音，从而决定「散/按/泛」谱字的真实音高。
 * @param onPracticeEnd 慢练**完整走完**最后一遍时回调一次。
 *   手动按停止、中途换谱都不算——「练完了」和「我走了」是两件事，
 *   差一个字就会让「这一句已过原速」变成一句谎话。
 */
export function useScorePlayer(
  notes: NoteColumn[],
  bpm: number = 120,
  concertPitch: number = CONCERT_PITCH_DEFAULT,
  tuning: TuningId = DEFAULT_TUNING,
  onPracticeEnd?: () => void,
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  /** 慢练时进行到第几遍（1 起）；平时为 null。 */
  const [practicePass, setPracticePass] = useState<number | null>(null);
  /** 同步追踪播放态，供 play 做重入 guard（不依赖 isPlaying 闭包，便于跳转重启） */
  const playingRef = useRef(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 回调放 ref：放依赖里会让 play 每次渲染都换身份，播放中改一个字就重排整首
  const onPracticeEndRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    onPracticeEndRef.current = onPracticeEnd;
  }, [onPracticeEnd]);

  const stop = useCallback(() => {
    for (const src of sourcesRef.current) {
      try {
        src.stop();
      } catch {
        // 已结束的 source 重复 stop 会抛错，忽略
      }
    }
    sourcesRef.current = [];
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    for (const t of indexTimersRef.current) clearTimeout(t);
    indexTimersRef.current = [];
    playingRef.current = false;
    setIsPlaying(false);
    setPlayingIndex(null);
    setPracticePass(null);
  }, []);

  /**
   * 从 startIndex 起播（默认 0）。用于点击歌词跳转：先 stop 再 play(index)。
   * 用 playingRef 同步 guard 而非 isPlaying 闭包，使「停止后立即重启动」同 tick 内可行。
   *
   * 给 `practice` 时先空两拍预备，再只播这一段、按倍率放慢、连播 `repeat` 遍，
   * 每遍之间空一拍。换气那一拍不是装饰：慢练时手要落在下一遍的第一个音上，
   * 中间没有间隔的话第二遍永远是「抢」出来的，练完回到原速还是那个毛病。
   */
  const play = useCallback(
    async (startIndex: number = 0, practice?: PracticeRange) => {
      if (playingRef.current || notes.length === 0) return;
      if (startIndex < 0 || startIndex >= notes.length) return;
      const endIndex = practice?.endIndex ?? notes.length - 1;
      // 区间越界一律不播：宁可什么都不发生，也不要播到别的句去
      if (endIndex < startIndex || endIndex >= notes.length) return;

      ctxRef.current ??= new AudioContext();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const tempo = practice && practice.tempo > 0 ? practice.tempo : 1;
      const repeat = practice ? Math.max(1, Math.floor(practice.repeat)) : 1;
      const beatMs = 60000 / (bpm * tempo);
      const beatSeconds = beatMs / 1000;
      const schedule = buildSchedule(notes, beatMs, concertPitch, tuning);
      // 起始音符的时间基准，用作整体左移偏移
      const offset = schedule[startIndex]?.start ?? 0;
      const t0 = ctx.currentTime + 0.05;

      // 预备拍只在慢练时有：整首播放是「我要听这首」，慢练是「我要跟上这一段」，
      // 前者不需要起手时间，后者没有起手时间就必然抢拍。
      const countInBeats = practice ? PRACTICE_COUNT_IN_BEATS : 0;
      const countInSeconds = countInBeats * beatSeconds;
      /** 第一个音真正出现的时刻（预备拍之后）。 */
      const entry = t0 + countInSeconds;

      // 一遍的长度：末音的起点 + 时值（相对起点），再按倍率留一拍换气。
      // 用「末音之前都不算换气」而不是累加所有时值，是为了让休止符照旧占位。
      const last = schedule[endIndex];
      const spanSeconds = last ? last.start + last.duration - offset : 0;
      const gapSeconds = practice ? beatSeconds : 0;
      const passSeconds = spanSeconds + gapSeconds;

      // 排程：有声音符才发声，每一遍整体挪 passSeconds。
      // 只取区间内的音，区间外的一律不排（否则慢练时会听见下一句漏进来）。
      const inRange = schedule
        .map((s, i) => ({ s, i }))
        .filter(({ i }) => i >= startIndex && i <= endIndex);

      sourcesRef.current = [];
      // 预备拍：最后一拍重音，它正好是「落手」的那一拍
      for (let b = 0; b < countInBeats; b++) {
        sourcesRef.current.push(
          scheduleClick(ctx, t0 + b * beatSeconds, b === countInBeats - 1),
        );
      }
      for (let pass = 0; pass < repeat; pass++) {
        for (const { s } of inRange) {
          if (s.freq === null) continue;
          sourcesRef.current.push(
            schedulePluck(
              ctx,
              s.freq,
              entry + pass * passSeconds + (s.start - offset),
              s.duration,
              s.toneType,
              s.slide,
            ),
          );
        }
      }

      playingRef.current = true;
      setIsPlaying(true);
      setPracticePass(practice ? 1 : null);
      indexTimersRef.current = [];
      for (let pass = 0; pass < repeat; pass++) {
        if (practice && repeat > 1) {
          indexTimersRef.current.push(
            setTimeout(
              () => setPracticePass(pass + 1),
              (countInSeconds + pass * passSeconds + 0.05) * 1000,
            ),
          );
        }
        for (const { s, i } of inRange) {
          indexTimersRef.current.push(
            setTimeout(
              () => setPlayingIndex(i),
              (countInSeconds + pass * passSeconds + (s.start - offset) + 0.05) * 1000,
            ),
          );
        }
      }

      const tailOf = (toneType: NoteColumn["jianzi"]["toneType"]) =>
        toneType ? TONE_PROFILE[toneType].tail : TONE_PROFILE["按"].tail;
      // 一遍什么时候真的消失：取区间内最晚结束的那个音（含余音），
      // 而不是只看末音——末音短、前面那个音余音长时，只看末音会把余音掐掉。
      const passEnd = inRange.reduce(
        (end, { s }) => Math.max(end, s.start - offset + s.duration + tailOf(s.toneType)),
        0,
      );
      const remaining = countInSeconds + (repeat - 1) * passSeconds + passEnd;
      timerRef.current = setTimeout(() => {
        stop();
        // 只有真的走完才报「练完」：这个回调会被写成「已过原速」，
        // 手动停、换谱、被卸载都不该经过这里。
        if (practice) onPracticeEndRef.current?.();
      }, Math.max(0, remaining) * 1000 + 100);
    },
    [notes, stop, bpm, concertPitch, tuning],
  );

  // 乐谱变更时自动停止播放，防止旧音频继续发声
  useEffect(() => {
    if (isPlaying) {
      // 此处同步调用 stop()（其内部 setIsPlaying/setPlayingIndex 属 setState），
      // 会触发 react-hooks/set-state-in-effect 告警。但该 effect 由 notes 变更触发、
      // 且以 isPlaying 守卫，不会循环触发级联渲染，属于「外部系统(AudioContext)
      // 与 React 状态同步」的合法用法，故定向豁免而非改写语义。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // 卸载时停止播放并释放 AudioContext
  useEffect(() => {
    return () => {
      stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [stop]);

  return { play, stop, isPlaying, playingIndex, practicePass };
}
