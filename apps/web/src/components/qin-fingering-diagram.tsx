"use client";

import { useMemo } from "react";
import type { JianziState } from "@/lib/types";
import {
  buildQinFingering,
  describeQinFingering,
  HUI_LABELED,
  HUI_TICKS,
  QIN_STRING_COUNT,
} from "@/lib/qin-fingering";

/**
 * 琴面指法图 —— 把减字画成「手该落哪儿」。
 *
 * 俯视琴面：左边是岳山（琴头），右边是龙龈（琴尾），
 * 七弦在上、一弦在下（坐在琴前时一弦离身体最近）。
 *
 * 图上只画三件事：哪根弦亮着、按点离岳山多远、右手往哪边拨。
 * 位置不用另算——`buildQinFingering` 用的是音高推算那一套徽分换算，
 * 图上的点与耳朵听到的音必须指向同一个位置，否则不如不画。
 */

const VB_W = 360;
const VB_H = 136;

const X_HILL = 34; // 岳山
const X_BRIDGE = 332; // 龙龈
const SPAN = X_BRIDGE - X_HILL;

const Y_TOP_STRING = 28; // 七弦
const STRING_STEP = 14;

/** 弹弦区：岳山与一徽之间，实际就在这一小段上拨弦 */
const X_PLUCK = X_HILL + 20;

const PAPER = "#f6efe1";
const INK = "#4a3728";
const STRING_IDLE = "#c9b79a";
const TICK = "#e7dac2";
const HUI_TEXT = "#a68f6f";
const MARK = "#9a3b2a";

function yOf(n: number): number {
  return Y_TOP_STRING + (QIN_STRING_COUNT - n) * STRING_STEP;
}

function xOf(ratio: number): number {
  return X_HILL + ratio * SPAN;
}

/** 压在弦线上的小字：先描一圈纸色，否则字和线糊在一起 */
const halo = {
  paintOrder: "stroke" as const,
  stroke: PAPER,
  strokeWidth: 2.6,
  strokeLinejoin: "round" as const,
};

