/**
 * 旋律播放的纯逻辑层：音符 → 频率，音符序列 → 播放调度。
 *
 * 音高来源有两条，**减字优先**：
 * 1. 谱字本身（音色 + 弦序 + 徽位）→ `jianziToFrequency` 的物理模型，
 *    这是「谱上写着哪个位置，耳朵就听到那个位置的声音」。
 * 2. 没有谱字（只有简谱，或旧存档缺字段）→ 退回简谱推算。
 *
 * 为什么必须减字优先：以前只按简谱发声，减字只是个画在旁边的字。
 * 于是「散挑三」弹出来是 C4，而琴上三弦明明是 F2——谱与声差一个四度加两个八度，
 * 跟着谱练的人永远对不上；纯减字谱（没填简谱）更是整首无声。
 *
 * 简谱按 **1=F 记谱**（与 Rust 候选引擎完全一致）：
 * 1 = F，未标记八度的「1」落在 F1（MIDI 29）；正调宫音=三弦 F2 对应「1」的高八度记号，
 * 未标记的「5」才是散一弦 C2。这样「查音位」（Rust）给出的位置与谱面播放（TS）音高对得上，
 * 不再差一个四度加若干八度。
 * 休止符（jianpuNumber "0"）与两条来源都推不出音高的音：静默但占位时值。
 */

import type { JianziState, NoteColumn, NoteType, PitchSlide } from "./types";
import { durationToBeats, pitchSlide } from "./jianzi";
import { jianziToFrequency } from "./jianzi-pitch";
import { DEFAULT_TUNING, type TuningId } from "./tuning";
import { CONCERT_PITCH_DEFAULT } from "./concert-pitch";

/** 简谱数字 → 相对宫音（1=F）的半音数（1=F 2=G 3=A 4=B♭ 5=C 6=D 7=E）。 */
const SEMITONES: Record<string, number> = {
  "1": 0,
  "2": 2,
  "3": 4,
  "4": 5,
  "5": 7,
  "6": 9,
  "7": 11,
};

/** 1=F 记谱下、八度 0 的「1」对应的 MIDI 号，与 Rust `midi_note` 的 `PITCH_BASE_MIDI` 一致。 */
const PITCH_BASE_MIDI: number = 29;

/** 八度记号 → 半音偏移（`·` +1 八度，`,` -1 八度，最多两重）。 */
export function octaveToSemitones(octave: string): number {
  return octave === "·" ? 12 : octave === "··" ? 24 : octave === "," ? -12 : octave === ",," ? -24 : 0;
}

/** 简谱数字 + 八度偏移 → MIDI 音高号（1=F，未标记八度的「1」= F1 = MIDI 29）；不可播放返回 null。
 *
 * 与 Rust 候选引擎用同一套 1=F 坐标：1 为 F，八度 0 落在 F1。三种调式共用这套记谱，
 * 调式只决定每根空弦落在第几级，不改变简谱数字本身的音级——所以这里与调式无关。
 * MIDI 号与基准音无关（MIDI 世界固定 A4=440 的等分律编号），不受 `concertPitch` 影响。
 */
export function jianpuToMidi(number: string | null, octave: string): number | null {
  if (!number || number === "0") return null;
  const semitone = SEMITONES[number];
  if (semitone === undefined) return null;
  return PITCH_BASE_MIDI + semitone + octaveToSemitones(octave);
}

/** 简谱数字 + 八度偏移 → 播放频率（Hz）；不可播放返回 null。
 *
 * `concertPitch` 为 A4 的频率（默认 440）。古琴常整床偏低，改这一个数即可
 * 让整谱跟着自己的琴走——相对音程不变，只是整体平移。
 */
export function jianpuToFrequency(
  number: string | null,
  octave: string,
  concertPitch: number = CONCERT_PITCH_DEFAULT,
): number | null {
  const midi = jianpuToMidi(number, octave);
  if (midi === null) return null;
  return concertPitch * Math.pow(2, (midi - 69) / 12);
}

/**
 * 谱字 → 实际振动频率；散音只需弦序，按/泛音还要徽位。
 * 谱字没填全（旧存档、只录了一半）时返回 null，交给简谱兜底。
 */
function jianziFrequency(
  jianzi: JianziState | undefined | null,
  concertPitch: number,
  tuning: TuningId,
): number | null {
  if (!jianzi) return null;
  return jianziToFrequency(jianzi, { tuning, concertPitch });
}

/**
 * 一个音符列真正的发音频率：**减字优先，简谱兜底**。
 *
 * 减字推得出音高就用它——那是琴上真实的位置；
 * 推不出（只有简谱 / 谱字残缺 / 休止）才退回简谱的相对音高。
 */
export function columnFrequency(
  note: NoteColumn,
  concertPitch: number = CONCERT_PITCH_DEFAULT,
  tuning: TuningId = DEFAULT_TUNING,
): number | null {
  const fromJianzi = jianziFrequency(note.jianzi, concertPitch, tuning);
  if (fromJianzi !== null) return fromJianzi;
  return jianpuToFrequency(note.jianpuNumber, note.jianpuOctave, concertPitch);
}

/**
 * 一个音符列的 MIDI 音高号（等分律取整，恒按 A4=440）。
 *
 * 与 `columnFrequency` 同一套来源，只是把频率换成 MIDI 号——
 * MIDI 文件里存的是绝对音高号，本机基准音（415Hz 之类）不该改它。
 */
export function columnMidi(
  note: NoteColumn,
  tuning: TuningId = DEFAULT_TUNING,
): number | null {
  const freq = columnFrequency(note, 440, tuning);
  if (freq === null) return null;
  return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(freq / 440))));
}

export interface ScheduledNote {
  /** 相对播放起点的时间（秒）。 */
  start: number;
  /** 时值（秒）。 */
  duration: number;
  /** 频率；null 表示静默（休止/无简谱）。 */
  freq: number | null;
  /** 音技法（散/泛/按）；null 表示未指定，播放时退回默认按音音色。 */
  toneType: NoteType | null;
  /** 会滑音高的记号（绰/注）；决定起音是否从本位上下方滑过来。
   *  「急」不在此列——急弹不改音高，谱面留着它，音频按直音弹。 */
  slide: PitchSlide | null;
}

/**
 * 将乐谱流排为调度表。`beatMs` 为一拍（四分音符）的毫秒数。
 * `concertPitch` 为 A4 频率，`tuning` 决定空弦音——两者一起喂给 `columnFrequency`。
 */
export function buildSchedule(
  notes: NoteColumn[],
  beatMs: number,
  concertPitch: number = CONCERT_PITCH_DEFAULT,
  tuning: TuningId = DEFAULT_TUNING,
): ScheduledNote[] {
  const out: ScheduledNote[] = [];
  let cursor = 0;
  for (const note of notes) {
    const beats = durationToBeats(note.duration, note.jianpuDot);
    const duration = (beats * beatMs) / 1000;
    out.push({
      start: cursor,
      duration,
      freq: columnFrequency(note, concertPitch, tuning),
      toneType: note.jianzi.toneType,
      // 旧存档里可能没有 slide 字段，缺省当没有走手音；
      // 「急」被 pitchSlide 筛掉，音频按直音弹
      slide: pitchSlide(note.jianzi.slide ?? null),
    });
    cursor += duration;
  }
  return out;
}
