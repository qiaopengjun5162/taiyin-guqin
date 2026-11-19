/**
 * 减字文本的序列化与解析 —— 前端薄壳。
 *
 * 实现在 Rust：`crates/taiyin-core/src/jianzi_text.rs`。
 *
 * ## 为什么这段逻辑必须只有一份
 *
 * 它同时被三件事依赖，而这三件事分别发生在不同端：
 * 1. **字体渲染**（网页 DOM / 小程序 WXML / App 原生文本）
 * 2. **谱面导出**（PNG / PDF / MIDI 文件名）
 * 3. **文本互操作**（粘贴传统谱本、识别结果回填）
 *
 * 同一串减字在网页上拼成整字、在小程序里散成两串，用户会以为「这个字坏了」。
 *
 * ## 那些「奇怪」的顺序不是排版偏好
 *
 * 序列化顺序 = 字体连字规则，每条都对应一次实测：
 * - 分数必须在右手指法前（「大九六绰勾四」整字 vs 散成两串，1em vs 2em）
 * - 吟猱族必须挂字尾（塞进内折槽会把整字劈成两坨，1.5em）
 * - 偏旁（亻/夕）字体没有连字，序列化换全字（食/名），解析两种都收
 *
 * 改顺序前先看 Rust 那边的实测注释。
 *
 * ## 留在前端的部分
 *
 * `isComplete` / `createEmptyState` / `canHaveSlide` / `pitchSlide` /
 * `fenToGlyph` / `rightActionName` / 时值换算，都是极小的纯函数或静态查表，
 * 在渲染与音频路径上频繁调用，走 WASM 往返不划算；也不含会因端而异的判断。
 */

import type { JianziState, Duration, PitchSlide, SlideMark, NoteType, StructureMark } from "./types";
import { getWasmSync, isWasmReady } from "./taiyin-wasm";

/**
 * 21 个装饰记号，**按长度降序**（两字复合在前、单字在后），供最长匹配。
 *
 * 顺序即正确性：「绰吟」若排在「绰」后面，匹配会先吃掉「绰」，
 * 剩下「吟…」既不是分数也不是指法，整条解析就废了。
 * 与 Rust `jianzi_text::SLIDE_MARKS` 同源（有契约测试守着）。
 */
export const SLIDE_MARKS: readonly SlideMark[] = [
  "绰吟", "绰猱", "注吟", "注猱", "细吟", "细猱", "游吟", "游猱",
  "荡吟", "荡猱", "飞吟", "飞猱", "圆吟", "圆猱", "定吟", "定猱",
  "绰", "注", "急", "吟", "猱",
];

/**
 * 5 个谱面结构记号——独立于减字四宫格的谱面层标记。
 *
 * 与 Rust `jianzi_text::STRUCTURE_MARKS` 同源；与 `SLIDE_MARKS` 不同，
 * 它们不进减字拼装、不参与字体连字，只作为谱面记号独立呈现。
 */
export const STRUCTURE_MARKS: readonly StructureMark[] = [
  "少息", "大息", "再作", "从头再作", "入拍",
];

/** 字体压在「分数后、右手法前」槽里的三个内折记号；其余 18 个挂字尾。 */
const INLINE_MARKS: ReadonlySet<SlideMark> = new Set<SlideMark>(["绰", "注", "急"]);

/** 记号走内折槽（true）还是挂字尾（false）。渲染与释义都按这个分。 */
export function isInlineMark(mark: SlideMark): boolean {
  return INLINE_MARKS.has(mark);
}

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
  // 注意：structureMark 故意不写进空状态。它是可选谱面记号，缺省即「无」；
  // 写上 `structureMark: null` 会让 `to.deep.equal` 的测试字面量（不含该键）整体失配。
  // 读取处一律按「undefined / null 都当无记号」处理，故缺省省略与显式 null 等价。
  return {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: null,
    stringNumber: null,
  };
}

/**
 * 分位 → 字体拼装用的字形字符。
 *
 * 减字谱字体的一条硬规则：徽位后的分数在减字里**只写数字**，不写「分」字——
 * 「七徽六分」的减字是「七」下压一个「六」。若把「六分」整串塞进去，
 * 字体找不到对应部件，整块会被撑开散架（线上实测：选「六分」后「勹」被挤出格子）。
 */
export function fenToGlyph(fen: string): string {
  return fen === "半" ? "半" : fen.replace(/分$/, "");
}

