/**
 * 减字「连打」解析器 —— 前端薄壳。
 *
 * 文法与码表的**唯一实现**在 Rust：`crates/taiyin-core/src/jianzi_rapid.rs`。
 * 这里只做三件事：调 WASM（网页，零延迟）、把 JSON 转成 TS 形状、提供文案。
 *
 * 为什么不再在 TS 里写第二份：原先这里有一张 101 条的 `TOKENS` 码表，与 Rust
 * `jianzi_code.rs` 各存一份，注释自己写着「三处增删必须一起改」。加一个指法要改
 * 三处、漏一处就只有一个客户端打不出来——这正是把逻辑收进核心的理由。
 *
 * 非浏览器客户端（App / 小程序 / 第三方）走同一份逻辑的 HTTP 出口：
 * `POST /api/v1/jianzi/rapid-parse`。
 *
 * 文法速记（详见 Rust 模块文档）：
 *   散音：右手 + 弦序 + [结构记号]
 *   泛音：左手 + 徽位 + [分] + 右手 + 弦序 + [结构记号]
 *   按音：左手 + 徽位 + [分] + [走手音] + 右手 + 弦序 + [结构记号]
 *   例：g4 = 散勾四；djg4 = 大九勾四；d9f6cg4 = 大九六分绰勾四
 */

import type { JianziState, NoteType } from "./types";
import { getWasmSync, isWasmReady } from "./taiyin-wasm";

/** 连打槽位：与减字书写顺序一致 */
export type RapidSlot =
  | "toneType"
  | "leftFinger"
  | "hui"
  | "fen"
  | "slide"
  | "rightAction"
  | "stringNumber"
  | "structureMark";

/**
 * 各音色的槽位顺序。
 *
 * 这是 **WASM 未就绪时的回退值**（首帧、SSR、测试替身）；真值以 Rust 的
 * `slots_for_tone` 为准，由 `getRapidSlots()` 取回。两者不一致会被契约测试抓到。
 */
export const RAPID_SLOTS_BY_TONE: Record<NoteType, Exclude<RapidSlot, "toneType">[]> = {
  散: ["rightAction", "stringNumber", "structureMark"],
  泛: ["leftFinger", "hui", "fen", "rightAction", "stringNumber", "structureMark"],
  按: ["leftFinger", "hui", "fen", "slide", "rightAction", "stringNumber", "structureMark"],
};

/** 全槽位顺序（含可选的音色前缀），供 UI 说明用 */
export const RAPID_SLOT_ORDER: readonly RapidSlot[] = [
  "toneType",
  "leftFinger",
  "hui",
  "fen",
  "slide",
  "rightAction",
  "stringNumber",
  "structureMark",
];

/** 槽位中文名，供 UI 提示 */
export const RAPID_SLOT_LABEL: Record<RapidSlot, string> = {
  toneType: "音色",
  leftFinger: "左手",
  hui: "徽位",
  fen: "分",
  slide: "走手音",
  rightAction: "右手",
  stringNumber: "弦序",
  structureMark: "结构记号",
};

/** 解析出的一个槽位取值 */
export interface RapidToken {
  slot: RapidSlot;
  letter: string;
  value: string;
}

/** 连打解析结果 */
export interface RapidParse {
  /** 已解析出的减字状态（未完成的字段为 null） */
  state: JianziState;
  /** 已消费的字符数 */
  consumed: number;
  /** 整字是否已经完整 */
  complete: boolean;
  /** 已识别的槽位序列 */
  tokens: RapidToken[];
  /** 下一个该打的槽位；已完整时为 null */
  nextSlot: RapidSlot | null;
}

const EMPTY_STATE: JianziState = {
  toneType: null,
  rhythmMode: null,
  leftFinger: null,
  hui: null,
  fen: null,
  slide: null,
  structureMark: null,
  rightAction: null,
  stringNumber: null,
};

/**
 * 去掉空白与标点，统一小写（中文输入法常把字母带成全角/大写）。
 *
 * 纯字符串归一，留在 TS 侧是刻意的：逐键输入每一击都要调用它，
 * 为省一次 WASM 调用来回不值得。Rust 有同名实现（`normalize_rapid_input`），
 * 规则一致且都有测试钉住。
 */
