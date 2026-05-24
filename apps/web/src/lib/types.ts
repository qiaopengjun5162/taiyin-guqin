/// <reference types="react" />

/** 音色类型——散音（空弦）、泛音、按音（按弦）。 */
export type NoteType = "散" | "泛" | "按";

/** 减字键盘状态——一个正在拼装中的谱字。 */
export interface JianziState {
  toneType: NoteType | null;
  leftFinger: string | null;
  hui: string | null;
  fen: string | null;
  rightAction: string | null;
  stringNumber: string | null;
}

/** 键盘配置：每个分区可选的按键列表。 */
export interface KeyboardConfig {
  toneTypes: NoteType[];
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
 */
export const DEFAULT_KEYBOARD: KeyboardConfig = {
  toneTypes: ["散", "泛", "按"],
  leftFingers: ["大", "夕", "中", "亻", "跪"],
  huiPositions: ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"],
  fenOptions: ["三分", "六分", "八分"],
  rightActions: ["挑", "勾", "抹", "剔", "托", "擘", "打", "摘"],
  stringNumbers: ["一", "二", "三", "四", "五", "六", "七"],
};

/** 判断减字是否已完成（各音色类型所需字段不同）。 */
export function isComplete(state: JianziState): boolean {
  // 散音：只需要右手指法和弦序
  if (state.toneType === "散") {
    return state.rightAction !== null && state.stringNumber !== null;
  }
  // 泛音、按音：需要左手指法 + 徽位 + 右手指法 + 弦序
  return (
    state.toneType !== null &&
    state.leftFinger !== null &&
    state.hui !== null &&
    state.rightAction !== null &&
    state.stringNumber !== null
  );
}

/** 创建空状态。 */
export function createEmptyState(): JianziState {
  return {
    toneType: null,
    leftFinger: null,
    hui: null,
    fen: null,
    rightAction: null,
    stringNumber: null,
  };
}