/**
 * 右手指法字形 → 可读名（「勹」→「勾」）。
 *
 * 键盘按钮上存的是偏旁字形（勹/乚/木/丁/倽…），那是减字的传统写法；
 * 但对不熟减字谱的人，一排「勹 尸 木 乚」等于一排看不懂的符号——
 * 2026-11-18 实拍确认：想点「勾」的人找不到按钮，因为屏幕上没有「勾」这个字。
 * 所以按钮显示「勹 / 勾」两行（字形在上、读音在下）。
 */
const RIGHT_ACTION_READABLE: Record<string, string> = {
  勹: "勾", 木: "抹", 乚: "挑", 乇: "托", 丁: "打",
  尸: "劈", 擘: "劈", 倽: "摘",
};

export function rightActionName(glyph: string): string {
  return RIGHT_ACTION_READABLE[glyph] ?? glyph;
}

/**
 * 装饰记号只存在于按音：散音是空弦、泛音要虚按徽位，都滑不动 / 谈不上急弹。
 * （实测字体里「散急勾四」也连不成整字，散成 1.33em。）
 */
export function canHaveSlide(toneType: NoteType | null): boolean {
  return toneType === "按";
}

/**
 * 只挑出会滑动音高的记号（绰/注）。
 *
 * 「急」是弹法记号，音高不动——把它混进滑音分支会把急弹当成注音弹，
 * 音高先高后落，等于弹错。所以音频链路一律过这道筛子。
 *
 * 吟猱族（含绰吟/注猱这类复合）一律返回 null：它们的吟猱成分不动音高，
 * 复合里的绰/注成分**暂不合成滑音**——这是已知的听感边界，
 * 宁可弹成直音，也不在未验证的合成路径上猜一个起音偏移量。
 */
export function pitchSlide(slide: SlideMark | null): PitchSlide | null {
  return slide === "绰" || slide === "注" ? slide : null;
}

// ──────────────────────────────────────────────
// 转发到核心
// ──────────────────────────────────────────────

/** 引擎未就绪时的降级：按规则手工拼（不做偏旁→全字转换）。 */
function fallbackToText(j: JianziState): string {
  if (j.toneType === "散") {
    return `散${j.rightAction ?? ""}${j.stringNumber ?? ""}`;
  }
  const slide = j.toneType === "泛" ? null : j.slide;
  return [
    j.toneType === "泛" ? "泛 " : "",
    j.leftFinger ?? "",
    j.hui ?? "",
    j.fen ? fenToGlyph(j.fen) : "",
    slide && isInlineMark(slide) ? slide : "",
    j.rightAction ?? "",
    j.stringNumber ?? "",
    slide && !isInlineMark(slide) ? slide : "",
  ].join("");
}

/**
 * 将减字状态序列化为减字谱字体可渲染的文本。
 *
 * 引擎未就绪时返回手工拼的降级文本——比返回空串好：字形还在，
 * 只是偏旁转换（亻→食、夕→名）没做，可能散成两串。
 */
export function jianziToText(jianzi: JianziState): string {
  if (!isWasmReady()) return fallbackToText(jianzi);
  const raw = getWasmSync().jianzi_to_text(JSON.stringify({ state: jianzi }));
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" ? parsed : fallbackToText(jianzi);
  } catch {
    return fallbackToText(jianzi);
  }
}

/**
 * 将文本（如「大九勾四」）解析为减字状态。
 *
 * 解析不出**完整**减字时返回 null——不会返回「有指法没弦序」的半残对象，
 * 否则识别面板按「非 null 即成功」统计，会把错误率算成 0。
 */
export function parseJianziText(text: string): JianziState | null {
  if (!text.trim() || !isWasmReady()) return null;
  const raw = getWasmSync().parse_jianzi_text(JSON.stringify({ text }));
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.error === "string") return null;
    return {
      toneType: (parsed.toneType as JianziState["toneType"]) ?? null,
      rhythmMode: (parsed.rhythmMode as JianziState["rhythmMode"]) ?? null,
      leftFinger: (parsed.leftFinger as string | null) ?? null,
      hui: (parsed.hui as string | null) ?? null,
      fen: (parsed.fen as string | null) ?? null,
      slide: (parsed.slide as SlideMark | null) ?? null,
      rightAction: (parsed.rightAction as string | null) ?? null,
      stringNumber: (parsed.stringNumber as string | null) ?? null,
      structureMark: (parsed.structureMark as StructureMark | null) ?? undefined,
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// 时值换算（纯算术，留在前端）
// ──────────────────────────────────────────────

/** 根据时值获取减时线数量。 */
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
