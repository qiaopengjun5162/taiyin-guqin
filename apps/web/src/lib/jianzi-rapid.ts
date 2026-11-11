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
 *   - 我们的槽位是结构化的（左手指法 / 徽位 / 分 / 走手音 / 右手指法 / 弦序），
 *     所以同一个字母在不同位置天然不歧义：d 在第 1 槽是「大」，在第 4 槽是「打」。
 *
 * 2026-11 补的三件事（照「文源古琴输入法」的 SG3 打法对齐）：
 *   - **音色写进字符串**：s=散、f=泛、a=按。原先要靠鼠标点按钮切音色，
 *     一段谱里散/泛/按交替时手得在键盘和鼠标之间来回跳。
 *   - **徽位改用数字**：1–13 直接打，不再需要 s/ss/sss/ssss 数 s 的个数。
 *     数字只出现在徽位与弦序两处，中间隔着右手指法字母，不会撞车；
 *     分位仍带 f 前缀（f6 = 六分），否则「十三」和「一徽三分」分不开。
 *   - **装饰记号进槽**：c=绰、z=注、j=急，另有吟猱族 18 个
 *     （吟 y / 猱 n，及「前缀 + 吟/猱」16 个复合，如细吟 xy、定猱 kn）。
 *     位置在分数之后、右手之前——这是**码 / 连打串**的结构化槽位；
 *     字体渲染串不同：绰/注/急 留在此槽，吟猱族挂字尾（见 `jianzi.ts`）。
 *
 * 例：大九勾四   → djg4 / d9g4      （d=大 j|9=九 g=勾 4=四弦）
 *     大九六分绰勾四 → d9f6cg4
 *     散音 勾三   → sg3              （s=散 g=勾 3=三弦）
 *     泛音 大九勾四 → fd9g4
 *     大十三勾四  → d13g4
 */

import type { JianziState, NoteType } from "./types";
import { createEmptyState } from "./jianzi";

/** 连打槽位：与减字书写顺序一致 */
export type RapidSlot =
  | "toneType"
  | "leftFinger"
  | "hui"
  | "fen"
  | "slide"
  | "rightAction"
  | "stringNumber";

/** 除音色前缀之外的取值槽（音色由串首前缀决定，不在槽位链里走） */
type ValueSlot = Exclude<RapidSlot, "toneType">;

/**
 * 各音色的槽位顺序。
 * 散音是空弦，没有左手、徽分，也谈不上走手音，只有右手 + 弦序。
 * 泛音要虚按徽位取音，同样滑不动（见 jianzi.canHaveSlide），所以也不给走手音槽。
 */
export const RAPID_SLOTS_BY_TONE: Record<NoteType, ValueSlot[]> = {
  散: ["rightAction", "stringNumber"],
  泛: ["leftFinger", "hui", "fen", "rightAction", "stringNumber"],
  按: ["leftFinger", "hui", "fen", "slide", "rightAction", "stringNumber"],
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
};

/**
 * 音色前缀。
 * 长串靠前：`san` 要先于 `s` 匹配，否则「san」会被吃成「散 + an」。
 */
const TONE_TOKENS: Array<[string, NoteType]> = [
  ["san", "散"],
  ["fan", "泛"],
  ["an", "按"],
  ["s", "散"],
  ["f", "泛"],
  ["a", "按"],
];

