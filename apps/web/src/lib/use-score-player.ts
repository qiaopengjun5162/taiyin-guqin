"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteColumn, NoteType } from "./types";
import { buildSchedule } from "./player";

/**
 * Karplus-Strong 拨弦合成：噪声脉冲经带阻尼低通的反馈延迟线，
 * 音色接近拨弦而非电子音，适合古琴旋律参考。
 */

/** 古琴三种基本音技法的合成参数。 */
const TONE_PROFILE: Record<NoteType, { damping: number; tail: number }> = {
  // 散音（空弦）：浑厚、余音长
  "散": { damping: 0.9975, tail: 2.0 },
  // 按音（按弦走手）：中等余音
  "按": { damping: 0.996, tail: 0.5 },
  // 泛音（徽位）：清亮、短促
  "泛": { damping: 0.99, tail: 0.05 },
};

/**
 * 单音拨弦合成。缓冲长度 = 该音符时值（最短 0.2s 保证可闻）+ 音色尾长，
 * 主体衰减交给 Karplus-Strong 阻尼（散音长、泛音短），缓冲播完即自动停止。
 * 包络只做起音渐入 + 尾部淡出（防爆音），让音色差异由阻尼体现。
 */
function schedulePluck(
  ctx: AudioContext,
  freq: number,
  time: number,
  durationSec: number,
  toneType: NoteType | null,
): AudioBufferSourceNode {
  const sr = ctx.sampleRate;
  const period = Math.max(2, Math.round(sr / freq));
  const profile = toneType ? TONE_PROFILE[toneType] : TONE_PROFILE["按"];
  const length = Math.floor(sr * (Math.max(durationSec, 0.2) + profile.tail));
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;

  let idx = 0;
  for (let i = 0; i < length; i++) {
    const current = ring[idx];
    ring[idx] = 0.5 * (current + ring[(idx + 1) % period]) * profile.damping;
    const t = i / length;
    // 起音 10ms 渐入 + 尾部 30ms 淡出（防爆音），中间保持 1，衰减交给 KS 阻尼
    const fadeIn = t < 0.01 ? t / 0.01 : 1;
    const fadeOut = t > 1 - 0.03 ? Math.max(0, (1 - t) / 0.03) : 1;
    data[i] = current * fadeIn * fadeOut;
    idx = (idx + 1) % period;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(time); // 缓冲播完自动停止，无需 src.stop()，不污染 stop() 的契约
  return src;
}

/**
 * 乐谱流播放：把整首排程一次性交给 AudioContext，stop 时全部断开。
 * 休止符与无简谱标注的音静默但占位时值。
 *
 * @param bpm 速度（拍/分钟），默认 120；调速后下次播放生效。
 */
export function useScorePlayer(notes: NoteColumn[], bpm: number = 120) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
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
    setIsPlaying(false);
    setPlayingIndex(null);
  }, []);

  const play = useCallback(async () => {
    if (isPlaying || notes.length === 0) return;

    ctxRef.current ??= new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const beatMs = 60000 / bpm;
    const schedule = buildSchedule(notes, beatMs);
    const t0 = ctx.currentTime + 0.05;
    sourcesRef.current = schedule
      .filter((s) => s.freq !== null)
      .map((s) => schedulePluck(ctx, s.freq as number, t0 + s.start, s.duration, s.toneType));

    setIsPlaying(true);
    // 逐音高亮：与音频同一起点 t0 的墙上时钟偏移
    indexTimersRef.current = schedule.map((s, i) =>
      setTimeout(() => setPlayingIndex(i), (s.start + 0.05) * 1000),
    );
    const total = schedule.reduce(
      (end, s) =>
        Math.max(end, s.start + s.duration + (s.toneType ? TONE_PROFILE[s.toneType].tail : TONE_PROFILE["按"].tail)),
      0,
    );
    timerRef.current = setTimeout(stop, total * 1000 + 100);
  }, [isPlaying, notes, stop, bpm]);

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
