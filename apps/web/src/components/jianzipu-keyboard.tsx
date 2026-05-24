"use client";

import { useState } from "react";
import {
  type JianziState,
  DEFAULT_KEYBOARD,
  createEmptyState,
  isComplete,
  type NoteType,
  type RhythmMode,
} from "@/lib/types";
import { JianzipuPreview } from "./jianzipu-preview";

type Section =
  | "toneType"
  | "rhythmMode"
  | "leftFinger"
  | "hui"
  | "fen"
  | "rightAction"
  | "stringNumber";

/**
 * 减字键盘主组件。
 *
 * 流程：先选音色（散/泛/按）和节奏（板/散/宕），再按顺序拼装。
 *
 * 右手指法采用传统减字偏旁：
 * 乇=托 尸=擘 木=抹 乚=挑 勹=勾 剔 丁=打 倽=摘
 */
export function JianzipuKeyboard() {
  const [state, setState] = useState<JianziState>(createEmptyState);

  function handleSelect(section: Section, value: string) {
    setState((prev) => ({ ...prev, [section]: value }));
  }

  function handleReset() {
    setState(createEmptyState());
  }

  function handleConfirm() {
    if (!isComplete(state)) return;
    const json = JSON.stringify(state, null, 2);
    alert(json);
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* ── 预览区 ── */}
      <div className="flex flex-col items-center gap-2">
        <JianzipuPreview state={state} />
      </div>

      {/* ── 按键区 ── */}
      <div className="w-full space-y-5">
        {/* 音色 */}
        <SectionGroup
          label="音色"
          items={DEFAULT_KEYBOARD.toneTypes}
          active={state.toneType}
          onSelect={(v) => handleSelect("toneType", v as NoteType)}
        />

        {/* 节奏 */}
        <SectionGroup
          label="节奏"
          items={DEFAULT_KEYBOARD.rhythmModes}
          active={state.rhythmMode}
          onSelect={(v) => handleSelect("rhythmMode", v as RhythmMode)}
        />

        {/* 左手手指（散音时隐藏） */}
        {state.toneType !== "散" && (
          <SectionGroup
            label="左手"
            items={DEFAULT_KEYBOARD.leftFingers}
            active={state.leftFinger}
            onSelect={(v) => handleSelect("leftFinger", v)}
          />
        )}

        {/* 徽位（散音时隐藏） */}
        {state.toneType !== "散" && (
          <SectionGroup
            label="徽位"
            items={DEFAULT_KEYBOARD.huiPositions}
            active={state.hui}
            onSelect={(v) => handleSelect("hui", v)}
          />
        )}

        {/* 分 */}
        {state.toneType !== "散" && (
          <SectionGroup
            label="分"
            items={DEFAULT_KEYBOARD.fenOptions}
            active={state.fen}
            onSelect={(v) => handleSelect("fen", v)}
          />
        )}

        {/* 右手指法 */}
        <SectionGroup
          label="右手"
          items={DEFAULT_KEYBOARD.rightActions}
          active={state.rightAction}
          onSelect={(v) => handleSelect("rightAction", v)}
        />

        {/* 弦序 */}
        <SectionGroup
          label="弦序"
          items={DEFAULT_KEYBOARD.stringNumbers}
          active={state.stringNumber}
          onSelect={(v) => handleSelect("stringNumber", v)}
        />
      </div>

      {/* ── 操作按钮 ── */}
      <div className="flex gap-3 w-full">
        <button
          onClick={handleReset}
          className="flex-1 px-4 py-2.5 text-sm rounded border border-amber-700/30 text-stone-600 hover:bg-amber-700/10 hover:text-stone-800 transition-all duration-200 active:scale-[0.98]"
        >
          重置
        </button>
        <button
          onClick={handleConfirm}
          disabled={!isComplete(state)}
          className="flex-1 px-4 py-2.5 text-sm rounded bg-stone-800 text-amber-50 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-700 active:scale-[0.98] transition-all duration-200"
        >
          确认
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 墨色按键组
// ──────────────────────────────────────────────

function SectionGroup({
  label,
  items,
  active,
  onSelect,
}: {
  label: string;
  items: string[];
  active: string | null;
  onSelect: (value: string) => void;
}) {
  const isFen = label === "分";

  return (
    <div>
      <p className="text-[11px] tracking-[0.15em] text-stone-500 mb-1.5">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {isFen && (
          <button
            onClick={() => onSelect("")}
            className={`px-2.5 py-1 text-xs rounded border transition-all duration-150 ${
              active === ""
                ? "border-stone-800 bg-stone-800 text-amber-50"
                : "border-stone-300/60 text-stone-400 hover:border-stone-400 hover:text-stone-600"
            }`}
          >
            无
          </button>
        )}
        {items.map((item) => (
          <button
            key={item}
            onClick={() => onSelect(item)}
            className={`px-3 py-1.5 text-sm rounded border transition-all duration-150 active:scale-95 ${
              active === item
                ? "border-amber-700/60 bg-amber-700/90 text-amber-50 shadow-sm"
                : "border-stone-300/50 text-stone-600 hover:border-amber-600/30 hover:bg-amber-50 hover:text-stone-800"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