export function normalizeRapidInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s,，、]+/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[^a-z0-9]/g, "");
}

/** 把 Rust 返回的 JSON 转成前端形状（补齐 `rhythmMode` 等字段）。 */
function parseResult(rawText: string): RapidParse {
  const parsed = JSON.parse(rawText) as {
    error?: string;
    state?: Partial<JianziState>;
    consumed?: number;
    complete?: boolean;
    tokens?: RapidToken[];
    nextSlot?: RapidSlot | null;
  };
  if (parsed.error) throw new Error(parsed.error);
  return {
    state: {
      ...EMPTY_STATE,
      ...parsed.state,
      rhythmMode: parsed.state?.rhythmMode ?? null,
    },
    consumed: parsed.consumed ?? 0,
    complete: Boolean(parsed.complete),
    tokens: parsed.tokens ?? [],
    nextSlot: parsed.nextSlot ?? null,
  };
}

/**
 * 解析连打串。
 *
 * 逻辑与码表全在 Rust（`jianzi_rapid::parse_rapid_input`）——回溯搜索、音色三重来源、
 * 兜底保护、「当前音色吃满就不兜底」都在那边，这里不做任何判断。
 *
 * WASM 未就绪时返回「未完成」空结果，键盘显示尚未解析而不是崩溃；
 * 预加载由 `WasmBootstrap` 触发，正常交互时早已 ready。
 */
export function parseRapidInput(
  raw: string,
  toneType: NoteType,
  options: { force?: boolean } = {},
): RapidParse {
  if (!isWasmReady()) {
    return {
      state: { ...EMPTY_STATE, toneType },
      consumed: 0,
      complete: false,
      tokens: [],
      nextSlot: "rightAction",
    };
  }
  const out = getWasmSync().parse_rapid_input(
    JSON.stringify({ input: raw, tone: toneType, force: options.force ?? false }),
  );
  return parseResult(out);
}

/**
 * 各音色的槽位顺序（以 Rust 为准）。
 *
 * WASM 未就绪时退回静态表；两者不符会被契约测试发现。
 */
export function getRapidSlots(): Record<NoteType, RapidSlot[]> {
  if (!isWasmReady()) {
    return RAPID_SLOTS_BY_TONE as Record<NoteType, RapidSlot[]>;
  }
  try {
    const raw = JSON.parse(getWasmSync().get_rapid_slots()) as Record<
      NoteType,
      RapidSlot[]
    >;
    return { ...(RAPID_SLOTS_BY_TONE as Record<NoteType, RapidSlot[]>), ...raw };
  } catch {
    return RAPID_SLOTS_BY_TONE as Record<NoteType, RapidSlot[]>;
  }
}

/**
 * 连打速查表，供 UI 说明。
 *
 * 纯文案，不是逻辑——放进 Rust 只会让改一句话都要重新编译 WASM。
 */
export const RAPID_CHEATSHEET = [
  { title: "音色", text: "散 s · 泛 f · 按 a（不写则用当前音色；无左手无徽位当散音）" },
  { title: "左手", text: "大 d · 食指 s · 中 z · 名 m · 跪 g" },
  { title: "徽位", text: "数字 1–13（十一打 11、十三打 13）" },
  { title: "分", text: "f1–f9 一至九分 · fb 半" },
  {
    title: "走手音",
    text: "绰 c · 注 z · 急 j · 吟 y · 猱 n；复合 = 前缀+吟/猱，如 细吟 xy、游猱 un、定吟 ky（仅按音）",
  },
  {
    title: "右手",
    text: "挑 t · 勾 g · 抹 m · 打 d · 摘 z · 托 tu · 剔 ti · 擘 b · 抹挑 mt · 勾剔 gt；成块单指法 轮 u · 锁 o · 涓 v · 历 h · 拂 p；复合指法 半扶 ek · 长锁 il · 短锁 kq · 背锁 lr · 圆锁 qx · 半涓 wi · 反涓 xe · 叠涓 ki · 连涓 eq",
  },
  { title: "弦序", text: "数字 1–7；或 三 s、四 ss" },
  {
    title: "结构记号",
    text: "接在弦序之后：少息 xx · 大息 dx · 再作 zz · 从头再作 cz · 入拍 rp（谱面层记号，独立于减字四宫格）",
  },
] as const;
