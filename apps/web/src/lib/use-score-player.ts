"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteColumn } from "./types";
import { buildSchedule } from "./player";

/**
 * Karplus-Strong 拨弦合成：噪声脉冲经带阻尼低通的反馈延迟线，
 * 音色接近拨弦而非电子音，适合古琴旋律参考。
 */
/**
 * 单音拨弦合成。缓冲长度跟随该音符自身时值 `durationSec`（最短 0.2s 保证可闻），
 * 整体平滑衰减到 0，缓冲播完即自动停止——避免短音 1.5s 拖尾糊入后续音符、
 * 也避免长音被固定缓冲硬切。
 */
function schedulePluck(
  ctx: AudioContext,
  freq: number,
  time: number,
  durationSec: number,
): AudioBufferSourceNode {
  const sr = ctx.sampleRate;
  const period = Math.max(2, Math.round(sr / freq));
  const dur = Math.max(durationSec, 0.2);
  const length = Math.floor(sr * dur);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;

  let idx = 0;
  for (let i = 0; i < length; i++) {
    const current = ring[idx];
    ring[idx] = 0.5 * (current + ring[(idx + 1) % period]) * 0.996;
    const t = i / length;
    // 起音 10ms 渐入（避免起始直流爆音）+ 整体平滑衰减到 0（避免缓冲结尾爆音）
    const env = t < 0.01 ? t / 0.01 : Math.pow(1 - (t - 0.01) / 0.99, 1.3);
    data[i] = current * Math.max(0, env);
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
      .map((s) => schedulePluck(ctx, s.freq as number, t0 + s.start, s.duration));

    setIsPlaying(true);
    // 逐音高亮：与音频同一起点 t0 的墙上时钟偏移
    indexTimersRef.current = schedule.map((s, i) =>
      setTimeout(() => setPlayingIndex(i), (s.start + 0.05) * 1000),
    );
    const total = schedule.reduce((end, s) => Math.max(end, s.start + s.duration), 0);
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
