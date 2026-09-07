"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteColumn } from "./types";
import { buildSchedule } from "./player";
import { schedulePluck, TONE_PROFILE } from "./audio-synth";

/**
 * 拨弦合成逻辑（Karplus-Strong）已抽到 ./audio-synth，
 * 播放与音频导出共用，保证两者音色一致。
 */

/**
 * 乐谱流播放：把整首排程一次性交给 AudioContext，stop 时全部断开。
 * 休止符与无简谱标注的音静默但占位时值。
 *
 * @param bpm 速度（拍/分钟），默认 120；调速后下次播放生效。
 */
export function useScorePlayer(notes: NoteColumn[], bpm: number = 120) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  /** 同步追踪播放态，供 play 做重入 guard（不依赖 isPlaying 闭包，便于跳转重启） */
  const playingRef = useRef(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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
  }, []);

  /**
   * 从 startIndex 起播（默认 0）。用于点击歌词跳转：先 stop 再 play(index)。
   * 用 playingRef 同步 guard 而非 isPlaying 闭包，使「停止后立即重启动」同 tick 内可行。
   */
  const play = useCallback(async (startIndex: number = 0) => {
    if (playingRef.current || notes.length === 0) return;
    if (startIndex < 0 || startIndex >= notes.length) return;

    ctxRef.current ??= new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const beatMs = 60000 / bpm;
    const schedule = buildSchedule(notes, beatMs);
    // 起始音符的时间基准，用作整体左移偏移
    const offset = schedule[startIndex]?.start ?? 0;
    const t0 = ctx.currentTime + 0.05;

    // 只排程 startIndex 及之后的有声音符，并保留原始索引用于高亮
    sourcesRef.current = schedule
      .map((s, i) => ({ s, i }))
      .filter(({ i, s }) => i >= startIndex && s.freq !== null)
      .map(({ s }) =>
        schedulePluck(ctx, s.freq as number, t0 + (s.start - offset), s.duration, s.toneType),
      );

    playingRef.current = true;
    setIsPlaying(true);
    // 逐音高亮：跳过 startIndex 之前，并把时间基准整体左移 offset
    indexTimersRef.current = schedule
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => i >= startIndex)
      .map(({ s, i }) =>
        setTimeout(() => setPlayingIndex(i), (s.start - offset + 0.05) * 1000),
      );
    const total = schedule.reduce(
      (end, s) =>
        Math.max(end, s.start + s.duration + (s.toneType ? TONE_PROFILE[s.toneType].tail : TONE_PROFILE["按"].tail)),
      0,
    );
    const remaining = Math.max(0, total - offset);
    timerRef.current = setTimeout(stop, remaining * 1000 + 100);
  }, [notes, stop, bpm]);

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

  return { play, stop, isPlaying, playingIndex };
}
