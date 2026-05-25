"use client";

import type { JianziState } from "@/lib/types";
import { JianziBlock } from "./jianzi-block";

const SERIF_FONT = "var(--font-serif), 'Noto Serif SC', 'Songti SC', serif";

/**
 * 减字预览 —— 在宣纸质感框内展示减字块。
 */
export function JianzipuPreview({ state }: { state: JianziState }) {
  const hasContent =
    state.toneType || state.leftFinger || state.rightAction;

  return (
    <div className="flex items-center justify-center">
      <div className="relative p-2 rounded-sm bg-gradient-to-br from-amber-100 to-amber-50 shadow-inner shadow-amber-900/10">
        {/* 外框 */}
        <div
          className="relative w-28 h-32 border border-amber-700/30 bg-[#f8f3eb] flex items-center justify-center"
          style={{ fontFamily: SERIF_FONT }}
        >
          {/* ── 外侧标签（音色/节奏） ── */}
          <div className="absolute -top-3.5 left-0 flex gap-2 text-[10px] leading-none tracking-widest text-amber-600/50 select-none">
            <span>{state.toneType ?? ""}</span>
            <span>{state.rhythmMode ?? ""}</span>
          </div>

          {/* ── 减字块 ── */}
          {hasContent ? (
            <JianziBlock state={state} />
          ) : (
            /* ── 空状态 ── */
            <span className="text-xs tracking-widest text-amber-400/40 select-none">
              选择音色
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
