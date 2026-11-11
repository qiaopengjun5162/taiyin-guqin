/**
 * 减字 → 人话释义。
 *
 * 录入减字只是第一步；琴友拿起一张谱，真正要回答的是「这个字怎么弹」。
 * 本模块把 JianziState 拆成听得到的句子：
 *
 *   大七六勾四 → 按音 · 大指按于四弦七徽六分，右手中指勾弦
 *
 * 释义只做「读谱」——指法名称、手指、按弦位置、弦序、大致音高，
 * 不涉及吟猱绰注等风格性处理（那些靠师授，不宜由程序断言）。
 */

import type { JianziState } from "./types";
import { chineseNumToHui, huiFraction, jianziToJianpu, type PitchContext } from "./jianzi-pitch";
import { DEFAULT_TUNING, getTuningById, openStringMidi } from "./tuning";

export interface ExplainPart {
  /** 分组名：音色 / 左手 / 徽位 / 右手 / 弦序 */
  label: string;
  text: string;
}

export interface JianziExplanation {
  /** 是否已构成一个完整可弹的减字 */
  complete: boolean;
  /** 一句话读法（完整时）；不完整时为空串 */
  summary: string;
  /** 逐项拆解，便于对照谱字 */
  parts: ExplainPart[];
  /** 大致音高，如「简谱 5 · 约 196.0 Hz」；推不出时为空 */
  pitchHint: string | null;
  /** 还缺哪些槽位（中文名），完整时为空数组 */
  missing: string[];
}

// ──────────────────────────────────────────────
// 指法字典
// ──────────────────────────────────────────────

/**
 * 装饰记号读法，21 个必须全覆盖。
 *
 * 旧写法是「三选一，else 就是急」——扩到 21 个之后，任何一个吟猱记号
 * 都会被读成「急（急弹…）」，谱面没错、释义全错。所以改成显式表，
 * 并有测试逐个断言 `SLIDE_MARKS` 都登记了，漏一个就红。
 * 吟猱属广义走手音，故归到「走手音」组；只有「急」单列「弹法」。
 */
const SLIDE_EXPLAIN: Record<string, ExplainPart> = {
  绰: { label: "走手音", text: "绰（从本位下方滑上来，落到这个徽位）" },
  注: { label: "走手音", text: "注（从本位上方滑下来，落到这个徽位）" },
  急: { label: "弹法", text: "急（急弹：这一声弹得急促，音高不变——节奏仍按所填时值）" },
  吟: { label: "走手音", text: "吟（得音后指在本位作细微往复颤动，音高微微波动）" },
  猱: { label: "走手音", text: "猱（幅度比吟大、速度较缓的往复，苍劲有余韵）" },
  绰吟: { label: "走手音", text: "绰吟（从本位下方滑上来，到位后作吟）" },
  绰猱: { label: "走手音", text: "绰猱（从本位下方滑上来，到位后作猱）" },
  注吟: { label: "走手音", text: "注吟（从本位上方滑下来，到位后作吟）" },
  注猱: { label: "走手音", text: "注猱（从本位上方滑下来，到位后作猱）" },
  细吟: { label: "走手音", text: "细吟（幅度小而密的吟）" },
  细猱: { label: "走手音", text: "细猱（幅度收窄的猱）" },
  游吟: { label: "走手音", text: "游吟（音位从容游移的吟）" },
  游猱: { label: "走手音", text: "游猱（音位游移、幅度较大的猱）" },
  荡吟: { label: "走手音", text: "荡吟（来回荡漾的吟）" },
  荡猱: { label: "走手音", text: "荡猱（来回荡漾、幅度较大的猱）" },
  飞吟: { label: "走手音", text: "飞吟（迅疾掠过的吟）" },
  飞猱: { label: "走手音", text: "飞猱（迅疾掠过、幅度较大的猱）" },
  圆吟: { label: "走手音", text: "圆吟（圆转无棱角的吟）" },
  圆猱: { label: "走手音", text: "圆猱（圆转无棱角的猱）" },
  定吟: { label: "走手音", text: "定吟（本位不移动、指力微颤的吟）" },
  定猱: { label: "走手音", text: "定猱（本位不移动而幅度内收的猱）" },
};

/** 左手指法：减字偏旁 → 名称与补充说明 */
const LEFT_FINGERS: Record<string, { name: string; note?: string }> = {
  大: { name: "大指", note: "拇指" },
  食: { name: "食指" },
  亻: { name: "食指" },
  中: { name: "中指" },
  名: { name: "名指", note: "即无名指" },
  夕: { name: "名指", note: "即无名指" },
  跪: { name: "跪指", note: "名指屈起第一关节，以指背按弦" },
};

