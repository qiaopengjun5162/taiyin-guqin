"use client";

import type { JianziState } from "@/lib/types";
import { SVG_PATHS } from "@/lib/svg-paths";

// ── mapped into svg path keys ──────────────────

const HUI_MAP: Record<string, string> = {
  "一": "hui_1", "二": "hui_2", "三": "hui_3", "四": "hui_4", "五": "hui_5",
  "六": "hui_6", "七": "hui_7", "八": "hui_8", "九": "hui_9", "十": "hui_10",
  "十一": "hui_11", "十二": "hui_12", "十三": "hui_13",
};

const FEN_MAP: Record<string, string> = {
  "半": "fen_ban",
  "三分": "fen_3",
  "六分": "fen_6",
  "八分": "fen_8",
};

const LEFT_FINGER_MAP: Record<string, string | null> = {
  "大": "lh_da", "夕": "lh_ming", "名": "lh_ming",
  "中": "lh_zhong", "亻": null, "跪": "lh_gui",
};

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

// ── glyph rendering helper ────────────────────

interface BBox {
  xMin: number; yMin: number; xMax: number; yMax: number;
}

/** put a glyph into a viewBox that maps font-coord y-up -> svg y-down */
function GlyphSVG({ d, bbox }: { d: string; bbox: BBox }) {
  const w = bbox.xMax - bbox.xMin;
  const h = bbox.yMax - bbox.yMin;
  if (w <= 0 || h <= 0) return null;
  return (
    <svg
      viewBox={`${bbox.xMin} 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
    >
      <g transform={`scale(1, -1) translate(0, ${-bbox.yMax})`}>
        <path d={d} fill="#1c1b1a" />
      </g>
    </svg>
  );
}

// ── main component ─────────────────────────────

/**
 * SVG 四象限减字块（CSS 绝对定位版）。
 *
 * 完全绕过字体 GSUB，用积木式 SVG path 手动装配减字布局。
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
  const toneType = compact ? null : state.toneType;
  const leftFinger = toneType !== "散" ? state.leftFinger : null;
  const hui = toneType !== "散" ? state.hui : null;
  const fen = toneType !== "散" ? state.fen : null;

  const topKey = toneType === "泛" ? "top_fan" : toneType === "散" ? "top_san" : null;
  const lhKey = leftFinger ? LEFT_FINGER_MAP[leftFinger] ?? null : null;
  const huiKey = hui ? HUI_MAP[hui] : null;
  const fenKey = fen ? FEN_MAP[fen] : null;
  const actionKey = state.rightAction ? RIGHT_ACTION_MAP[state.rightAction] ?? null : null;
  const strKey = state.stringNumber ? STRING_MAP[state.stringNumber] : null;

  const topEntry = topKey ? SVG_PATHS[topKey] : null;
  const lhEntry = lhKey ? SVG_PATHS[lhKey] : null;
  const huiEntry = huiKey ? SVG_PATHS[huiKey] : null;
  const fenEntry = fenKey ? SVG_PATHS[fenKey] : null;
  const actionEntry = actionKey ? SVG_PATHS[actionKey] : null;
  const strEntry = strKey ? SVG_PATHS[strKey] : null;

  // 左手指法 亻 无 svg path -> 用系统楷体回退
  const textFinger: string | null =
    leftFinger && !lhEntry ? (leftFinger === "亻" ? "食" : leftFinger) : null;

  const hasAnything = topEntry || lhEntry || huiEntry || fenEntry || actionEntry || strEntry || textFinger;
  if (!hasAnything) return null;

  // fontSize may contain "px" like "36px" or "24px"
  const numPx = parseFloat(fontSize);

  return (
    <div
      className="relative inline-flex items-center justify-center select-none"
      style={{ width: numPx, height: numPx * 1.4 }}
    >
      {/* ── 顶帽（音色标记） ── */}
      {topEntry?.bbox && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: "2%", width: "44%", height: "16%" }}
        >
          <GlyphSVG d={topEntry.d} bbox={topEntry.bbox} />
        </div>
      )}

      {/* ── 左手指法（左上象限） ── */}
      {lhEntry?.bbox && (
        <div
          className="absolute"
          style={{ top: "17%", left: "3%", width: "34%", height: "24%" }}
        >
          <GlyphSVG d={lhEntry.d} bbox={lhEntry.bbox} />
        </div>
      )}
      {textFinger && (
        <span
          className="absolute"
          style={{
            top: "28%",
            left: "18%",
            transform: "translate(-50%, -50%)",
            fontSize: numPx * 0.28,
            fontFamily: "'KaiTi', 'STKaiti', 'Noto Serif SC', serif",
            color: "#1c1b1a",
            lineHeight: 1,
          }}
        >
          {textFinger}
        </span>
      )}

      {/* ── 徽位（右上象限） ── */}
      {huiEntry?.bbox && (
        <div
          className="absolute"
          style={{ top: "17%", right: "3%", width: "34%", height: "22%" }}
        >
          <GlyphSVG d={huiEntry.d} bbox={huiEntry.bbox} />
        </div>
      )}

      {/* ── 分位（徽位下方） ── */}
      {fenEntry?.bbox && (
        <div
          className="absolute"
          style={{ top: "38%", right: "3%", width: "26%", height: "9%" }}
        >
          <GlyphSVG d={fenEntry.d} bbox={fenEntry.bbox} />
        </div>
      )}

      {/* ── 右手外壳（下半部，半包围结构） ── */}
      {actionEntry?.bbox && (
        <div
          className="absolute"
          style={{ bottom: "1%", left: "0", width: "100%", height: "56%" }}
        >
          <GlyphSVG d={actionEntry.d} bbox={actionEntry.bbox} />
        </div>
      )}

      {/* ── 弦序内核（嵌入右手壳内） ── */}
      {strEntry?.bbox && actionEntry && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ bottom: "19%", width: "28%", height: "20%" }}
        >
          <GlyphSVG d={strEntry.d} bbox={strEntry.bbox} />
        </div>
      )}
      {strEntry?.bbox && !actionEntry && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ bottom: "22%", width: "38%", height: "28%" }}
        >
          <GlyphSVG d={strEntry.d} bbox={strEntry.bbox} />
        </div>
      )}
    </div>
  );
}
