"use client";

/**
 * 单个音位的试听。
 *
 * 音位候选表要能「听一下再决定」：同一个音在七弦十三徽上有十几个落点，
 * 光看「五弦十徽」看不出音色差别，点一下就听比读十行说明强。
 *
 * 与整谱播放共用 `schedulePluck`（同一套 Karplus-Strong 合成），
 * 所以试听听到的就是弹进谱子里听到的声音，不是另做一套。
 */

import { useCallback, useEffect, useRef } from "react";
import type { JianziState } from "./types";
import { pitchSlide } from "./jianzi";
import { jianziToFrequency } from "./jianzi-pitch";
import { DEFAULT_TUNING, type TuningId } from "./tuning";
import { CONCERT_PITCH_DEFAULT } from "./concert-pitch";
import { schedulePluck } from "./audio-synth";

/** 试听单音：返回 false 表示这个谱字推不出音高（或浏览器不给开音频）。 */
export type PreviewNote = (state: JianziState) => boolean;

export function useNotePreview(
  tuning: TuningId = DEFAULT_TUNING,
  concertPitch: number = CONCERT_PITCH_DEFAULT,
): PreviewNote {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  return useCallback(
    (state: JianziState) => {
      const freq = jianziToFrequency(state, { tuning, concertPitch });
      if (freq === null) return false;
      try {
        ctxRef.current ??= new AudioContext();
      } catch {
        return false;
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      schedulePluck(ctx, freq, ctx.currentTime + 0.02, 0.5, state.toneType, pitchSlide(state.slide));
      return true;
    },
    [tuning, concertPitch],
  );
}
