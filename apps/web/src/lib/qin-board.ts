/**
 * 琴面音位全览的数据层。
 *
 * 王悠荻写《虚拟古琴》时说，古琴数字化不等于「把七根弦做成七个按钮」，
 * 要先让「音位成为可以计算的坐标」。这个文件就是那张坐标表：
 * 七弦 × 十三徽，每个交点算出频率、绝对音高与音名。
 *
 * 三条铁律：
 *  1. 频率必须与 `jianzi-pitch` 出自同一套 p（徽分换算），否则图上一点、
 *     耳朵听见另一点——这正是减字谱最容易骗人的地方。
 *  2. 泛音取「谐波次数 × 空弦」，不是 open/p（九徽 p=2/3 时 open/p 只有 1.5 次）。
 *  3. 泛音是纯律，落到十二平均律的音名上是近似值，偏差用 `cents` 一起给出，
 *     不假装它正好是那个音。
 */

import { huiFraction, huiHarmonic } from "./jianzi-pitch";
import { getTuningById, type TuningId } from "./tuning";
import { CONCERT_PITCH_DEFAULT } from "./concert-pitch";
import type { NoteType } from "./types";

/** 七弦。一弦最粗最低。 */
export const BOARD_STRINGS = 7;
/** 十三徽。 */
export const BOARD_HUI = 13;

const STRING_NUMERALS = ["一", "二", "三", "四", "五", "六", "七"] as const;
const HUI_NUMERALS = [
  "", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三",
] as const;
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;

/** 琴面上的一个位置。 */
export interface BoardDot {
  /** 稳定标识，用于 React key 与测试定位：`按-3-7`。 */
  key: string;
  kind: NoteType;
  /** 0 = 一弦 … 6 = 七弦。 */
  stringIndex: number;
  /** 「一」…「七」。 */
  stringNumber: string;
  /** 泛/按音为 1–13；散音为 null。 */
  hui: number | null;
  /** 按弦点占全弦长比例（散音为 0）。 */
  ratio: number;
  /** 绝对音高（十二平均律，可能是小数）。 */
  midi: number;
  /** 与最近整数 MIDI 的偏差，单位音分。泛音常不为 0。 */
  cents: number;
  freq: number;
  /** 「F2」「F♯4」这类音名。 */
  noteName: string;
}

/** 频率 → MIDI（含小数）。 */
export function freqToMidi(freq: number, concertPitch = CONCERT_PITCH_DEFAULT): number {
  return 69 + 12 * Math.log2(freq / concertPitch);
}

/** MIDI → 音名 + 偏差音分。 */
export function midiToNote(midi: number): { noteName: string; cents: number } {
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return { noteName: `${NOTE_NAMES[pitchClass]}${octave}`, cents };
}

/** 空弦频率（Hz）。 */
function openFrequency(stringIndex: number, tuning: TuningId, concertPitch: number): number {
  const midi = getTuningById(tuning).openMidi[stringIndex];
  return concertPitch * Math.pow(2, (midi - 69) / 12);
}

/**
 * 按弦点比例 → 该位置发声频率。
 *
 * 按音：有效弦长 (1−p)，频率 = 空弦 / (1−p)；
 * 泛音：谐波次数 n × 空弦，n 由徽位决定（见 `huiHarmonic`）。
 */
export function boardFrequency(
  stringIndex: number,
  ratio: number,
  hui: number | null,
  kind: NoteType,
  tuning: TuningId,
  concertPitch = CONCERT_PITCH_DEFAULT,
): number | null {
  const open = openFrequency(stringIndex, tuning, concertPitch);
  if (kind === "散") return open;
  if (kind === "泛") {
    // 泛音必须知道是哪一徽（谐波次数由徽位定），拖动中的连续位置没有徽位。
    if (hui == null) return null;
    const harmonic = huiHarmonic(hui);
    return harmonic == null ? null : open * harmonic;
  }
  const active = 1 - ratio;
  return active > 0 ? open / active : null;
}