/** 单槽内的字母表：[键入串, 减字取值]。长串必须靠前，便于最长匹配。 */
const TOKENS: Record<ValueSlot, Array<[string, string]>> = {
  // 大 d、食指 亻 s、中指 中 z、名指 夕 m、跪 g
  leftFinger: [
    ["d", "大"],
    ["s", "亻"],
    ["z", "中"],
    ["m", "夕"],
    ["g", "跪"],
  ],
  // 徽位：数字 1–13 为主（1 与 13 靠最长匹配区分），
  // 同时保留火蜘蛛的字母旧法，老手感不用改。
  hui: [
    ["13", "十三"],
    ["12", "十二"],
    ["11", "十一"],
    ["10", "十"],
    ["9", "九"],
    ["8", "八"],
    ["7", "七"],
    ["6", "六"],
    ["5", "五"],
    ["4", "四"],
    ["3", "三"],
    ["2", "二"],
    ["1", "一"],
    ["ssss", "十三"],
    ["sssy", "十一"],
    ["ssse", "十二"],
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
  // 「分」是可选槽，用 f + 数字/半：f1 一分 … f9 九分、fb 半。
  // 不带 f 的裸数字留给徽位——否则「d13g4」会被读成「一徽三分」。
  fen: [
    ["f1", "一分"],
    ["f2", "二分"],
    ["f3", "三分"],
    ["f4", "四分"],
    ["f5", "五分"],
    ["f6", "六分"],
    ["f7", "七分"],
    ["f8", "八分"],
    ["f9", "九分"],
    ["fb", "半"],
  ],
  // 装饰记号 21 个，与 Rust `jianzi_code::SLIDE_TOKENS` 同源（字母与顺序都对齐）。
  // 双字母必须排在单字母前，否则 `cy`（绰吟）会被 `c`（绰）截断。
  // 复合 = 前缀（绰 c / 注 z / 细 x / 游 u / 荡 h / 飞 v / 圆 o / 定 k）+ 吟 y / 猱 n。
  // z 与右手「摘」、j 与徽位「九」、y 与徽位「一」同字母——槽位不同，
  // 回溯会各自挑出能成整字的那条路。
  slide: [
    ["cy", "绰吟"], ["cn", "绰猱"], ["zy", "注吟"], ["zn", "注猱"],
    ["xy", "细吟"], ["xn", "细猱"], ["uy", "游吟"], ["un", "游猱"],
    ["hy", "荡吟"], ["hn", "荡猱"], ["vy", "飞吟"], ["vn", "飞猱"],
    ["oy", "圆吟"], ["on", "圆猱"], ["ky", "定吟"], ["kn", "定猱"],
    ["c", "绰"], ["z", "注"], ["j", "急"], ["y", "吟"], ["n", "猱"],
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
    // 成块单指法（字体内折成块，GSUB 单字替换已核验真身）：轮 u · 锁 o · 涓 v · 历 h · 拂 p
    // 蠲 i / 剌 k 字体 cmap→placeholder 且无 GSUB 规则，不接入。
    ["u", "轮"],
    ["o", "锁"],
    ["v", "涓"],
    ["h", "历"],
    ["p", "拂"],
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
  slot: ValueSlot,
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

/** 一个候选解析路径 */
interface Candidate {
  state: JianziState;
  consumed: number;
  filled: number;
  tokens: RapidToken[];
}

/** 候选优先级：先看能否成整字，再看吃掉多少字符，最后看填了几个槽 */
function better(a: Candidate & { complete: boolean }, b: Candidate & { complete: boolean }): boolean {
  if (a.complete !== b.complete) return a.complete;
  if (a.consumed !== b.consumed) return a.consumed > b.consumed;
  return a.filled > b.filled;
}

/** 未填的必填槽（fen / slide 可省） */
function firstMissing(state: JianziState, tone: NoteType): RapidSlot | null {
  const order = RAPID_SLOTS_BY_TONE[tone];
  return (
    order.find(
      (slot) => slot !== "fen" && slot !== "slide" && state[slot] === null,
    ) ?? null
  );
}

function isComplete(state: JianziState, tone: NoteType, consumed: number, len: number): boolean {
  if (len === 0 || consumed !== len) return false;
  return firstMissing(state, tone) === null;
}

/**
 * 解析连打串。
 *
 * 采用回溯搜索而不是简单贪心：因为「s / ss / sss」「1 / 13」「z=注 / z=摘」
 * 在不同槽位都可能命中不同长度，只有能成整字的那条路径才是用户想打的谱字。
 *
 * 音色有三种来源，按优先级依次尝试：
 *   ① 串首显式前缀（s / f / a）；
 *   ② UI 上当前选中的音色；
 *   ③ 按音 / 散音双向兜底——按音必有左手 + 徽位，散音必无，字符串本身就分得清。
 * 第 ③ 条是为了让「g4」在按音模式下也能直接出「散勾四」、「d9g4」在散音模式下
 * 也能出「大九勾四」，跟文源输入法打 SG3 的手感一致，不必先回去改音色。
 * 泛音不参与兜底：它和按音写法完全相同，猜错就是整段音色错，只认 f 前缀或界面选择。
 *
 * `force` 用来关掉上面那条「当前音色吃满就不兜底」的保护：敲回车时由用户明确表态，
 * 此时按最优解入谱（例：按音界面下打 g4，自动逻辑怕你正打到一半不敢提交，回车即得「散勾四」）。
 */
export function parseRapidInput(
  raw: string,
  toneType: NoteType,
  options: { force?: boolean } = {},
): RapidParse {
  const input = normalizeRapidInput(raw);

  /** 在给定音色下，从 pos 起走完整条槽位链，返回最优路径 */
  function run(tone: NoteType, pos: number): Candidate {
    const order = RAPID_SLOTS_BY_TONE[tone];
    let best: Candidate | null = null;

    function walk(p: number, slotIdx: number, state: JianziState, tokens: RapidToken[], touched: Set<RapidSlot>) {
      const candidate = { state: { ...state }, consumed: p, filled: touched.size, tokens: [...tokens] };
      if (!best || candidate.consumed > best.consumed || (candidate.consumed === best.consumed && candidate.filled > best.filled)) {
        best = candidate;
      }

      if (slotIdx >= order.length) return;
      const slot = order[slotIdx];

      // 「分」「走手音」都是可选槽：可以整段跳过
      if (slot === "fen" || slot === "slide") {
        walk(p, slotIdx + 1, state, tokens, touched);
      }

      const m = matchSlot(slot, input, p);
      if (!m) return;

      const nextState = { ...state, [slot]: m.value } as JianziState;
      const nextTouched = new Set(touched);
      nextTouched.add(slot);
      tokens.push({ slot, letter: input.slice(p, p + m.len), value: m.value });
      walk(p + m.len, slotIdx + 1, nextState, tokens, nextTouched);
      tokens.pop();
    }

    walk(pos, 0, createEmptyState(), [], new Set());
    return (
      (best as Candidate | null) ?? { state: createEmptyState(), consumed: pos, filled: 0, tokens: [] }
    );
  }

  let best: (Candidate & { complete: boolean }) | null = null;

  function consider(
    tone: NoteType,
    pos: number,
    prefix: RapidToken | null,
  ): Candidate & { complete: boolean } {
    const c = run(tone, pos);
    // 泛音滑不动：写进来也不收（与 parseJianziText 的取舍一致）
    const slide = tone === "按" ? c.state.slide : null;
    const state: JianziState = {
      ...c.state,
      toneType: tone,
      slide,
      rhythmMode: null,
    };
    const candidate = {
      state,
      consumed: c.consumed,
      filled: c.filled + (prefix ? 1 : 0),
      tokens: prefix ? [prefix, ...c.tokens] : c.tokens,
      complete: isComplete(state, tone, c.consumed, input.length),
    };
    if (!best || better(candidate, best)) best = candidate;
    return candidate;
  }

  // ① 串首显式音色前缀（s / f / a，长串优先）
  for (const [key, tone] of TONE_TOKENS) {
    if (!input.startsWith(key)) continue;
    consider(tone, key.length, { slot: "toneType", letter: key, value: tone });
  }
  // ② UI 选中音色
  const ui = consider(toneType, 0, null);
  // ③ 兜底：字符串本身已经说清了是什么音，就不该因为界面停在别的音色而打不出来。
  //    按音与散音靠「有没有左手 + 徽位」天然区分，两个方向都试一遍；
  //    泛音不猜——它和按音的写法一模一样，猜错就是整段音色错，只能靠 f 前缀或界面选。
  //
  //    ⚠ 但兜底只能捡「当前音色根本读不下去」的串。只要当前音色把整串吃完了
  //    （哪怕还没填满槽位），就说明用户正在按这套语法往下一个谱字走，
  //    此时切去另一种音色会**提前成字**：打「d13g4」时，「d1」会被读成「散打一」
  //    立刻入谱，剩下的「3g4」全卡在输入框里——线上实测踩过这个坑。
  const uiTookOver =
    !options.force && ui.consumed === input.length && input.length > 0;
  if (!uiTookOver) {
    for (const fallback of ["按", "散"] as const) {
      if (fallback !== toneType) consider(fallback, 0, null);
    }
  }

  const result: Candidate & { complete: boolean } = best ?? {
    state: { ...createEmptyState(), toneType },
    consumed: 0,
    filled: 0,
    tokens: [],
    complete: false,
  };

  return {
    state: result.state,
    consumed: result.consumed,
    complete: result.complete,
    tokens: result.tokens,
    nextSlot: result.complete ? null : firstMissing(result.state, result.state.toneType ?? toneType),
  };
}

/** 连打速查表，供 UI 说明 */
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
    text: "挑 t · 勾 g · 抹 m · 打 d · 摘 z · 托 tu · 剔 ti · 擘 b · 抹挑 mt · 勾剔 gt；成块单指法 轮 u · 锁 o · 涓 v · 历 h · 拂 p",
  },
  { title: "弦序", text: "数字 1–7；或 三 s、四 ss" },
] as const;
