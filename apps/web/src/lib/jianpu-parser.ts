/**
 * 简谱字符串解析器 —— 前端薄壳。
 *
 * 解析逻辑的**唯一实现**在 Rust：`crates/taiyin-core/src/jianpu_parse.rs`。
 * 这里只做三件事：调 WASM、把结果转成既有 TS 形状、在引擎未就绪时降级。
 *
 * 支持格式（与 Rust 侧逐条一致）：
 * - 数字 1-7 表示基本音级
 * - 数字后紧跟 `·` 或 `'` 表示高八度（可叠加），`,` 表示低八度
 * - 空格 / `\t` / `|` 作为音符分隔符
 * - `-` 延音线：给前一个音符加一拍（可跨小节），如 `5 -` 为二分音符
 * - 数字后紧跟 `_` 减时线：一条为八分、两条为十六分
 * - 数字后紧跟 `.` 附点：时值 ×1.5，如 `5.` 为附点四分
 * - `0` 表示休止占位（同样支持减时线 / 附点 / 延音线）
 *
 * 三拍（`5 - -`）映射为附点二分；无法精确映射到 Duration 的延音线会被忽略
 * （保留音符本身）。
 *
 * 示例：
 * - `"5 6 1 2 | 3 5 6 -"`
 * - `"5· 3, | 1_ 2__ 3."`
 *
 * ## 为什么迁进核心（2026-11-18）
 *
 * 同一段简谱在网页、小程序、App 上必须解析出**同一份时值**——
 * 差一拍就会让导出的谱面、慢练的分句、指法编排全部对不上，而且不会报错。
 * 这是「结果必须一致」的典型逻辑，且它不碰时间/存储/网络/UI，天然适合共享。
 *
 * 之前这里有 189 行实现、一张 `BEAT_MAP` 时值表，与 Rust 侧各存一份。
 * 现在只剩映射：Rust 出结构，这里保证字段名与调用方期待的一致。
 */

import type { Duration } from "./types";
import { getWasmSync, isWasmReady } from "./taiyin-wasm";

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

/** Rust 侧的原始项（比前端多一个 `units`）。 */
interface WireItem {
  kind: "note" | "rest";
  number?: number;
  octave?: number;
  units: number;
  duration: string;
  dotted: boolean;
  raw: string;
}

const DURATIONS: ReadonlySet<string> = new Set([
  "全",
  "二分",
  "四分",
  "八分",
  "十六分",
]);

/** 把 Rust 的输出转成前端形状，丢弃 `units`（由 `noteUnits` 单独取）。 */
function toItems(rawText: string): ParsedJianpuItem[] {
  const parsed = JSON.parse(rawText) as { items?: WireItem[]; error?: string };
  if (parsed.error) throw new Error(parsed.error);
  return (parsed.items ?? []).map((it): ParsedJianpuItem => {
    // 时值名来自 Rust 的固定表；万一出现未知值退回「四分」而不是崩掉
    const duration = (DURATIONS.has(it.duration) ? it.duration : "四分") as Duration;
    if (it.kind === "rest") {
      return { kind: "rest", duration, dotted: it.dotted, raw: it.raw };
    }
    return {
      kind: "note",
      number: it.number ?? 1,
      octave: it.octave ?? 0,
      duration,
      dotted: it.dotted,
      raw: it.raw,
    };
  });
}

/**
 * 解析简谱字符串为音符/休止符序列。
 *
 * 返回数组中每个元素对应一个「位置」：
 * - `ParsedJianpuNote` 表示有效音符
 * - `ParsedJianpuRest` 表示休止符（`0`，可带减时线/附点/延音线）
 *
 * 引擎未就绪时返回空数组：那是**诚实**的空，而不是猜一个可能错的时值。
 */
export function parseJianpuString(input: string): ParsedJianpuItem[] {
  if (!isWasmReady()) return [];
  return toItems(getWasmSync().parse_jianpu(JSON.stringify({ input })));
}

/**
 * 一个音占多少「1/8 拍」：四分 = 8、八分 = 4、二分 = 16、全音符 = 32。
 *
 * 这个数要送给 Rust 的指法编排：它决定「手有没有时间换把」。
 * 八分连八分时手来不及挪，二分音符按住两拍则足够整只手走半个琴面。
 *
 * ## 实现说明
 *
 * 入参是**已经解析过的** item（`duration` + `dotted` 已是最终值，延音线也计入了）。
 * 所以这里直接把这两个字段翻译回单位数，**不能**拿 `raw` 再让 Rust 解析一遍——
 * `raw` 是回显用的原始片段，全音符 `5---` 这种要凑够三条延音线才对得上，
 * 而 item 里的 `duration:"全"` 已经是答案。
 *
 * 这张表刻意与 Rust `jianpu_parse::beat_name` 一一对应，并由
 * `scripts/verify-duration-code-contract.mjs` 守着两侧不许漂。
 */
const UNITS_BY_DURATION: Record<Duration, number> = {
  全: 32,
  二分: 16,
  四分: 8,
  八分: 4,
  十六分: 2,
};

export function noteUnits(note: ParsedJianpuNote): number {
  const base = UNITS_BY_DURATION[note.duration] ?? 8;
  // 附点 = ×1.5（附点全音符 48 没有时值名，解析阶段就已排除）
  return note.dotted ? base + base / 2 : base;
}