export interface RightAction {
  name: string;
  finger: string;
  /** 拨弦方向：内 = 朝自己身体一侧，外 = 离身一侧 */
  direction: "内" | "外" | null;
  /** 复合指法等额外说明 */
  note?: string;
}

/** 右手指法：减字偏旁与全字都收，粘贴传统谱本时同样能解释 */
const RIGHT_ACTIONS: Record<string, RightAction> = {
  乇: { name: "托", finger: "大指", direction: "外" },
  托: { name: "托", finger: "大指", direction: "外" },
  尸: { name: "擘", finger: "大指", direction: "内" },
  擘: { name: "擘", finger: "大指", direction: "内" },
  劈: { name: "擘", finger: "大指", direction: "内" },
  木: { name: "抹", finger: "食指", direction: "内" },
  抹: { name: "抹", finger: "食指", direction: "内" },
  乚: { name: "挑", finger: "食指", direction: "外" },
  挑: { name: "挑", finger: "食指", direction: "外" },
  勹: { name: "勾", finger: "中指", direction: "内" },
  勾: { name: "勾", finger: "中指", direction: "内" },
  剔: { name: "剔", finger: "中指", direction: "外" },
  丁: { name: "打", finger: "无名指", direction: "内" },
  打: { name: "打", finger: "无名指", direction: "内" },
  倽: { name: "摘", finger: "无名指", direction: "外" },
  摘: { name: "摘", finger: "无名指", direction: "外" },
  // 复合指法（字体 GSUB 支持的四组，另加文本兼容的仰托）
  抹挑: {
    name: "抹挑",
    finger: "食指",
    direction: null,
    note: "先抹后挑，一弦连得两声",
  },
  勾剔: {
    name: "勾剔",
    finger: "中指",
    direction: null,
    note: "先勾后剔，一弦连得两声",
  },
  抹勾: {
    name: "抹勾",
    finger: "食指、中指",
    direction: null,
    note: "食指抹、中指勾，两指相接",
  },
  打摘: {
    name: "打摘",
    finger: "无名指",
    direction: null,
    note: "先打后摘，一弦连得两声",
  },
  仰托: {
    name: "仰托",
    finger: "大指",
    direction: "外",
    note: "字体无此连字，仅作文本兼容",
  },
};

/**
 * 左手指法查表。琴面图与文字释义共用这一份，
 * 免得两处各写一套「夕 = 名指」，改一处漏一处。
 */
export function leftFingerInfo(finger: string | null): { name: string; note?: string } | null {
  if (!finger) return null;
  return LEFT_FINGERS[finger] ?? null;
}

/** 右手指法查表（含复合指法）。 */
export function rightActionInfo(action: string | null): RightAction | null {
  if (!action) return null;
  return RIGHT_ACTIONS[action] ?? null;
}

/** 弦序补充：首尾两弦点明粗细高低，中间弦不必啰嗦 */
const STRING_NOTES: Record<string, string> = {
  一: "最粗、最低",
  七: "最细、最高",
};

/** 徽位里几个有明确分数含义的，直接说出来；其余给百分比 */
const HUI_NOTES: Record<number, string> = {
  1: "弦长 1/8 处",
  4: "弦长 1/4 处",
  5: "弦长 1/3 处",
  7: "弦的正中（1/2 处）",
  9: "弦长 2/3 处",
  10: "弦长 3/4 处",
  13: "弦长 7/8 处",
};

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const HUI_CN = [
  "",
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
  "十一",
  "十二",
  "十三",
];

/** 徽位 + 分位 → 位置描述，如「七徽六分（七徽与八徽之间，过七徽六成）」 */
export function describeHuiPosition(hui: string | null, fen: string | null): string | null {
  if (!hui) return null;
  const huiNum = chineseNumToHui(hui);
  if (huiNum == null) return null;

  const base = `${hui}徽`;
  if (!fen) {
    const note = HUI_NOTES[huiNum];
    return note ? `${base} · ${note}` : base;
  }

  if (fen === "半") {
    if (huiNum < 13) {
      return `${base}半 · ${hui}徽与${HUI_CN[huiNum + 1]}徽的正中`;
    }
    return `${base}外半位 · 再往龙龈方向半位`;
  }

  const digit = fen.replace(/分$/, "");
  const n = CN_DIGIT[digit];
  if (n == null) return `${base}${fen}`;

  if (huiNum < 13) {
    return `${base}${fen} · ${hui}徽与${HUI_CN[huiNum + 1]}徽之间，过${hui}徽 ${n} 成`;
  }
  // 十三徽外还有一小段弦，分位按上一间隔外推
  return `${base}${fen} · 再往龙龈方向 ${n} 成`;
}

