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
 * 解析简谱字符串为音符序列。
 *
 * 返回数组中每个元素对应一个「位置」：
 * - `ParsedJianpuNote` 表示有效音符
 * - `null` 表示休止占位
 */
export function parseJianpuString(input: string): (ParsedJianpuNote | null)[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const out: (ParsedJianpuNote | null)[] = [];
  for (const token of tokenize(trimmed)) {
    if (token === "-") {
      extendLastNote(out);
      continue;
    }
    if (token === "0") {
      out.push(null);
      continue;
    }
    const note = parseNoteToken(token);
    if (note) out.push(note);
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

  const reduction = match[3].length;
  let units = QUARTER_UNITS >> reduction;
  if (match[4] === ".") units += units / 2;

  const mapped = BEAT_MAP[units];
  if (!mapped) return undefined;

  return {
    number,
    octave,
    duration: mapped[0],
    dotted: mapped[1],
    raw: token,
  };
}

/** 延音线：给前一个音符加一拍；无法映射时忽略该延音线。 */
function extendLastNote(out: (ParsedJianpuNote | null)[]): void {
  const last = out[out.length - 1];
  if (!last) return;

  const units = UNITS_OF[`${last.duration}|${last.dotted}`] + QUARTER_UNITS;
  const mapped = BEAT_MAP[units];
  if (!mapped) return;

  last.duration = mapped[0];
  last.dotted = mapped[1];
  last.raw += "-";
}
