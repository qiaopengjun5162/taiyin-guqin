/**
 * 减字字典（字全表）—— 前端类型与 UI 标签常量。
 *
 * 核心逻辑（字全表数据 + 筛选 + 搜索）全部在 Rust `taiyin-core` 的
 * `jianzi_dictionary` 模块，通过 wasm 函数 `get_jianzi_dictionary(filter)` 暴露。
 * 本文件只放：前端渲染所需的类型定义，以及筛选下拉框的**标签**列表
 * （纯展示；实际按 label 分组匹配在 Rust 端完成，名/夕、食/亻、劈/擘 同指合并）。
 */

import type { Duration, JianziState, NoteType, SlideMark } from "./types";

/** 字典条目。state 完整可弹（与 JianziState 同形，rhythmMode 恒为 null）。 */
export interface JianziDictEntry {
  id: string;
  state: JianziState;
  /** 变体或易错说明，如「夕 = 名指，传统也写作『名』」。 */
  note?: string;
  /** 是否常用（教材高频指法）。 */
  common?: boolean;
  /**
   * 减字编码（如 `ad9g4`）——由 Rust `jianzi_code` 生成。
   *
   * 与连打输入同一张码表：看一眼就知道这字怎么敲，也能拿它当搜索词。
   */
  code: string;
  /** 可搜索文本：字形 + 读法 + 备注 + 编码（由 Rust 端生成）。 */
  searchText: string;
}

/** 音色筛选：空串 = 全部。 */
export type ToneFilter = "" | "散" | "泛" | "按";

/** 组合筛选条件（与 Rust `DictFilter` 同形）。 */
export interface DictFilter {
  tone: ToneFilter;
  /** 空串 = 全部；否则为左手指法分组 label（大指/名指/…）。 */
  left: string;
  /** 空串 = 全部；否则为右手指法分组 label（勾/挑/…/抹挑）。 */
  action: string;
  /** 空串 = 全部；否则为「一」~「七」。 */
  string: string;
  /** 自由文本：匹配读法 / 部件 / 备注。 */
  query: string;
}

export const EMPTY_FILTER: DictFilter = {
  tone: "",
  left: "",
  action: "",
  string: "",
  query: "",
};

/** 左手指法筛选维度标签（实际匹配在 Rust 端按 label 分组）。 */
export const LEFT_FILTERS: string[] = ["大指", "名指", "中指", "食指", "跪指"];

/** 右手指法筛选维度标签：单指法 + 复合指法。 */
export const ACTION_FILTERS: string[] = [
  "勾",
  "挑",
  "抹",
  "托",
  "打",
  "剔",
  "摘",
  "劈",
  "抹挑",
  "勾剔",
  "抹勾",
  "打摘",
];

/** 弦序筛选维度标签。 */
export const STRING_FILTERS: string[] = ["一", "二", "三", "四", "五", "六", "七"];

// ──────────────────────────────────────────────
// 量化分析 —— 字频统计 / 变体归并（Rust `jianzi_stats` 模块）
// ──────────────────────────────────────────────

/**
 * 一条字频统计行（Rust 端按**归一化字形**聚合后返回）。
 *
 * `id` 已把 名/夕、食/亻、省写（勹/乚/木/丁…）折算成同一写法，
 * 因此「同一个字的多种写法」会合并到同一行；原始写法回列在
 * `leftVariants` / `actionVariants` 里，供展示「这个字有几种变体」。
 */
export interface JianziFreqRow {
  /** 归一化字形（如「大九勾四」「散勾三」）。 */
  id: string;
  /** 人话读法（如「按音 大指 九徽 勾 四弦」）。 */
  label: string;
  /** 出现次数。 */
  count: number;
  /** 占比 0–1，相对总有效音符数。 */
  ratio: number;
  toneType: NoteType;
  leftFinger: string | null;
  rightAction: string | null;
  hui: string | null;
  fen: string | null;
  slide: SlideMark | null;
  stringNumber: string | null;
  /** 出现过的原始左手指法写法（如 ["名","夕"]）。 */
  leftVariants: string[];
  /** 出现过的原始右手指法写法（如 ["勾","勹"]）。 */
  actionVariants: string[];
}

/** 字频统计结果。 */
export interface FreqResult {
  /** 参与统计的有效音符总数。 */
  total: number;
  /** 按次数降序的减字行。 */
  rows: JianziFreqRow[];
}

/** 一种指法的写法变体对照（直接回应「每个字有多少变体」）。 */
export interface VariantGroup {
  /** 归并后的规范写法。 */
  canonical: string;
  /** 变体形态（含规范写法自身）。 */
  variants: string[];
  /** 说明（省写规则 / 同指异写）。 */
  note: string;
}

/** 一条码的解析结果：要么给出减字，要么给出读不通的原因（两者互斥）。 */
export interface DecodedJianzi {
  /** 从被粘文本里切出来的原始片段（小写，可能带时值标注，如 `ad9g4:8.`）。 */
  code: string;
  /** 解出的减字；读不通时为 null（休止符也为 null）。 */
  state: JianziState | null;
  /** 读不通的原因（如「码要以音色前缀开头（s/f/a）」）。 */
  error: string | null;
  /**
   * 码尾标注的时值（「四分」「八分」…）；没标为 null，调用方按四分处理。
   *
   * 减字码本身只描述「怎么按」，节奏靠这个后缀跟着谱一起搬。
   */
  duration: Duration | null;
  /** 附点（时值 × 1.5）。 */
  dotted: boolean;
  /** 休止符（`r`）——没有减字，但占时值。 */
  isRest: boolean;
}

/**
 * 批量解码结果。
 *
 * `total` 是切出来的码数，`ok`/`failed` 是其中成/败的条数——
 * 有了这三个数，UI 才能说清「粘了 12 条，8 条入谱，4 条读不通」。
 */
export interface DecodeBatchResult {
  total: number;
  ok: number;
  failed: number;
  entries: DecodedJianzi[];
}
