"use client";

import type { JianziState } from "@/lib/types";

/** 减字预览组件——将四个构件在方块内用绝对定位拼装为一个减字。 */
export function JianzipuPreview({ state }: { state: JianziState }) {
  return (
    <div className="flex items-center justify-center">
      {/* 外框：模拟传统手写减字谱的方格 */}
      <div className="relative w-28 h-28 border-2 border-amber-800 dark:border-amber-600 rounded-md bg-amber-50 dark:bg-amber-950/30">
        {/* 左上：左手手指 */}
        <span className="absolute top-1 left-1 text-xl font-bold text-amber-950 dark:text-amber-200">
          {state.leftFinger ?? ""}
        </span>
        {/* 左下：徽位 */}
        <span className="absolute bottom-1 left-1 text-lg font-bold text-amber-950 dark:text-amber-200">
          {state.hui ?? ""}
        </span>
        {/* 右上：右手指法 */}
        <span className="absolute top-1 right-1 text-xl font-bold text-amber-950 dark:text-amber-200">
          {state.rightAction ?? ""}
        </span>
        {/* 右下：弦序 + 分 */}
        <span className="absolute bottom-1 right-1 text-lg font-bold text-amber-950 dark:text-amber-200">
          {state.stringNumber ?? ""}
        </span>
        {/* 分标记（小号，右上角徽位旁边） */}
        {state.fen && (
          <span className="absolute top-0 left-6 text-xs text-amber-700 dark:text-amber-400">
            {state.fen}
          </span>
        )}
      </div>
    </div>
  );
}
