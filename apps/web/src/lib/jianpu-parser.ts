/**
 * 简谱字符串解析器。
 *
 * 支持格式：
 * - 数字 1-7 表示基本音级
 * - 数字后紧跟 `·` 或 `'` 表示高八度
 * - 数字后紧跟 `,` 表示低八度
 * - 空格或 `|` 作为小节/音符分隔符
 * - `-` 延音线：给前一个音符加一拍（可跨小节），如 `5 -` 为二分音符
 * - 数字后紧跟 `_` 减时线：一条为八分、两条为十六分
 * - 数字后紧跟 `.` 附点：时值 ×1.5，如 `5.` 为附点四分
 * - `0` 表示休止占位
 *
 * 三拍（`5 - -`）映射为附点二分；无法精确映射到 Duration 的
 * 延音线会被忽略（保留音符本身）。
 *
 * 示例：
 * - `"5 6 1 2 | 3 5 6 -"`
 * - `"5· 3, | 1_ 2__ 3."`
 */

import type { Duration } from "./types";

export interface ParsedJianpuNote {
  kind: "note";
  /** 简谱数字 1-7。 */
  number: number;
  /** 八度偏移：0 = 中央组，+1 = 高八度，-1 = 低八度。 */
  octave: number;
  /** 基础时值（不含附点加成）。 */
  duration: Duration;
  /** 是否附点（时值 ×1.5）。 */
  dotted: boolean;
  /** 原始字符串片段，用于 UI 回显。 */
  raw: string;
}

export interface ParsedJianpuRest {
  kind: "rest";
  duration: Duration;
  dotted: boolean;
  raw: string;
}

export type ParsedJianpuItem = ParsedJianpuNote | ParsedJianpuRest;

/**
 * 以三十二分音符为单位的整数拍数 → (Duration, dotted)。
 * 1 拍（四分）= 8 单位，避免浮点比较。
 */
const BEAT_MAP: Record<number, [Duration, boolean]> = {
  32: ["全", false],
  24: ["二分", true],
  16: ["二分", false],
  12: ["四分", true],
  8: ["四分", false],
  6: ["八分", true],
  4: ["八分", false],
  3: ["十六分", true],
  2: ["十六分", false],
};

const UNITS_OF: Record<string, number> = Object.fromEntries(
  Object.entries(BEAT_MAP).map(([units, [d, dot]]) => [`${d}|${dot}`, Number(units)]),
);

const QUARTER_UNITS = 8;

/**
 * 解析简谱字符串为音符/休止符序列。
 *
 * 返回数组中每个元素对应一个「位置」：
 * - `ParsedJianpuNote` 表示有效音符
 * - `ParsedJianpuRest` 表示休止符（`0`，可带减时线/附点/延音线）
 */
export function parseJianpuString(input: string): ParsedJianpuItem[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const out: ParsedJianpuItem[] = [];
  for (const token of tokenize(trimmed)) {
    if (token === "-") {
      extendLastItem(out);
      continue;
    }
    const item = parseRestToken(token) ?? parseNoteToken(token);
    if (item) out.push(item);
  }
  return out;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";

  for (const char of input) {
    if (char === " " || char === "\t" || char === "|") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseNoteToken(token: string): ParsedJianpuNote | undefined {
  const match = token.match(/^(\d)([·',]?)(_{0,2})(\.?)$/);
  if (!match) return undefined;

  const number = parseInt(match[1], 10);
  if (number < 1 || number > 7) return undefined;

  const octaveMarker = match[2];
  const octave = octaveMarker === "·" || octaveMarker === "'" ? 1 : octaveMarker === "," ? -1 : 0;

  const mapped = durationFromModifiers(match[3].length, match[4] === ".");
  if (!mapped) return undefined;

  return {
    kind: "note",
    number,
    octave,
    duration: mapped[0],
    dotted: mapped[1],
    raw: token,
  };
}

function parseRestToken(token: string): ParsedJianpuRest | undefined {
  const match = token.match(/^0(_{0,2})(\.?)$/);
  if (!match) return undefined;

  const mapped = durationFromModifiers(match[1].length, match[2] === ".");
  if (!mapped) return undefined;

  return {
    kind: "rest",
    duration: mapped[0],
    dotted: mapped[1],
    raw: token,
  };
}

function durationFromModifiers(
  reduction: number,
  dotted: boolean,
): [Duration, boolean] | undefined {
  let units = QUARTER_UNITS >> reduction;
  if (dotted) units += units / 2;
  return BEAT_MAP[units];
}

/** 延音线：给前一个音符/休止符加一拍；无法映射时忽略该延音线。 */
function extendLastItem(out: ParsedJianpuItem[]): void {
  const last = out[out.length - 1];
  if (!last) return;

  const units = UNITS_OF[`${last.duration}|${last.dotted}`] + QUARTER_UNITS;
  const mapped = BEAT_MAP[units];
  if (!mapped) return;

  last.duration = mapped[0];
  last.dotted = mapped[1];
  last.raw += "-";
}