export function QinFingeringDiagram({ state }: { state: JianziState }) {
  const model = useMemo(() => buildQinFingering(state), [state]);
  if (!model.drawable || model.stringNumber == null) return null;

  const activeY = yOf(model.stringNumber);
  const pressX = model.pressRatio != null ? xOf(model.pressRatio) : null;
  const isOpen = model.toneType === "散";
  const isHarmonic = model.toneType === "泛";

  return (
    <svg
      data-testid="qin-fingering-diagram"
      data-string={model.stringNumber}
      data-tone={model.toneType ?? ""}
      data-press-ratio={model.pressRatio != null ? model.pressRatio.toFixed(4) : ""}
      role="img"
      aria-label={`琴面指法图：${describeQinFingering(model)}`}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="mt-2 h-auto w-full max-w-[360px]"
    >
      {/* 琴面 */}
      <rect
        x={0.5}
        y={0.5}
        width={VB_W - 1}
        height={VB_H - 1}
        rx={6}
        fill={PAPER}
        stroke="#e3d4ba"
      />

      {/* 十三徽：细虚线刻到琴面，数字只标传统认位用的五个锚点 */}
      {HUI_TICKS.map((hui) => {
        const current = hui.number === model.huiNumber;
        return (
          <line
            key={`tick-${hui.number}`}
            data-hui={hui.number}
            data-current={current || undefined}
            x1={xOf(hui.ratio)}
            x2={xOf(hui.ratio)}
            y1={20}
            y2={116}
            stroke={current ? MARK : TICK}
            strokeWidth={current ? 1.2 : 1}
            strokeDasharray={current ? undefined : "1.5 4.5"}
            opacity={current ? 0.55 : 1}
          />
        );
      })}
      {HUI_TICKS.filter((h) => HUI_LABELED.has(h.number)).map((hui) => (
        <text
          key={`label-${hui.number}`}
          x={xOf(hui.ratio)}
          y={15}
          textAnchor="middle"
          fontSize={8.5}
          fill={HUI_TEXT}
        >
          {CN_HUI[hui.number]}
        </text>
      ))}
      {/* 只标五个锚点仍然数不出九徽是第几徽，底部把当前徽位写出来 */}
      {model.huiNumber != null && (
        <text
          x={xOf(HUI_TICKS[model.huiNumber - 1].ratio)}
          y={128}
          textAnchor="middle"
          fontSize={8.5}
          fill={MARK}
        >
          {CN_HUI[model.huiNumber]}徽
        </text>
      )}

      {/* 岳山 / 龙龈 */}
      <rect x={X_HILL - 4} y={22} width={4} height={96} fill="#8a6f52" />
      <rect x={X_BRIDGE} y={22} width={4} height={96} fill="#8a6f52" />
      <text x={X_HILL - 2} y={128} textAnchor="middle" fontSize={8.5} fill={HUI_TEXT}>
        岳山
      </text>
      <text x={X_BRIDGE + 2} y={128} textAnchor="middle" fontSize={8.5} fill={HUI_TEXT}>
        龙龈
      </text>

      {/* 七弦 */}
      {Array.from({ length: QIN_STRING_COUNT }, (_, i) => i + 1).map((n) => {
        const active = n === model.stringNumber;
        return (
          <g key={`string-${n}`}>
            <line
              x1={X_HILL}
              x2={X_BRIDGE}
              y1={yOf(n)}
              y2={yOf(n)}
              stroke={active ? INK : STRING_IDLE}
              strokeWidth={active ? 1.9 : 1}
            />
            <text
              x={20}
              y={yOf(n) + 3}
              textAnchor="middle"
              fontSize={9}
              fill={active ? INK : STRING_IDLE}
              fontWeight={active ? 600 : 400}
            >
              {CN_HUI[n]}
            </text>
          </g>
        );
      })}

      {/* 按点 / 泛音点 / 散音标记 */}
      {pressX != null && !isOpen && (
        <g>
          {isHarmonic ? (
            // 泛音是虚按徽位、一触即离，画空心菱形，与实按区分开
            <rect
              x={pressX - 4}
              y={activeY - 4}
              width={8}
              height={8}
              fill={PAPER}
              stroke={MARK}
              strokeWidth={1.6}
              transform={`rotate(45 ${pressX} ${activeY})`}
            />
          ) : (
            <circle cx={pressX} cy={activeY} r={4} fill={MARK} stroke={PAPER} strokeWidth={1.4} />
          )}
          {model.leftFinger && (
            <text
              x={pressX}
              y={activeY - 7}
              textAnchor="middle"
              fontSize={9}
              fill={MARK}
              style={halo}
            >
              {model.leftFinger.name.replace("指", "")}
            </text>
          )}
        </g>
      )}

      {isOpen && (
        <text
          x={X_PLUCK + 24}
          y={activeY - 7}
          textAnchor="middle"
          fontSize={9}
          fill={MARK}
          style={halo}
        >
          散
        </text>
      )}

      {/* 走手音：绰由岳山一侧滑来，注由龙龈一侧滑下，箭头都指向本位 */}
      {pressX != null && model.slide && (
        <g>
          <line
            x1={model.slide === "绰" ? pressX - 26 : pressX + 26}
            x2={model.slide === "绰" ? pressX - 8 : pressX + 8}
            y1={activeY}
            y2={activeY}
            stroke={MARK}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
          <path
            d={
              model.slide === "绰"
                ? `M ${pressX - 11} ${activeY - 3} L ${pressX - 7} ${activeY} L ${pressX - 11} ${activeY + 3} Z`
                : `M ${pressX + 11} ${activeY - 3} L ${pressX + 7} ${activeY} L ${pressX + 11} ${activeY + 3} Z`
            }
            fill={MARK}
          />
        </g>
      )}

      {/* 右手：箭头方向 = 拨弦方向（向内朝身、向外离身） */}
      {model.right && (
        <g>
          <line
            x1={X_PLUCK}
            x2={X_PLUCK}
            y1={model.right.toward === "外" ? activeY + 8 : activeY - 8}
            y2={model.right.toward === "外" ? activeY - 8 : activeY + 8}
            stroke={MARK}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
          {model.right.toward !== null && (
            <path
              d={
                model.right.toward === "外"
                  ? `M ${X_PLUCK - 3} ${activeY - 5} L ${X_PLUCK + 3} ${activeY - 5} L ${X_PLUCK} ${activeY - 9.5} Z`
                  : `M ${X_PLUCK - 3} ${activeY + 5} L ${X_PLUCK + 3} ${activeY + 5} L ${X_PLUCK} ${activeY + 9.5} Z`
              }
              fill={MARK}
            />
          )}
          <text
            x={X_PLUCK + 7}
            y={activeY + 3}
            fontSize={9}
            fill={MARK}
            style={halo}
          >
            {model.right.name}
          </text>
        </g>
      )}
    </svg>
  );
}

const CN_HUI: Record<number, string> = {
  1: "一",
  2: "二",
  3: "三",
  4: "四",
  5: "五",
  6: "六",
  7: "七",
  8: "八",
  9: "九",
  10: "十",
  11: "十一",
  12: "十二",
  13: "十三",
};
