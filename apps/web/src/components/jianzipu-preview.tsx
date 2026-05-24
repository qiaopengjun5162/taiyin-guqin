"use client";

import type { JianziState } from "@/lib/types";

/** 传统减字谱在方块内的留白比例与主次关系 */
const SERIF_FONT =
  "'Noto Serif SC', 'Songti SC', 'SimSun', 'STSong', serif";

/** 减字预览组件——模拟传统册页中钤印式的谱字。 */
export function JianzipuPreview({ state }: { state: JianziState }) {
  const hasContent =
    state.toneType || state.leftFinger || state.rightAction;

  return (
    <div className="flex items-center justify-center">
      {/* 册页外框——双线 + 朱砂角 */}
      <div className="relative p-2 rounded-sm bg-gradient-to-br from-amber-100 to-amber-50 shadow-inner shadow-amber-900/10">
        {/* 内框——米色方格 */}
        <div
          className="relative w-36 h-36 border border-amber-700/30 bg-[#f8f3eb]"
          style={{ fontFamily: SERIF_FONT }}
        >
          {/* 日字格辅助线（极淡） */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-amber-700/5" />
            <div className="absolute top-1/2 left-0 right-0 h-px bg-amber-700/5" />
          </div>

          {/* ── 左上角标签（音色/节奏，印章式小字） ── */}
          <div className="absolute -top-3.5 left-0 flex gap-2 text-[10px] leading-none tracking-widest text-amber-600/60 select-none">
            <span>{state.toneType ?? ""}</span>
            <span>{state.rhythmMode ?? ""}</span>
          </div>

          {/* ── 左上：左手手指（最大号） ── */}
          <span className="absolute top-3 left-3 text-3xl font-bold leading-none text-stone-800">
            {state.leftFinger ?? ""}
          </span>

          {/* ── 右上：徽位 ── */}
          <span className="absolute top-3 right-3 text-2xl font-bold leading-none text-stone-800">
            {state.hui ?? ""}
          </span>
          {/* 分（极小，徽位左上） */}
          {state.fen && (
            <span className="absolute top-1 right-9 text-[10px] font-medium leading-none text-amber-700">
              {state.fen}
            </span>
          )}

          {/* ── 左下：右手指法 ── */}
          <span className="absolute bottom-3 left-3 text-2xl font-bold leading-none text-stone-800">
            {state.rightAction ?? ""}
          </span>

          {/* ── 右下：弦序 ── */}
          <span className="absolute bottom-3 right-3 text-2xl font-bold leading-none text-stone-800">
            {state.stringNumber ?? ""}
          </span>

          {/* ── 空状态 ── */}
          {!hasContent && (
            <span className="absolute inset-0 flex items-center justify-center text-xs tracking-widest text-amber-400/50 select-none">
              选择音色开始
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
