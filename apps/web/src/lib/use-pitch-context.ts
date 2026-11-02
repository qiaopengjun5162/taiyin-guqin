"use client";

/**
 * 音高上下文：当前定弦 + 基准音，两个偏好合成的只读快照。
 *
 * 减字反推音高同时依赖这两个值（定弦决定弦间音程，基准音决定整体高低），
 * 组件里如果各自去读 localStorage 就不会随切换重渲染——所以统一走这个 hook。
 */

import { useSyncExternalStore } from "react";
import { getTuning, getServerTuning, subscribeTuning, type TuningId } from "./tuning";
import {
  getConcertPitch,
  getServerConcertPitch,
  subscribeConcertPitch,
} from "./concert-pitch";

export interface PitchContextValue {
  tuning: TuningId;
  concertPitch: number;
}

export function usePitchContext(): PitchContextValue {
  const tuning = useSyncExternalStore(subscribeTuning, getTuning, getServerTuning);
  const concertPitch = useSyncExternalStore(
    subscribeConcertPitch,
    getConcertPitch,
    getServerConcertPitch,
  );
  return { tuning, concertPitch };
}
