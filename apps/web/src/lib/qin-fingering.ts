/**
 * 减字 → 琴面指法图的数据模型。
 *
 * 文字释义回答「这个字怎么读」，但初学的人看到陌生谱字，真正卡住的是
 * 「手该落哪儿」：哪根弦、离岳山多远、左手哪一指、右手往哪边拨。
 * 本模块只算位置，不画图——画图的部分在 `qin-fingering-diagram.tsx`。
 *
 * 位置的唯一依据是 `jianzi-pitch` 里的徽分换算（`huiFraction`）：
 * 图上那一点，必须与合成器算出来的频率出自同一个 p，
 * 否则会出现「图上是九徽、听出来是八徽半」这种自相矛盾。
 */

import type { JianziState, NoteType, PitchSlide } from "./types";
import { chineseNumToHui, huiFraction } from "./jianzi-pitch";
import { leftFingerInfo, rightActionInfo } from "./jianzi-explain";

/** 古琴七弦。一弦最粗最低，坐在琴前时离身体最近。 */
export const QIN_STRING_COUNT = 7;

const CN_STRING: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
};

/** 十三徽距岳山的比例（占全弦长）。与音高推算共用一套数。 */
export const HUI_TICKS: { number: number; ratio: number }[] = Array.from(
  { length: 13 },
  (_, i) => ({ number: i + 1, ratio: huiFraction(i + 1, null) ?? 0 }),
);

/** 图上要标数字的几个徽——十三徽全标会挤成一团，取传统认位用的锚点。 */
export const HUI_LABELED = new Set([1, 4, 7, 10, 13]);

export interface QinFingeringModel {
  toneType: NoteType | null;
  /** 1–7；没选弦时为 null */
  stringNumber: number | null;
  /** 按弦点占全弦比例：0 = 岳山，1 = 龙龈。散音不按弦，为 null */
  pressRatio: number | null;
  huiNumber: number | null;
  /** 左手：散音不用左手，为 null */
  leftFinger: { name: string; note?: string } | null;
  /** 右手：指法与拨弦方向（向身 / 离身） */
  right: { name: string; finger: string; toward: "身" | "外" | null } | null;
  /** 走手音：绰从岳山一侧滑来，注从龙龈一侧滑来 */
  slide: PitchSlide | null;
  /** 是否已够画一张有意义的图（有弦，且散音或有徽位） */
  drawable: boolean;
}

/** 减字状态 → 琴面图模型。缺关键信息时给出 `drawable: false`，让调用方别画半张图。 */
export function buildQinFingering(state: JianziState): QinFingeringModel {
  const stringNumber = state.stringNumber ? (CN_STRING[state.stringNumber] ?? null) : null;
  const huiNumber = chineseNumToHui(state.hui);
  const isOpen = state.toneType === "散";

  // 散音不按弦：弦全长振动，图上就整根弦亮着，没有按点。
  const pressRatio =
    !isOpen && huiNumber != null ? huiFraction(huiNumber, state.fen) : null;

  const left = isOpen ? null : leftFingerInfo(state.leftFinger);
  const right = rightActionInfo(state.rightAction);

  // 急弹只标速度，不改音高走向，图上不画滑音箭头。
  const slide: PitchSlide | null =
    state.slide === "绰" || state.slide === "注" ? state.slide : null;

  return {
    toneType: state.toneType,
    stringNumber,
    pressRatio,
    huiNumber,
    leftFinger: left,
    right: right
      ? {
          name: right.name,
          finger: right.finger,
          toward: right.direction === "内" ? "身" : right.direction === "外" ? "外" : null,
        }
      : null,
    slide,
    drawable: stringNumber != null && (isOpen || pressRatio != null),
  };
}

/** 一句话说清图上的动作，给读屏与截图校验用。 */
export function describeQinFingering(model: QinFingeringModel): string {
  if (!model.drawable || model.stringNumber == null) return "指法图（信息不足）";
  const parts: string[] = [];
  parts.push(`${CN_STRING_TEXT[model.stringNumber]}弦`);
  if (model.toneType === "散") {
    parts.push("散音，左手不触弦");
  } else if (model.pressRatio != null) {
    const pct = Math.round(model.pressRatio * 100);
    parts.push(
      `${model.toneType === "泛" ? "泛音轻触" : "按于"}距岳山 ${pct}% 处`,
    );
    if (model.leftFinger) parts.push(model.leftFinger.name);
  }
  if (model.right) {
    const dir = model.right.toward === "身" ? "向身" : model.right.toward === "外" ? "离身" : "";
    parts.push(`右手${model.right.finger}${model.right.name}${dir}`);
  }
  if (model.slide) {
    parts.push(model.slide === "绰" ? "绰：由低处滑上" : "注：由高处滑下");
  }
  return parts.join(" · ");
}

const CN_STRING_TEXT: Record<number, string> = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
  7: "七",
};