function makeDot(
  stringIndex: number,
  hui: number | null,
  kind: NoteType,
  tuning: TuningId,
  concertPitch: number,
): BoardDot | null {
  const ratio = hui == null ? 0 : huiFraction(hui, null);
  if (ratio == null) return null;
  const freq = boardFrequency(stringIndex, ratio, hui, kind, tuning, concertPitch);
  if (freq == null) return null;
  const midi = freqToMidi(freq, concertPitch);
  const { noteName, cents } = midiToNote(midi);
  return {
    key: `${kind}-${stringIndex}-${hui ?? "散"}`,
    kind,
    stringIndex,
    stringNumber: STRING_NUMERALS[stringIndex],
    hui,
    ratio,
    midi,
    cents,
    freq,
    noteName,
  };
}

/** 整张琴上某一类音的落点（散音 7 个，按/泛音各 91 个）。 */
export function boardDots(
  kind: NoteType,
  tuning: TuningId = "zhengdiao",
  concertPitch = CONCERT_PITCH_DEFAULT,
): BoardDot[] {
  const dots: BoardDot[] = [];
  for (let s = 0; s < BOARD_STRINGS; s++) {
    if (kind === "散") {
      const dot = makeDot(s, null, "散", tuning, concertPitch);
      if (dot) dots.push(dot);
      continue;
    }
    for (let hui = 1; hui <= BOARD_HUI; hui++) {
      const dot = makeDot(s, hui, kind, tuning, concertPitch);
      if (dot) dots.push(dot);
    }
  }
  return dots;
}

/**
 * 拖动时按连续位置取音：p 由横坐标给出，不吸附到整徽。
 * 这样「走手音」才是连续变化，而不是在十三个点上跳。
 */
export function boardDotAt(
  stringIndex: number,
  ratio: number,
  kind: NoteType,
  tuning: TuningId = "zhengdiao",
  concertPitch = CONCERT_PITCH_DEFAULT,
): BoardDot | null {
  const clamped = Math.min(0.95, Math.max(0.01, ratio));
  const freq = boardFrequency(stringIndex, clamped, null, kind, tuning, concertPitch);
  if (freq == null) return null;
  const midi = freqToMidi(freq, concertPitch);
  const { noteName, cents } = midiToNote(midi);
  return {
    key: `${kind}-${stringIndex}-drag`,
    kind,
    stringIndex,
    stringNumber: STRING_NUMERALS[stringIndex],
    hui: null,
    ratio: clamped,
    midi,
    cents,
    freq,
    noteName,
  };
}

const CN_FEN = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

/**
 * 把任意位置说成人话：「七徽六」「十徽半」「一徽三分」。
 *
 * 徽分从**靠近岳山的那一徽**起算、向龙龈方向数（减字谱的老规矩）：
 * 七徽与八徽之间、靠七徽六分，写「七徽六」。拖动时显示徽分比只显示音名有用——
 * 音名只说明「是什么音」，徽分才说明「手该落在哪」。
 */
export function ratioToHuiLabel(ratio: number): string {
  if (ratio <= 0) return "散";
  const first = huiRatio(1);
  if (ratio < first) return "岳山侧";

  let prevHui = 1;
  let prev = first;
  for (let hui = 1; hui <= BOARD_HUI; hui++) {
    const here = huiRatio(hui);
    if (Math.abs(ratio - here) < 0.002) return `${HUI_NUMERALS[hui]}徽`;
    if (hui > 1 && ratio < here) {
      const span = here - prev;
      const within = span > 0 ? (ratio - prev) / span : 0;
      const fen = Math.min(9, Math.round(within * 10));
      return fen <= 0
        ? `${HUI_NUMERALS[prevHui]}徽`
        : `${HUI_NUMERALS[prevHui]}徽${CN_FEN[fen]}`;
    }
    prevHui = hui;
    prev = here;
  }
  return "十三徽外";
}

/** 同音名的所有落点（供「这个音在琴上还有哪些位置」高亮）。 */
export function sameNoteDots(dots: BoardDot[], midi: number): BoardDot[] {
  const target = Math.round(midi);
  return dots.filter((d) => Math.round(d.midi) === target);
}

/** 徽位中文数字（一…十三）。 */
export function huiNumeral(hui: number): string {
  return HUI_NUMERALS[hui] ?? String(hui);
}

/** 徽位 → 距岳山的比例。画图与算音共用这一处，图上一点才对得上耳朵一点。 */
export function huiRatio(hui: number): number {
  return huiFraction(hui, null) ?? 0;
}
