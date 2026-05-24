"use client";

import { useState } from "react";
import {
  type JianziState,
  DEFAULT_KEYBOARD,
  createEmptyState,
  isComplete,
  type NoteType,
} from "@/lib/types";
import { JianzipuPreview } from "./jianzipu-preview";

type Section =
  | "toneType"
  | "leftFinger"
  | "hui"
  | "fen"
  | "rightAction"
  | "stringNumber";

/**
 * 减字键盘主组件。
 *
 * 流程：先选音色（散/泛/按），再按顺序拼装：
 *
 *   ┌───────┐
 *   │ 左手  │ 徽位  │   散音省略左手和徽位
 *   │ 右手  │ 弦序  │
 *   └───────┘
 *
 * 顶部实时显示拼装中的减字。点击"重置"清除所有选择。
 */
export function JianzipuKeyboard() {
  const [state, setState] = useState<JianziState>(createEmptyState);

  /** 点击某个按键后更新对应字段。 */
  function handleSelect(section: Section, value: string) {
    setState((prev) => ({ ...prev, [section]: value }));
  }

  /** 重置所有选择。 */
  function handleReset() {
    setState(createEmptyState());
  }

  /** 拼装完成后输出 JSON（后续可扩展为导出/上传）。 */
  function handleConfirm() {
    if (!isComplete(state)) return;
    const json = JSON.stringify(state, null, 2);
    // MVP 阶段：弹窗显示 JSON，后续替换为导出功能
    alert(json);
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md mx-auto">
      {/* ── 预览区 ── */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs text-muted-foreground tracking-wider">
          减字预览
        </p>
        <JianzipuPreview state={state} />
      </div>

      {/* ── 按键区 ── */}
      <div className="w-full space-y-4">
        {/* 音色 */}
        <SectionGroup
          label="音色"
          items={DEFAULT_KEYBOARD.toneTypes}
          active={state.toneType}
          onSelect={(v) => handleSelect("toneType", v as NoteType)}
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
          className="flex-1 px-4 py-2 text-sm rounded-md border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
        >
          重置
        </button>
        <button
          onClick={handleConfirm}
          disabled={!isComplete(state)}
          className="flex-1 px-4 py-2 text-sm rounded-md bg-amber-800 text-amber-50 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-700 transition-colors"
        >
          确认
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 分区按钮组
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
  // 徽位和分为"无"——允许用户取消选择徽位的"分"
  const showNone = label === "分";

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {showNone && (
          <button
            onClick={() => onSelect("")}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              active === ""
                ? "bg-amber-800 text-amber-50 border-amber-800"
                : "border-amber-200 dark:border-amber-800 text-muted-foreground hover:bg-amber-50 dark:hover:bg-amber-900/20"
            }`}
          >
            无
          </button>
        )}
        {items.map((item) => (
          <button
            key={item}
            onClick={() => onSelect(item)}
            className={`px-3 py-1 text-sm rounded border transition-colors ${
              active === item
                ? "bg-amber-800 text-amber-50 border-amber-800"
                : "border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
