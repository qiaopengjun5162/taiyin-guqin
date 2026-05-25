"use client";

import type { JianziState } from "@/lib/types";
import { SVG_PATHS, FONT_UPEM } from "@/lib/svg-paths";

// ── JianziState → SVG_PATHS key 映射 ─────────────────

const HUI_MAP: Record<string, string> = {
  "一": "hui_1", "二": "hui_2", "三": "hui_3", "四": "hui_4", "五": "hui_5",
  "六": "hui_6", "七": "hui_7", "八": "hui_8", "九": "hui_9", "十": "hui_10",
  "十一": "hui_11", "十二": "hui_12", "十三": "hui_13",
};

const FEN_MAP: Record<string, string> = {
  "半": "fen_ban",
};

const LEFT_FINGER_MAP: Record<string, string | null> = {
  "大": "lh_da",
  "夕": "lh_ming",
  "名": "lh_ming",
  "中": "lh_zhong",
  "亻": null,  // 无 SVG path → 降级为 <text>
  "跪": "lh_gui",
};

// 右手动作：keyboard 偏旁或 GSUB 全形 → SVG path key
const RIGHT_ACTION_MAP: Record<string, string | null> = {
  "勾": "rh_gou", "勹": "rh_gou",
  "挑": "rh_tiao", "乚": "rh_tiao",
  "抹": "rh_mo", "木": "rh_mo",
  "托": "rh_tuo", "乇": "rh_tuo",
  "打": "rh_da", "丁": "rh_da",
  "擘": "rh_pi", "劈": "rh_pi", "尸": "rh_pi",
  "摘": "rh_zhai", "倽": "rh_zhai",
  "剔": "rh_ti",
};

const STRING_MAP: Record<string, string> = {
  "一": "str_1", "二": "str_2", "三": "str_3", "四": "str_4",
  "五": "str_5", "六": "str_6", "七": "str_7",
};

// ── 部件渲染 ─────────────────────────────────────

interface PartProps {
  pathKey: string;
  cx: number;      // 目标居中 x（viewBox 坐标）
  cy: number;      // 目标居中 y（viewBox 坐标）
  maxW: number;    // 最大允许宽度
  maxH: number;    // 最大允许高度
  padding?: number; // 缩放内边距系数 (0-1)
}

/** 在 viewBox 内渲染一个 SVG path 积木，居中于 (cx,cy)，缩放适配 maxW×maxH */
function GlyphPart({ pathKey, cx, cy, maxW, maxH, padding = 0.85 }: PartProps) {
  const entry = SVG_PATHS[pathKey];
  if (!entry?.bbox) return null;

  const { xMin, yMin, xMax, yMax } = entry.bbox;
  const glyphW = xMax - xMin;
  const glyphH = yMax - yMin;
  if (glyphW <= 0 || glyphH <= 0) return null;

  const gcX = (xMin + xMax) / 2;
  const gcY = (yMin + yMax) / 2;
  const scale = Math.min(maxW / glyphW, maxH / glyphH) * padding;

  return (
    <path
      d={entry.d}
      transform={`translate(${cx}, ${cy}) scale(${scale}, ${-scale}) translate(${-gcX}, ${-gcY})`}
    />
  );
}

// ── 主组件 ──────────────────────────────────────

/**
 * SVG 四象限减字块。
 *
 * 完全绕过字体 GSUB，用积木式 SVG path 手动装配减字布局：
 *
 *   ┌─────────────────────┐
 *   │   顶帽（音色标记）     │  y: 0-12%
 *   ├──────────┬──────────┤
 *   │ 左手指法  │ 徽位/分   │  y: 12-40%
 *   ├──────────┴──────────┤
 *   │   右手外壳 + 弦序内核  │  y: 40-100%
 *   └─────────────────────┘
 *
 * 降级条件（由 JianziBlock 父组件判定）：
 *   toneType === "泛" || ["打", "摘"].includes(rightAction)
 */
