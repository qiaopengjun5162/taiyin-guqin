/**
 * 减字「连打」解析器 —— 键盘盲打录谱。
 *
 * 规则借鉴火蜘蛛减字谱输入法 3.0 的三条硬规则：
 *   1. 用部件拼音首字母输入，**按减字书写顺序**（从上往下、从左往右）；
 *   2. 「三 / 四 / 十」同为首字母 s，用重复字母消歧：三=s、四=ss、十=sss；
 *   3. 不弹候选词、不用数字键盘，打完整字自动成字。
 *
 * 与火蜘蛛的差别（也是我们的优势）：
 *   - 那些规则的前提是「必须先装 蜘蛛火谱 字体才能显示」；我们是 Web 内置字体，
 *     跑到浏览器里就能看，不需要安装任何东西。
 *   - 我们的槽位是结构化的（左手指法 / 徽位 / 分 / 右手指法 / 弦序），
 *     所以同一个字母在不同位置天然不歧义：d 在第 1 槽是「大」，在第 4 槽是「打」。
 *
 * 例：大九勾四 → djg4          （d=大 j=九 g=勾 4=四弦）
 *     大九勾四 → djgs          （s=三弦，四弦要打 ss）
 *     泛音 名七挑三 → mqt3
 *     散音 勾四 → g4
 */

import type { JianziState, NoteType } from "./types";
import { createEmptyState } from "./jianzi";

/** 连打槽位：与减字书写顺序一致 */
export type RapidSlot =
  | "leftFinger"
  | "hui"
  | "fen"
  | "rightAction"
  | "stringNumber";

/** 各音色的槽位顺序：散音只有「右手 + 弦序」，泛音/按音是全套 */
export const RAPID_SLOT_ORDER: Record<NoteType, RapidSlot[]> = {
  散: ["rightAction", "stringNumber"],
  泛: ["leftFinger", "hui", "fen", "rightAction", "stringNumber"],
  按: ["leftFinger", "hui", "fen", "rightAction", "stringNumber"],
};

/** 槽位中文名，供 UI 提示 */
export const RAPID_SLOT_LABEL: Record<RapidSlot, string> = {
  leftFinger: "左手",
  hui: "徽位",
  fen: "分",
  rightAction: "右手",
  stringNumber: "弦序",
};

/** 单槽内的字母表：[键入串, 减字取值]。长串必须靠前，便于最长匹配。 */
const TOKENS: Record<RapidSlot, Array<[string, string]>> = {
  // 大 d、食指 亻 s、中指 中 z、名指 夕 m、跪 g
  leftFinger: [
    ["d", "大"],
    ["s", "亻"],
    ["z", "中"],
    ["m", "夕"],
    ["g", "跪"],
  ],
  // 三 s、四 ss、十 sss 是火蜘蛛的消歧约定，其余按首字母
  hui: [
    ["sss", "十"],
    ["ss", "四"],
    ["s", "三"],
    ["y", "一"],
    ["e", "二"],
    ["w", "五"],
    ["l", "六"],
    ["q", "七"],
    ["b", "八"],
    ["j", "九"],
  ],
  // 「分」是可选槽，用 f + 数字/半：f3 三分、f6 六分、f8 八分、fb 半
  fen: [
    ["f3", "三分"],
    ["f6", "六分"],
    ["f8", "八分"],
    ["fb", "半"],
  ],
  // 复合指法优先（抹挑 mt / 勾剔 gt / 抹勾 mg / 打摘 dz），
  // t 让给最常用的「挑」，托用 tu、剔用 ti
  rightAction: [
    ["mt", "抹挑"],
    ["gt", "勾剔"],
    ["mg", "抹勾"],
    ["dz", "打摘"],
    ["ti", "剔"],
    ["tu", "乇"],
    ["t", "乚"],
    ["m", "木"],
    ["g", "勹"],
    ["d", "丁"],
    ["z", "倽"],
    ["b", "尸"],
  ],
  // 弦序优先用数字键 1-7；也收首字母，四弦同样遵守 ss 约定
  stringNumber: [
    ["1", "一"],
    ["2", "二"],
    ["3", "三"],
    ["4", "四"],
    ["5", "五"],
    ["6", "六"],
    ["7", "七"],
    ["ss", "四"],
    ["s", "三"],
    ["y", "一"],
    ["e", "二"],
    ["w", "五"],
    ["l", "六"],
    ["q", "七"],
  ],
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

/** 去掉空白与标点，统一小写（中文输入法常把字母带成全角/大写） */
export function normalizeRapidInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s,，、]+/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[^a-z0-9]/g, "");
}

