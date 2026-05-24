"use client";

import type { JianziState } from "@/lib/types";

/** 传统减字谱的四个角在方块内的留白比例与主次关系。
 *
 * 左上（左手指法）最有分量 → text-3xl
 * 右上（徽位）适中         → text-2xl
 * 左下（右手指法）适中     → text-2xl
 * 右下（弦序）适中         → text-2xl
 */
const SERIF_FONT =
  "'Noto Serif SC', 'Songti SC', 'SimSun', 'STSong', 'AR PL New Sung', serif";

/** 减字预览组件——模拟传统手写减字谱的方格字。 */
export function JianzipuPreview({ state }: { state: JianziState }) {
  return (
    <div className="flex items-center justify-center">
      {/* 方格：留白内边距加大，模拟宣纸米格 */}
      <div
        className="relative w-36 h-36 border-2 border-amber-800/70 dark:border-amber-600/60 rounded bg-amber-50/80 dark:bg-amber-950/20 shadow-sm"
        style={{ fontFamily: SERIF_FONT }}
      >
        {/* ── 音色标签（左上外侧） ── */}
        {state.toneType && (
          <span className="absolute -top-3.5 -left-0.5 text-[11px] font-medium leading-none text-amber-600/80 dark:text-amber-400/80 tracking-wider">
            {state.toneType}
          </span>
        )}

        {/* ── 节奏标签（左下外侧） ── */}
        {state.rhythmMode && (
          <span className="absolute -bottom-3.5 -left-0.5 text-[11px] font-medium leading-none text-amber-500/70 dark:text-amber-500/70 tracking-wider">
            {state.rhythmMode}
          </span>
        )}

        {/* ── 左上：左手手指（最大号，占左上象限） ── */}
        <span className="absolute top-3 left-3 text-3xl font-bold leading-none text-amber-950 dark:text-amber-200">
          {state.leftFinger ?? ""}
        </span>

        {/* ── 右上：徽位 + 分 ── */}
        <span className="absolute top-3 right-3 text-2xl font-bold leading-none text-amber-950 dark:text-amber-200">
          {state.hui ?? ""}
        </span>
        {/* 分（小字，徽位右上角） */}
        {state.fen && (
          <span className="absolute -top-0.5 right-10 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-400">
            {state.fen}
          </span>
        )}

        {/* ── 左下：右手指法 ── */}
        <span className="absolute bottom-3 left-3 text-2xl font-bold leading-none text-amber-950 dark:text-amber-200">
          {state.rightAction ?? ""}
        </span>

        {/* ── 右下：弦序 ── */}
        <span className="absolute bottom-3 right-3 text-2xl font-bold leading-none text-amber-950 dark:text-amber-200">
          {state.stringNumber ?? ""}
        </span>

        {/* ── 空状态提示 ── */}
        {!state.toneType && !state.leftFinger && !state.rightAction && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-amber-400/60 dark:text-amber-600/40 tracking-widest select-none">
            选择音色开始
          </span>
        )}
      </div>
    </div>
  );
}
