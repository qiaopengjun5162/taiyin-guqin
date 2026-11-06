/**
 * 时值阶梯 —— 拖动改时值的落点计算。
 *
 * 为什么要有"阶梯"而不是按像素线性插值：时值在谱面上是一组离散档位
 * （全/二分/四分/八分/十六分，各自可加附点）。线性插值会得到「1.37 拍」
 * 这种没法记谱的中间值，落到谱面上只能四舍五入，手感是"拖了没反应"。
 *
 * 所以拖动只做一件事：把手势折算成「在梯子上走几格」，最后落在真实档位上。
 */

import type { Duration } from "./types";
import { durationToBeats } from "./jianzi";

export interface DurationValue {
  duration: Duration;
  dotted: boolean;
}

/**
 * 从短到长，含附点档。
 *
 * 顺序即"拖多远改多大"的尺子：必须按**实际拍数**排，不能按 Duration 的
 * 字面顺序——附点八分（0.75）比四分（1）短，排错会让向右拖反而变短。
 */
export const DURATION_LADDER: DurationValue[] = [
  { duration: "十六分", dotted: false }, // 0.25
  { duration: "八分", dotted: false }, // 0.5
  { duration: "八分", dotted: true }, // 0.75
  { duration: "四分", dotted: false }, // 1
  { duration: "四分", dotted: true }, // 1.5
  { duration: "二分", dotted: false }, // 2
  { duration: "二分", dotted: true }, // 3
  { duration: "全", dotted: false }, // 4
];

/** 每格对应的横向位移（px）。数值偏大是有意的：一格太短会一拖就跳好几档。 */
export const DRAG_STEP_PX = 40;

/** 超过这个位移才判定为"拖动"，否则仍算点击（进编辑模式）。 */
export const DRAG_THRESHOLD_PX = 8;

function beatsOf(v: DurationValue): number {
  return durationToBeats(v.duration, v.dotted);
}

/**
 * 当前时值在阶梯上的位置。
 *
 * 找不到时返回最接近的一档的下标——而不是 0。返回 0 会让"未知时值向右拖"
 * 从十六分开始重来，用户看到时值突然变短。
 */
export function ladderIndex(value: DurationValue): number {
  const exact = DURATION_LADDER.findIndex(
    (v) => v.duration === value.duration && v.dotted === value.dotted,
  );
  if (exact >= 0) return exact;

  const target = beatsOf(value);
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  DURATION_LADDER.forEach((v, i) => {
    const diff = Math.abs(beatsOf(v) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

/** 在阶梯上走 `steps` 格（正数变长、负数变短），越界夹在两端。 */
export function stepDuration(value: DurationValue, steps: number): DurationValue {
  const next = ladderIndex(value) + steps;
  const clamped = Math.min(DURATION_LADDER.length - 1, Math.max(0, next));
  return DURATION_LADDER[clamped];
}

/**
 * 把横向位移折算成新时值。
 *
 * 用 `Math.round` 而不是向下取整：拖 59px 应当算"一格半 → 两格"，
 * 向下取整会让"差一点"的手势完全没反应，用户以为拖坏了。
 */
export function dragDuration(
  start: DurationValue,
  dx: number,
  stepPx: number = DRAG_STEP_PX,
): DurationValue {
  const px = stepPx > 0 ? stepPx : DRAG_STEP_PX;
  const steps = Math.round(dx / px);
  return stepDuration(start, steps);
}

/** 时值的显示名（附点要带出来，否则"四分"与"四分附点"看起来一样）。 */
export function durationLabel(value: DurationValue): string {
  return value.dotted ? `${value.duration}附点` : value.duration;
}
