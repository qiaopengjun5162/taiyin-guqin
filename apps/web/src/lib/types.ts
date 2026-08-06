/// <reference types="react" />

/** 音色类型——散音（空弦）、泛音、按音（按弦）。 */
export type NoteType = "散" | "泛" | "按";

/** 节奏模式——决定时值的解释方式。 */
export type RhythmMode = "板" | "散" | "宕";

/** 减字键盘状态——一个正在拼装中的谱字。 */
export interface JianziState {
  toneType: NoteType | null;
  rhythmMode: RhythmMode | null;
  leftFinger: string | null;
  hui: string | null;
  fen: string | null;
  rightAction: string | null;
  stringNumber: string | null;
}

/** 键盘配置：每个分区可选的按键列表。 */
export interface KeyboardConfig {
  toneTypes: NoteType[];
  rhythmModes: RhythmMode[];
  leftFingers: string[];
  huiPositions: string[];
  fenOptions: string[];
  rightActions: string[];
  stringNumbers: string[];
}

/**
 * 预设：古琴正调标准按键。
 *
 * 左手指法采用传统减字偏旁写法：
 * - 亻 = 食指（取"食"的左半）
 * - 夕 = 名指（取"名"的左半）
 *
 * 节奏模式：
 * - 板 = 严格节拍（入拍）
 * - 散 = 自由节奏（散板/入乱）
 * - 宕 = 跌宕（变换拍子）
 */
export const DEFAULT_KEYBOARD: KeyboardConfig = {
  toneTypes: ["散", "泛", "按"],
  rhythmModes: ["板", "散", "宕"],
  leftFingers: ["大", "夕", "中", "亻", "跪"],
  huiPositions: ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"],
  fenOptions: ["三分", "六分", "八分", "半"],
  // 传统减字偏旁写法：乇=托 尸=劈/擘 木=抹 乚=挑 勹=勾 剔 丁=打 倽=摘
  rightActions: ["乇", "尸", "木", "乚", "勹", "剔", "丁", "倽"],
  stringNumbers: ["一", "二", "三", "四", "五", "六", "七"],
};

// ──────────────────────────────────────────────
// 乐谱流类型
// ──────────────────────────────────────────────

/** 简谱数字（0 为休止符） */
export type JianpuNumber = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7";

/** 时值 */
export type Duration = "全" | "二分" | "四分" | "八分" | "十六分";

/** 简谱八度标记：· 高八度，, 低八度 */
export type JianpuOctave = "" | "·" | ",";

/** 单个复合音符列 —— 简谱 + 减字 + 时值的垂直组合 */
export interface NoteColumn {
  id: string;
  jianpuNumber: JianpuNumber | null;
  jianpuOctave: JianpuOctave;
  jianpuDot: boolean;
  duration: Duration;
  jianzi: JianziState;
}

/** 默认简谱数字列表 */
export const DEFAULT_JIANPU_NUMBERS: JianpuNumber[] = [
  "1", "2", "3", "4", "5", "6", "7",
];

/** 默认时值列表 */
export const DEFAULT_DURATIONS: Duration[] = [
  "全", "二分", "四分", "八分", "十六分",
];
