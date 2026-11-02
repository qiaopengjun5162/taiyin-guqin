"use client";

/**
 * 音位候选卡片。
 *
 * 旧版候选是一排纯文字按钮（「散挑一」「大九勾四」）：能选，但看不出
 * 这个位置在几弦几徽、哪根手指、听起来差在哪。这里换成
 * **真减字字形 + 弦徽指法小字 + 试听**，一个音位一眼看完。
 *
 * 字形走 `JianziBlock`（字体 GSUB 为主、SVG 积木兜底），与谱面同一套渲染，
 * 所以候选里长什么样，录进谱子就长什么样。
 */

import type { JianziState } from "@/lib/types";
import { shortCaption } from "@/lib/jianzi-explain";
import { JianziBlock } from "../jianzi-block";

export function CandidateChip({
  state,
  selected,
  score,
  onPick,
  onPreview,
}: {
  state: JianziState;
  selected?: boolean;
  /** Rust 侧舒适性评分，鼠标悬停时说明「为什么排前面」。 */
  score?: number;
  onPick: () => void;
  /** 有回调才显示试听按钮（无音频上下文的环境下不画）。 */
  onPreview?: () => void;
}) {
  const caption = shortCaption(state);
  const tone = state.toneType ?? "按";

  return (
    <div
      className={`relative flex flex-col items-stretch overflow-hidden rounded border transition-colors ${
        selected
          ? "border-amber-700 bg-amber-100/80"
          : "border-amber-700/25 bg-white/70 hover:border-amber-700/50 hover:bg-amber-50"
      }`}
      title={score != null ? `${caption.full}（舒适度 ${score}）` : caption.full}
    >
      <button
        type="button"
        onClick={onPick}
        aria-pressed={selected ?? false}
        aria-label={`${caption.full}，录入此音位`}
        className="flex flex-col items-center gap-0.5 px-1 pt-1 pb-1.5 text-center"
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-sm border border-amber-900/10 bg-white shadow-sm"
          // 泛音是虚按，字形压淡一点，扫视时能和按/散分开
          style={{ opacity: tone === "泛" ? 0.85 : 1 }}
        >
          <JianziBlock state={state} fontSize="26px" />
        </span>
        <span className="w-full truncate text-[10px] leading-tight text-stone-700">
          {caption.primary}
        </span>
        <span className="w-full truncate text-[9px] leading-tight text-stone-500">
          {caption.secondary}
        </span>
      </button>
      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`试听：${caption.full}`}
          className="absolute right-0 top-0 px-1 text-[10px] leading-4 text-amber-700/60 hover:text-amber-900"
        >
          ▶
        </button>
      )}
    </div>
  );
}
