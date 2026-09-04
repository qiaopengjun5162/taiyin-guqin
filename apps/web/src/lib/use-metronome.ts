"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { advanceBeat, isDownbeat } from "./metronome";

/** 调度间隔与前瞻窗口（WebAudio 节拍器标准做法）。 */
const TICK_MS = 25;
const LOOKAHEAD_SEC = 0.1;

function scheduleClick(ctx: AudioContext, time: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 2000 : 1200;
  gain.gain.setValueAtTime(0.25, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.07);
}

/**
 * 节拍器：按拍号给强拍加重音，lookahead 调度保证节奏稳定。
 * 运行中修改拍号/速度即时生效（每拍实时读取最新 beatsPerBar / bpm）。
 * 通过 currentBeat 暴露当前拍（0..beatsPerBar-1），供 UI 做拍点高亮；
 * 与旋律播放共享同速时，强拍（beat 0）即乐谱小节重音。
 *
 * @param bpm 速度（拍/分钟），默认 120；与旋律播放共享。
 */
export function useMetronome(beatsPerBar: number, bpm: number = 120) {
  const [isRunning, setIsRunning] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const beatsPerBarRef = useRef(beatsPerBar);
  const bpmRef = useRef(bpm);

  useEffect(() => {
    beatsPerBarRef.current = beatsPerBar;
  }, [beatsPerBar]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    for (const t of beatTimersRef.current) clearTimeout(t);
    beatTimersRef.current = [];
    setCurrentBeat(-1);
    setIsRunning(false);
  }, []);

  const start = useCallback(async () => {
    if (isRunning) return;

    ctxRef.current ??= new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    let beatTime = ctx.currentTime + 0.05;
    let beatIndex = 0;
    setCurrentBeat(0);

    intervalRef.current = setInterval(() => {
      const beatSec = (60000 / bpmRef.current) / 1000;
      while (beatTime < ctx.currentTime + LOOKAHEAD_SEC) {
        scheduleClick(ctx, beatTime, isDownbeat(beatIndex, beatsPerBarRef.current));
        const delayMs = Math.max(0, (beatTime - ctx.currentTime) * 1000);
        beatTimersRef.current.push(
          setTimeout(() => setCurrentBeat(beatIndex % beatsPerBarRef.current), delayMs),
        );
        [beatTime, beatIndex] = advanceBeat(beatTime, beatIndex, beatSec);
      }
    }, TICK_MS);

    setIsRunning(true);
  }, [isRunning]);

  const toggle = useCallback(() => {
    if (isRunning) {
      stop();
    } else {
      void start();
    }
  }, [isRunning, start, stop]);

  useEffect(() => {
    return () => {
      stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [stop]);

  return { toggle, stop, isRunning, currentBeat };
}
