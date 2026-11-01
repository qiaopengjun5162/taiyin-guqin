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

/**
 * 分位 → 字体拼装用的字形字符。
 *
 * 这是减字谱字体的一条硬规则：徽位后面的分数在**减字里只写数字**，
 * 不写「分」字——「七徽六分」的减字是「七」下压一个「六」。
 * 若把「六分」整串塞进去，字体找不到对应部件，整块会被撑开散架
 * （线上实测：选「六分」后「勹」被挤到格子外）。
 */
const FEN_GLYPH: Record<string, string> = {
  "一分": "一", "二分": "二", "三分": "三", "四分": "四", "五分": "五",
  "六分": "六", "七分": "七", "八分": "八", "九分": "九", "半": "半",
};

/** 分位取值 → 减字字形（找不到映射时退回去掉「分」字）。 */
export function fenToGlyph(fen: string): string {
  return FEN_GLYPH[fen] ?? fen.replace(/分$/, "");
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
  // 十一～十三徽是两字徽位。字体把「十三」当成一个徽位部件后，
  // 紧跟的数字会被当成下一个字符另起一块，整字被撑开；
  // 中间补一个「徽」字，字体才把分数收进同一象限（实测四种写法对比选定）。
  if (jianzi.hui && jianzi.hui.length > 1 && jianzi.fen) text += "徽";
  if (jianzi.fen) text += fenToGlyph(jianzi.fen);
  if (jianzi.rightAction)
    text += RIGHT_ACTION_GLYPH[jianzi.rightAction] ?? jianzi.rightAction;
  if (jianzi.stringNumber) text += jianzi.stringNumber;
  return text;
}

/** 已知的徽数字集：一～九 为单位数，十/十一/十二/十三 另判 */
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
]);
/** 徽位后可能紧跟的分位数字（一分～九分 在减字里只写数字） */
const FEN_DIGITS = new Set(["一", "二", "三", "四", "五", "六", "七", "八", "九"]);
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
  // 传统减字偏旁写法：亻 = 食指（取"食"左半）、夕 = 名指（取"名"左半）。
  // 与全字写法（食/名）一并支持，粘贴传统谱本时才不会解析失败。
  for (const name of ["大", "名", "夕", "中", "食", "亻", "跪"]) {
    if (remaining.startsWith(name)) {
      result.leftFinger = name;
      remaining = remaining.slice(name.length);
      break;
    }
  }

  // 3. 徽位数字
  //    十一/十二/十三 是两个字；其余是一位。不能贪心吃光连续数字，
  //    否则「大七六勾四」（七徽六分）会被读成徽位「七六」。
  let huiBuf = "";
  if (remaining.startsWith("十")) {
    const second = remaining[1];
    if (second === "一" || second === "二" || second === "三") {
      huiBuf = remaining.slice(0, 2);
      remaining = remaining.slice(2);
    } else {
      huiBuf = "十";
      remaining = remaining.slice(1);
    }
  } else if (remaining.length > 0 && HUI_CHARS.has(remaining[0])) {
    huiBuf = remaining[0];
    remaining = remaining.slice(1);
  }
  if (huiBuf) result.hui = huiBuf;

  // 4. 分
  //    减字里分数只写数字（七徽六分 → 「大七六勾四」），也兼容旧写法「六分」。
  //    两字徽位后可能带一个「徽」分隔字（见 jianziToText 的说明），先跳过。
  if (remaining.startsWith("徽")) remaining = remaining.slice(1);
  if (remaining.startsWith("半")) {
    result.fen = "半";
    remaining = remaining.slice(1);
  } else if (remaining.length > 0 && FEN_DIGITS.has(remaining[0])) {
    result.fen = `${remaining[0]}分`;
    remaining = remaining.slice(1);
    if (remaining.startsWith("分")) remaining = remaining.slice(1);
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
