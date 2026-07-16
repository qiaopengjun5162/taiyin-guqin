/**
 * 旋律播放的纯逻辑层：简谱 → 频率，音符序列 → 播放调度。
 *
 * 音高约定与 Rust 侧 `midi_note` 一致：简谱 1（中央组）= C4 (MIDI 60)，
 * 为相对音高参考，不代表古琴实际音区。
 * 休止符（jianpuNumber "0"）与无简谱标注的音：静默但占位时值。
 */

import type { NoteColumn } from "./types";
import { durationToBeats } from "./types";

/** 简谱数字 → 相对 C 的半音数。 */
const SEMITONES: Record<string, number> = {
  "1": 0,
  "2": 2,
  "3": 4,
  "4": 5,
  "5": 7,
  "6": 9,
  "7": 11,
};

/** 简谱数字 + 八度偏移 → 播放频率（Hz）；不可播放返回 null。 */
export function jianpuToFrequency(
  number: string | null,
  octave: string,
): number | null {
  if (!number || number === "0") return null;
  const semitone = SEMITONES[number];
  if (semitone === undefined) return null;
  const octaveOffset = octave === "·" ? 12 : octave === "," ? -12 : 0;
  const midi = 60 + semitone + octaveOffset;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface ScheduledNote {
  /** 相对播放起点的时间（秒）。 */
  start: number;
  /** 时值（秒）。 */
  duration: number;
  /** 频率；null 表示静默（休止/无简谱）。 */
  freq: number | null;
}

/**
 * 将乐谱流排为调度表。`beatMs` 为一拍（四分音符）的毫秒数。
 */
export function buildSchedule(notes: NoteColumn[], beatMs: number): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  let cursor = 0;
  for (const note of notes) {
    const beats = durationToBeats(note.duration, note.jianpuDot);
    const duration = (beats * beatMs) / 1000;
    out.push({
      start: cursor,
      duration,
      freq: jianpuToFrequency(note.jianpuNumber, note.jianpuOctave),
    });
    cursor += duration;
  }
  return out;
}