/** 徽位 + 分位 → 距岳山的弦长百分比描述 */
function positionPercent(hui: string | null, fen: string | null): string | null {
  if (!hui) return null;
  const huiNum = chineseNumToHui(hui);
  if (huiNum == null) return null;
  const p = huiFraction(huiNum, fen);
  if (p == null || p <= 0 || p >= 1) return null;
  return `距岳山约 ${(p * 100).toFixed(1)}% 弦长处`;
}

/** 简谱八度标记 → 口语 */
function octaveText(octave: string): string {
  switch (octave) {
    case "·":
      return "高八度";
    case "··":
      return "高两个八度";
    case ",":
      return "低八度";
    case ",,":
      return "低两个八度";
    default:
      return "";
  }
}

const MISSING_LABEL: Record<string, string> = {
  toneType: "音色",
  leftFinger: "左手指法",
  hui: "徽位",
  rightAction: "右手指法",
  stringNumber: "弦序",
};

/** 缺失槽位（散音不要左手指法与徽位） */
function missingSlots(state: JianziState): string[] {
  const missing: string[] = [];
  if (!state.toneType) missing.push("toneType");
  if (state.toneType !== "散") {
    if (!state.leftFinger) missing.push("leftFinger");
    if (!state.hui) missing.push("hui");
  }
  if (!state.rightAction) missing.push("rightAction");
  if (!state.stringNumber) missing.push("stringNumber");
  return missing;
}

/** 右手描述，如「中指勾（朝自己一侧拨弦）」 */
export function describeRightAction(rightAction: string | null): string | null {
  if (!rightAction) return null;
  const action = RIGHT_ACTIONS[rightAction];
  if (!action) return rightAction;
  const dir =
    action.direction === "内"
      ? "朝自己一侧拨弦"
      : action.direction === "外"
        ? "离身一侧拨弦"
        : null;
  const tail = action.note ?? dir;
  return tail ? `${action.finger}${action.name}（${tail}）` : `${action.finger}${action.name}`;
}

/** 候选音位的短标签：谱字旁边两行小字 + 读屏用的完整描述。 */
export interface ShortCaption {
  /** 第一行：弦 + 音位，如「五弦 · 十徽」「一弦 · 散」 */
  primary: string;
  /** 第二行：指法，如「大指按 · 中指勾」 */
  secondary: string;
  /** 读屏/无障碍名：一句话说清这个音怎么弹 */
  full: string;
}

/** 徽位 + 分位 → 极简写法（七徽六分 → 七徽六；十三徽半 → 十三徽半） */
function shortHui(hui: string | null, fen: string | null): string {
  if (!hui) return "";
  const fenText = fen ? (fen === "半" ? "半" : fen.replace(/分$/, "")) : "";
  return `${hui}徽${fenText}`;
}

/**
 * 候选音位的短标签。
 *
 * 候选列表里一个音可能有十几个位置，名字太长就扫不动：第一行只留
 * 「几弦 · 几徽」，第二行只留「谁按、谁弹」，完整读法留给 title/读屏。
 */
export function shortCaption(state: JianziState): ShortCaption {
  const stringText = state.stringNumber ? `${state.stringNumber}弦` : "";
  const action = state.rightAction ? RIGHT_ACTIONS[state.rightAction] : undefined;
  const rightText = action ? `${action.finger}${action.name}` : (state.rightAction ?? "");
  const finger = state.leftFinger ? LEFT_FINGERS[state.leftFinger] : undefined;
  const fingerText = finger?.note ? finger.name : (finger?.name ?? state.leftFinger ?? "");

  if (state.toneType === "散") {
    return {
      primary: [stringText, "散"].filter(Boolean).join(" · "),
      secondary: rightText,
      full: `散音，${stringText || "未定弦"}，右手${rightText || "未定指法"}`,
    };
  }

  const pos = shortHui(state.hui, state.fen);
  const touch = state.toneType === "泛" ? "轻触" : "按";
  // 卡片一行只有六七十像素：短标签用单字「泛 / 按」，完整读法里再写「轻触」
  const touchShort = state.toneType === "泛" ? "泛" : "按";
  return {
    primary: [stringText, pos].filter(Boolean).join(" · "),
    // 第二行只留「谁按 · 谁弹」：左右手由按/弹本身就能读出来，
    // 再写「右手」反而把这一行撑满，卡片宽了反而扫不动。
    secondary: [fingerText ? `${fingerText}${touchShort}` : "", rightText]
      .filter(Boolean)
      .join(" · "),
    full: `${state.toneType ?? ""}音，${fingerText || "未定手指"}${touch}${stringText}${pos}，右手${rightText || "未定指法"}`,
  };
}

