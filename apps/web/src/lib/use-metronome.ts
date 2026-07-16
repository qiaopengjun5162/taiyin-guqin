"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { advanceBeat, isDownbeat } from "./metronome";

/** 与旋律播放一致的拍速：500ms ≈ 120 BPM。 */
const DEFAULT_BEAT_MS = 500;
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
 * 运行中修改拍号即时生效（每拍实时读取最新 beatsPerBar）。
 */
export function useMetronome(beatsPerBar: number) {
  const [isRunning, setIsRunning] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatsPerBarRef = useRef(beatsPerBar);
  beatsPerBarRef.current = beatsPerBar;

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
  }, []);

  const start = useCallback(async () => {
    if (isRunning) return;

    ctxRef.current ??= new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const beatSec = DEFAULT_BEAT_MS / 1000;
    let beatTime = ctx.currentTime + 0.05;
    let beatIndex = 0;

    intervalRef.current = setInterval(() => {
      while (beatTime < ctx.currentTime + LOOKAHEAD_SEC) {
        scheduleClick(ctx, beatTime, isDownbeat(beatIndex, beatsPerBarRef.current));
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

  return { toggle, stop, isRunning };
}