export function SvgJianziBlock({
  state,
  fontSize = "36px",
  compact,
}: {
  state: JianziState;
  fontSize?: string;
  compact?: boolean;
}) {
  const vbW = FONT_UPEM;        // 1000
  const vbH = Math.round(FONT_UPEM * 1.4); // 1400

  const toneType = compact ? null : state.toneType;
  const leftFinger = toneType !== "散" ? state.leftFinger : null;
  const hui = toneType !== "散" ? state.hui : null;
  const fen = toneType !== "散" ? state.fen : null;

  // SVG path key 查找
  const topKey = toneType === "泛" ? "top_fan" : toneType === "散" ? "top_san" : null;
  const lhKey = leftFinger ? LEFT_FINGER_MAP[leftFinger] ?? null : null;
  const huiKey = hui ? HUI_MAP[hui] : null;
  const fenKey = fen ? FEN_MAP[fen] : null;
  const actionKey = state.rightAction ? RIGHT_ACTION_MAP[state.rightAction] ?? null : null;
  const strKey = state.stringNumber ? STRING_MAP[state.stringNumber] : null;

  // 降级为 <text> 的字符（左手 亻→食、按音帽）
  const textFinger = leftFinger && !lhKey ? (leftFinger === "亻" ? "食" : leftFinger) : null;

  // 没有任何内容可渲染
  if (!topKey && !lhKey && !huiKey && !actionKey && !strKey && !textFinger) return null;

  const numeric = Math.round(parseFloat(fontSize) * 0.48);

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={fontSize}
      height={`calc(${fontSize} * 1.4)`}
      style={{ display: "block", overflow: "visible" }}
      className="select-none"
    >
      {/* ── 顶帽 ── */}
      {topKey && (
        <GlyphPart pathKey={topKey} cx={vbW / 2} cy={vbH * 0.08} maxW={vbW * 0.40} maxH={vbH * 0.14} />
      )}

      {/* ── 左手指法 ── */}
      {lhKey && (
        <GlyphPart pathKey={lhKey} cx={vbW * 0.20} cy={vbH * 0.26} maxW={vbW * 0.30} maxH={vbH * 0.24} />
      )}
      {textFinger && (
        <text
          x={vbW * 0.20} y={vbH * 0.26}
          textAnchor="middle" dominantBaseline="central"
          fontSize={numeric * 2.5}
          fontFamily="'TaiYinJianZiPuKaiTi', 'KaiTi', serif"
          fill="#1c1b1a"
        >
          {textFinger}
        </text>
      )}

      {/* ── 徽位 ── */}
      {huiKey && (
        <GlyphPart pathKey={huiKey} cx={vbW * 0.78} cy={vbH * 0.25} maxW={vbW * 0.30} maxH={vbH * 0.24} />
      )}

      {/* ── 分位 ── */}
      {fenKey && (
        <GlyphPart pathKey={fenKey} cx={vbW * 0.78} cy={vbH * 0.38} maxW={vbW * 0.24} maxH={vbH * 0.12} />
      )}

      {/* ── 右手外壳（半包围结构） ── */}
      {actionKey && (
        <GlyphPart pathKey={actionKey} cx={vbW / 2} cy={vbH * 0.65} maxW={vbW * 0.70} maxH={vbH * 0.50} />
      )}

      {/* ── 弦序内核（嵌套在外壳内部） ── */}
      {strKey && actionKey && (
        <GlyphPart
          pathKey={strKey}
          cx={vbW / 2} cy={vbH * 0.68}
          maxW={vbW * 0.26} maxH={vbH * 0.20}
          padding={0.60}
        />
      )}
      {strKey && !actionKey && (
        <GlyphPart pathKey={strKey} cx={vbW / 2} cy={vbH * 0.65} maxW={vbW * 0.40} maxH={vbH * 0.30} />
      )}
    </svg>
  );
}
