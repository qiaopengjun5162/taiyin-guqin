/**
 * 减字 → 人话释义 —— 前端薄壳。
 *
 * 释义逻辑与**全部中文文案**的唯一实现在 Rust：
 * `crates/taiyin-core/src/explain.rs`。
 *
 * ## 为什么文案也搬进核心（2026-11-18 全量迁移）
 *
 * 这个模块最大的资产不是算法，而是文案本身：21 个装饰记号各自的解释、
 * 8 个右手指法的说明、5 个结构记号的气口含义。同一个减字在网页、小程序、App
 * 上必须读出**同一句话**——两处说法不一，用户只会怀疑自己记错了。
 *
 * 改一句文案要重新编译 WASM（秒级），换来的是三端永远不会分家。
 *
 * ## 为什么三张表还留在前端
 *
 * `leftFingerInfo` / `rightActionInfo` / `describeRightAction` 被
 * `qin-fingering`、`score-concordance` 在**同步渲染路径**里调用（画琴面指法图、
 * 算谱例对照），每次走一趟 WASM 往返不划算；而它们只是「偏旁 → 名称」的静态查表。
 *
 * 注意 `rightActionInfo` 的 `direction` 字段仍在这里：`qin-fingering` 靠它
 * 决定箭头朝向（向身 / 离身）。这字段一删，指法图就不再画方向了。
 */

import type { JianziState } from "./types";
import { getWasmSync, isWasmReady } from "./taiyin-wasm";
import type { PitchContext } from "./jianzi-pitch";

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
  /** 大致音高，如「简谱 5 · 正调推定」；推不出时为空 */
  pitchHint: string | null;
  /** 还缺哪些槽位（中文名），完整时为空数组 */
  missing: string[];
}

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

/**
 * 右手指法简表。**只服务同步渲染路径的查表**（名称 / 手指 / 方向）。
 *
 * 完整读法（方向口语化、复合指法说明、兜底）在核心的
 * `describe_right_action` 与 `explain` 里。改这里的名称时别忘了核心那边。
 */
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
  抹挑: { name: "抹挑", finger: "食指", direction: null, note: "先抹后挑，一弦连得两声" },
  勾剔: { name: "勾剔", finger: "中指", direction: null, note: "先勾后剔，一弦连得两声" },
  抹勾: { name: "抹勾", finger: "食指、中指", direction: null, note: "食指抹、中指勾，两指相接" },
  打摘: { name: "打摘", finger: "无名指", direction: null, note: "先打后摘，一弦连得两声" },
  仰托: { name: "仰托", finger: "大指", direction: "外", note: "字体无此连字，仅作文本兼容" },
  轮: { name: "轮", finger: "无名指、中指、食指", direction: null, note: "轮指：三指依次快速摘托挑，一弦连得三声" },
  锁: { name: "锁", finger: "食指、中指", direction: null, note: "锁铃/长锁：抹勾剔连作，三声相系" },
  涓: { name: "涓", finger: "食指", direction: "外", note: "连剔两弦，轻作二声" },
  历: { name: "历", finger: "食指", direction: "外", note: "食指连挑数弦，历历而下" },
  拂: { name: "拂", finger: "食指、中指、无名指", direction: "外", note: "三指依次向外拂过数弦" },
  半扶: { name: "半扶", finger: "食指、中指", direction: "内", note: "半扶：食指抹扶相连，一弦得两声" },
  长锁: { name: "长锁", finger: "食指、中指", direction: null, note: "长锁：抹勾剔连作，三声相系，节奏较长" },
  短锁: { name: "短锁", finger: "食指、中指", direction: null, note: "短锁：抹勾剔短促相连" },
  背锁: { name: "背锁", finger: "食指、中指", direction: null, note: "背锁：反向锁铃，指法相背" },
  圆锁: { name: "圆锁", finger: "食指、中指", direction: null, note: "圆锁：锁铃圆转连贯" },
  半涓: { name: "半涓", finger: "食指", direction: "内", note: "半涓：抹勾相连，一弦得两声" },
  反涓: { name: "反涓", finger: "食指", direction: "内", note: "反涓：反向涓，指法倒用" },
  叠涓: { name: "叠涓", finger: "食指", direction: "内", note: "叠涓：涓法叠加，声繁" },
  连涓: { name: "连涓", finger: "食指", direction: "内", note: "连涓：涓法连作，声相续" },
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