/** 单个槽位能否用该位置起的字符填充；返回匹配长度与取值 */
function matchSlot(
  slot: RapidSlot,
  input: string,
  pos: number,
): { len: number; value: string } | null {
  for (const [key, value] of TOKENS[slot]) {
    if (input.startsWith(key, pos)) {
      return { len: key.length, value };
    }
  }
  return null;
}

/**
 * 解析连打串。
 *
 * 采用回溯搜索而不是简单贪心：因为「s / ss / sss」「t / ti / tu」在不同槽位
 * 都可能命中不同长度，只有把整串打完的那条路径才是用户真正想输入的谱字。
 *
 * 评分优先级：① 能完整解析整串 ＞ ② 消费字符更多 ＞ ③ 填充槽位更多。
 */
export function parseRapidInput(
  raw: string,
  toneType: NoteType,
): RapidParse {
  const input = normalizeRapidInput(raw);
  const order = RAPID_SLOT_ORDER[toneType] ?? RAPID_SLOT_ORDER["按"];

  let best: {
    state: JianziState;
    consumed: number;
    filled: number;
    tokens: RapidToken[];
  } | null = null;

  function better(
    a: { consumed: number; filled: number },
    b: { consumed: number; filled: number },
  ): boolean {
    if (a.consumed !== b.consumed) return a.consumed > b.consumed;
    return a.filled > b.filled;
  }

  function walk(
    pos: number,
    slotIdx: number,
    state: JianziState,
    tokens: RapidToken[],
    touched: Set<RapidSlot>,
  ) {
    const filled = touched.size;
    const candidate = { consumed: pos, filled };
    if (!best || better(candidate, best)) {
      best = {
        state: { ...state },
        consumed: pos,
        filled,
        tokens: [...tokens],
      };
    }

    if (slotIdx >= order.length) return;

    const slot = order[slotIdx];

    // 「分」是可选槽：可以直接跳过
    if (slot === "fen") {
      walk(pos, slotIdx + 1, state, tokens, touched);
    }

    const m = matchSlot(slot, input, pos);
    if (!m) return;

    const nextState = { ...state, [slot]: m.value } as JianziState;
    const nextTouched = new Set(touched);
    nextTouched.add(slot);
    tokens.push({ slot, letter: input.slice(pos, pos + m.len), value: m.value });
    walk(pos + m.len, slotIdx + 1, nextState, tokens, nextTouched);
    tokens.pop();
  }

  walk(0, 0, createEmptyState(), [], new Set());

  const result = best as {
    state: JianziState;
    consumed: number;
    filled: number;
    tokens: RapidToken[];
  } | null;

  const state = result
    ? { ...result.state, toneType, rhythmMode: null }
    : { ...createEmptyState(), toneType };

  const required = order.filter((s) => s !== "fen");
  const complete =
    required.every((s) => state[s] !== null) &&
    (result?.consumed ?? 0) === input.length;

  // 下一个未填的槽位（跳过可选槽）
  const nextSlot = order.find((s) => s !== "fen" && state[s] === null) ?? null;

  return {
    state,
    consumed: result?.consumed ?? 0,
    complete: complete && input.length > 0,
    tokens: result?.tokens ?? [],
    nextSlot: complete ? null : nextSlot,
  };
}

/** 连打速查表，供 UI 说明 */
export const RAPID_CHEATSHEET = [
  { title: "左手", text: "大 d · 食指 s · 中 z · 名 m · 跪 g" },
  { title: "徽位", text: "一 y 二 e 三 s 四 ss 五 w 六 l 七 q 八 b 九 j 十 sss" },
  { title: "分", text: "f3 三分 · f6 六分 · f8 八分 · fb 半" },
  {
    title: "右手",
    text: "挑 t · 勾 g · 抹 m · 打 d · 摘 z · 托 tu · 剔 ti · 擘 b · 抹挑 mt · 勾剔 gt",
  },
  { title: "弦序", text: "数字 1-7；或 三 s、四 ss" },
] as const;
