/// <reference types="react" />

/** 减字键盘状态——一个正在拼装中的谱字。 */
export interface JianziState {
  leftFinger: string | null;
  hui: string | null;
  fen: string | null;
  rightAction: string | null;
  stringNumber: string | null;
}

/** 键盘配置：每个分区可选的按键列表。 */
export interface KeyboardConfig {
  leftFingers: string[];
  huiPositions: string[];
  fenOptions: string[];
  rightActions: string[];
  stringNumbers: string[];
}

/** 预设：古琴正调标准按键。 */
export const DEFAULT_KEYBOARD: KeyboardConfig = {
  leftFingers: ["大", "名", "中", "食", "跪"],
  huiPositions: ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"],
  fenOptions: ["三分", "六分", "八分"],
  rightActions: ["挑", "勾", "抹", "剔", "托", "擘", "打", "摘"],
  stringNumbers: ["一", "二", "三", "四", "五", "六", "七"],
};

/** 判断减字是否已完成（四个核心字段都选了）。 */
export function isComplete(state: JianziState): boolean {
  return (
    state.leftFinger !== null &&
    state.hui !== null &&
    state.rightAction !== null &&
    state.stringNumber !== null
  );
}

/** 创建空状态。 */
export function createEmptyState(): JianziState {
  return {
    leftFinger: null,
    hui: null,
    fen: null,
    rightAction: null,
    stringNumber: null,
  };
}