/** 右手描述，如「中指勾（朝自己一侧拨弦）」。 */
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

/**
 * 徽位 + 分位 → 位置描述，如「七徽六分 · 七徽与八徽之间，过七徽 6 成」。
 *
 * 文案在核心 `explain.rs::describe_hui_position`——它同时被
 * `explainJianzi` 的「徽位」项和一句话读法使用，抠出来单独导出是为了
 * 让上游能只问位置、不问整个减字。
 */
export function describeHuiPosition(hui: string | null, fen: string | null): string | null {
  if (!hui) return null;
  if (!isWasmReady()) return null;
  const out = getWasmSync().describe_hui_position(JSON.stringify({ hui, fen: fen ?? null }));
  // 核心对未知徽位返回空串，前端一贯的契约是 null
  return out && !out.includes('"error"') ? out : null;
}

/**
 * 5 个谱面结构记号及其释义。
 *
 * 结构记号与减字四宫格无关（气口 / 反复 / 入拍），文案同样只在核心一份。
 * 引擎未就绪时返回空表——调用方据此不展示这一组，而不是显示半截文案。
 */
export function structureMarkExplain(): Record<string, ExplainPart> {
  if (!isWasmReady()) return {};
  try {
    return JSON.parse(getWasmSync().structure_marks()) as Record<string, ExplainPart>;
  } catch {
    return {};
  }
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

// ──────────────────────────────────────────────
// 转发到核心
// ──────────────────────────────────────────────

/** 把状态与上下文打包成核心要的 JSON。 */
function wire(state: JianziState, ctx: PitchContext): string {
  return JSON.stringify({
    state: {
      toneType: state.toneType ?? null,
      leftFinger: state.leftFinger ?? null,
      hui: state.hui ?? null,
      fen: state.fen ?? null,
      slide: state.slide ?? null,
      rightAction: state.rightAction ?? null,
      stringNumber: state.stringNumber ?? null,
      structureMark: state.structureMark ?? null,
    },
    tuning: ctx.tuning,
    concertPitch: ctx.concertPitch,
  });
}

/** 引擎未就绪时的空结果——那是**诚实**的空，不是编一段可能错的读法。 */
const EMPTY_EXPLANATION: JianziExplanation = {
  complete: false,
  summary: "",
  parts: [],
  pitchHint: null,
  missing: [],
};

const EMPTY_CAPTION: ShortCaption = { primary: "", secondary: "", full: "" };

/** 减字状态 → 释义。任何时候都能调用，未完成时会告诉你还缺什么。 */
export function explainJianzi(state: JianziState, ctx: PitchContext = {}): JianziExplanation {
  if (!isWasmReady()) return EMPTY_EXPLANATION;
  const parsed = JSON.parse(getWasmSync().explain_jianzi(wire(state, ctx))) as Record<
    string,
    unknown
  >;
  if (typeof parsed.error === "string") return EMPTY_EXPLANATION;
  return {
    complete: Boolean(parsed.complete),
    summary: (parsed.summary as string) ?? "",
    parts: (parsed.parts as ExplainPart[]) ?? [],
    pitchHint: (parsed.pitchHint as string | null) ?? null,
    missing: (parsed.missing as string[]) ?? [],
  };
}

/**
 * 候选音位的短标签。
 *
 * 候选列表里一个音可能有十几个位置，名字太长就扫不动：第一行只留
 * 「几弦 · 几徽」，第二行只留「谁按、谁弹」，完整读法留给 title/读屏。
 */
export function shortCaption(state: JianziState): ShortCaption {
  if (!isWasmReady()) return EMPTY_CAPTION;
  const parsed = JSON.parse(getWasmSync().short_caption(wire(state, {}))) as Record<
    string,
    unknown
  >;
  if (typeof parsed.error === "string") return EMPTY_CAPTION;
  return {
    primary: (parsed.primary as string) ?? "",
    secondary: (parsed.secondary as string) ?? "",
    full: (parsed.full as string) ?? "",
  };
}