/** 减字状态 → 释义。任何时候都能调用，未完成时会告诉你还缺什么。 */
export function explainJianzi(state: JianziState, ctx: PitchContext = {}): JianziExplanation {
  const tuningId = ctx.tuning ?? DEFAULT_TUNING;
  const tuningSpec = getTuningById(tuningId);
  const missingKeys = missingSlots(state);
  const complete = missingKeys.length === 0;
  const parts: ExplainPart[] = [];

  // 音色
  if (state.toneType) {
    const desc =
      state.toneType === "散"
        ? "散音（左手不按弦，取空弦）"
        : state.toneType === "泛"
          ? "泛音（左手轻触徽位，虚按不实）"
          : "按音（左手按实于徽位）";
    parts.push({ label: "音色", text: desc });
  }

  // 左手
  if (state.toneType !== "散" && state.leftFinger) {
    const finger = LEFT_FINGERS[state.leftFinger];
    if (finger) {
      parts.push({
        label: "左手",
        text: finger.note ? `${finger.name}（${finger.note}）` : finger.name,
      });
    } else {
      parts.push({ label: "左手", text: state.leftFinger });
    }
  }

  // 徽位
  if (state.toneType !== "散") {
    const pos = describeHuiPosition(state.hui, state.fen);
    if (pos) {
      const pct = positionPercent(state.hui, state.fen);
      parts.push({ label: "徽位", text: pct ? `${pos}；${pct}` : pos });
    }
  }

  // 绰/注 改变音高走向，急 是弹法，吟猱族是余韵——读法各不相同，全从表取。
  // 表里没有的也不假装是「急」，给一条诚实的兜底（覆盖由测试守着）。
  if (state.toneType !== "散" && state.toneType !== "泛" && state.slide) {
    parts.push(
      SLIDE_EXPLAIN[state.slide] ?? {
        label: "走手音",
        text: `${state.slide}（装饰记号，具体处理依师授）`,
      },
    );
  }

  // 右手
  const right = describeRightAction(state.rightAction);
  if (right) parts.push({ label: "右手", text: right });

  // 弦序：带上这根弦在当前定弦下的空弦音，换过调式的人一眼能对上
  if (state.stringNumber) {
    const note = STRING_NOTES[state.stringNumber];
    const idx = "一二三四五六七".indexOf(state.stringNumber);
    const midi = openStringMidi(state.stringNumber, tuningId);
    const pitch =
      idx >= 0 && midi !== null ? `${tuningSpec.noteNames[idx]} · ${tuningSpec.name}` : "";
    const detail = [pitch, note].filter(Boolean).join("，");
    parts.push({
      label: "弦序",
      text: detail ? `${state.stringNumber}弦（${detail}）` : `${state.stringNumber}弦`,
    });
  }

  // 音高（散/按/泛都能推，按当前定弦与基准音）
  let pitchHint: string | null = null;
  const jianpu = jianziToJianpu(state, ctx);
  if (jianpu) {
    const oct = octaveText(jianpu.octave);
    pitchHint = `简谱 ${jianpu.number}${oct ? `（${oct}）` : ""} · ${tuningSpec.name}推定`;
  }

  // 一句话读法
  let summary = "";
  if (complete && state.toneType && state.rightAction && state.stringNumber) {
    const action = RIGHT_ACTIONS[state.rightAction];
    const actionName = action ? `${action.finger}${action.name}` : state.rightAction;
    if (state.toneType === "散") {
      summary = `散音 · 右手${actionName}${state.stringNumber}弦，左手不按弦`;
    } else {
      const finger = state.leftFinger ? (LEFT_FINGERS[state.leftFinger]?.name ?? state.leftFinger) : "";
      const pos = describeHuiPosition(state.hui, state.fen);
      const posShort = pos ? pos.split(" · ")[0] : "";
      const verb = state.toneType === "泛" ? "轻触" : "按于";
      // 走手音跟在音位后面读才顺：「按于四弦七徽六分（绰）」
      const slideText = state.slide ? `（${state.slide}）` : "";
      summary = `${state.toneType === "泛" ? "泛音" : "按音"} · 左手${finger}${verb}${state.stringNumber}弦${posShort}${slideText}，右手${actionName}`;
    }
  }

  return {
    complete,
    summary,
    parts,
    pitchHint,
    missing: missingKeys.map((k) => MISSING_LABEL[k] ?? k),
  };
}
