import type { JianziState, Duration } from "./types";

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
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    rightAction: null,
    stringNumber: null,
  };
}

/** 键盘显示字符 → 字体 GSUB 引擎期望的触发字符 */
const RIGHT_ACTION_GLYPH: Record<string, string> = {
  勹: "勾",
  木: "抹",
  乚: "挑",
  乇: "托",
  丁: "打",
  尸: "擘",
  倽: "摘",
  剔: "剔",
};

/** 将减字状态序列化为忘机减字谱字体可渲染的文本 */
export function jianziToText(jianzi: JianziState): string {
  // 散音："散"作为左侧前缀，不参与主体连字组
  if (jianzi.toneType === "散") {
    let s = "散";
    if (jianzi.rightAction)
      s += RIGHT_ACTION_GLYPH[jianzi.rightAction] ?? jianzi.rightAction;
    if (jianzi.stringNumber) s += jianzi.stringNumber;
    return s;
  }

  let text = "";

  // 泛音：加空格阻断字体 GSUB 上下文劫持，使"泛"和后续指法独立渲染
  if (jianzi.toneType === "泛") {
    text += "泛 ";
  }

  if (jianzi.leftFinger) text += jianzi.leftFinger;
  if (jianzi.hui) text += jianzi.hui;
  if (jianzi.fen) text += jianzi.fen;
  if (jianzi.rightAction)
    text += RIGHT_ACTION_GLYPH[jianzi.rightAction] ?? jianzi.rightAction;
  if (jianzi.stringNumber) text += jianzi.stringNumber;
  return text;
}

/** 已知的徽数字集 */
const HUI_CHARS = new Set([
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
]);
/** 弦序字符集 */
const STRING_CHARS = new Set(["一", "二", "三", "四", "五", "六", "七"]);

/** 将文本（如"大九勾四"）解析为减字状态 */
export function parseJianziText(text: string): JianziState | null {
  if (!text.trim()) return null;
  const result = createEmptyState();

  let remaining = text.trim();
  let idx = 0;

  // 1. 音色前缀
  if (remaining.startsWith("散")) {
    result.toneType = "散";
    idx = 1;
  } else if (remaining.startsWith("泛")) {
    result.toneType = "泛";
    idx = 1;
  } else {
    result.toneType = "按";
  }

  remaining = remaining.slice(idx).trim();

  // 散音：只需要右手指法 + 弦序
  if (result.toneType === "散") {
    for (const name of [
      "勾",
      "挑",
      "抹",
      "劈",
      "托",
      "剔",
      "打",
      "摘",
      "乇",
      "尸",
      "木",
      "乚",
      "勹",
      "丁",
      "倽",
    ]) {
      if (remaining.startsWith(name)) {
        result.rightAction = name;
        remaining = remaining.slice(name.length);
        break;
      }
    }
    // 剩下的就是弦序
    if (remaining && STRING_CHARS.has(remaining)) {
      result.stringNumber = remaining;
    }
    return result;
  }

  // 2. 左手指法
  for (const name of ["大", "名", "中", "食", "跪"]) {
    if (remaining.startsWith(name)) {
      result.leftFinger = name;
      remaining = remaining.slice(name.length);
      break;
    }
  }

  // 3. 徽位数字
  let huiBuf = "";
  while (remaining.length > 0 && HUI_CHARS.has(remaining[0])) {
    huiBuf += remaining[0];
    remaining = remaining.slice(1);
  }
  if (huiBuf) result.hui = huiBuf;

  // 4. 分
  for (const fen of ["三分", "六分", "八分", "半"]) {
    if (remaining.startsWith(fen)) {
      result.fen = fen;
      remaining = remaining.slice(fen.length);
      break;
    }
  }

  // 5. 右手指法
  const allActions = [
    "勾剔",
    "抹挑",
    "打摘",
    "抹勾",
    "仰托",
    "勾",
    "挑",
    "抹",
    "劈",
    "托",
    "剔",
    "打",
    "摘",
    "乇",
    "尸",
    "木",
    "乚",
    "勹",
    "丁",
    "倽",
  ];
  for (const name of allActions) {
    if (remaining.startsWith(name)) {
      result.rightAction = name;
      remaining = remaining.slice(name.length);
      break;
    }
  }

  // 6. 弦序
  if (remaining && STRING_CHARS.has(remaining)) {
    result.stringNumber = remaining;
  }

  return isComplete(result) ? result : null;
}

/** 根据时值获取减时线数量 */
export function getRhythmLineCount(duration: Duration): number {
  switch (duration) {
    case "全":
    case "二分":
      return 0;
    case "四分":
      return 1;
    case "八分":
      return 2;
    case "十六分":
      return 3;
  }
}

/** 将时值转换为以四分音符为 1 拍的拍数；dotted 为附点（×1.5）。 */
export function durationToBeats(duration: Duration, dotted = false): number {
  let beats: number;
  switch (duration) {
    case "全":
      beats = 4;
      break;
    case "二分":
      beats = 2;
      break;
    case "四分":
      beats = 1;
      break;
    case "八分":
      beats = 0.5;
      break;
    case "十六分":
      beats = 0.25;
      break;
  }
  return dotted ? beats * 1.5 : beats;
}
