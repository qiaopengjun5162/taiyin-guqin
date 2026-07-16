"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteColumn } from "./types";
import { buildSchedule } from "./player";

/** 默认一拍（四分音符）时长：500ms ≈ 120 BPM。 */
const DEFAULT_BEAT_MS = 500;

/**
 * Karplus-Strong 拨弦合成：噪声脉冲经带阻尼低通的反馈延迟线，
 * 音色接近拨弦而非电子音，适合古琴旋律参考。
 */
function schedulePluck(ctx: AudioContext, freq: number, time: number): AudioBufferSourceNode {
  const sr = ctx.sampleRate;
  const period = Math.max(2, Math.round(sr / freq));
  const length = Math.floor(sr * 1.5);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;

  let idx = 0;
  for (let i = 0; i < length; i++) {
    const current = ring[idx];
    ring[idx] = 0.5 * (current + ring[(idx + 1) % period]) * 0.996;
    data[i] = current;
    idx = (idx + 1) % period;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(time);
  return src;
}

/**
 * 乐谱流播放：把整首排程一次性交给 AudioContext，stop 时全部断开。
 * 休止符与无简谱标注的音静默但占位时值。
 */
export function useScorePlayer(notes: NoteColumn[]) {
  const [isPlaying, setIsPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setIsPlaying(false);
  }, []);

  const play = useCallback(async () => {
    if (isPlaying || notes.length === 0) return;

    ctxRef.current ??= new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const schedule = buildSchedule(notes, DEFAULT_BEAT_MS);
    const t0 = ctx.currentTime + 0.05;
    sourcesRef.current = schedule
      .filter((s) => s.freq !== null)
      .map((s) => schedulePluck(ctx, s.freq as number, t0 + s.start));

    setIsPlaying(true);
    const total = schedule.reduce((end, s) => Math.max(end, s.start + s.duration), 0);
    timerRef.current = setTimeout(stop, total * 1000 + 100);
  }, [isPlaying, notes, stop]);

  // 卸载时停止播放并释放 AudioContext
  useEffect(() => {
    return () => {
      stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [stop]);

  return { play, stop, isPlaying };
}
