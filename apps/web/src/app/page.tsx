"use client";

import { useState } from "react";
import type { NoteColumn } from "@/lib/types";
import { ScoreView } from "@/components/score-view";
import { JianzipuKeyboard } from "@/components/jianzipu-keyboard";

/**
 * 数据流：
 *
 *   ScoreView（展示）          JianzipuKeyboard（编辑）
 *       │  onEdit(index)            ↑ defaultNote (回填)
 *       │  onRemove(id)             │ onAppend (追加 / 替换)
 *       └────→  page.tsx ──────────┘
 *               ↑
 *           editingIndex: 编辑中的音符序号
 *
 * 编辑模式：点击 ScoreView 中的音符列 → editingIndex 赋值为该列索引 →
 * key 变化强制键盘 remount → defaultNote 填充键盘 state → 修改后确认 →
 * editingIndex !== null 时替换 score[editingIndex] 而非 append。
 *
 * 追加模式：editingIndex === null，纯 append。
 *
 * 删除时若恰好删除编辑中的音符，即时退出编辑模式。
 */
export default function Home() {
  const [score, setScore] = useState<NoteColumn[]>([]);
  // 点击乐谱流音符后，键盘自动加载该音符数据供修改
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  /** 点击乐谱流音符 → 键盘回填数据 + 滚动到键盘区 */
  function handleEdit(index: number) {
    setEditingIndex(index);
    document.getElementById("keyboard-area")?.scrollIntoView({ behavior: "smooth" });
  }

  /**
   * 键盘确认回调。
   * editingIndex !== null 时替换对应音符而非追加，复用同一 onAppend 回调。
   * 提交后清除编辑状态（键盘重置为初始态）。
   */
  function handleAppend(note: NoteColumn) {
    setScore((prev) => {
      if (editingIndex !== null) {
        const next = [...prev];
        next[editingIndex] = note;
        return next;
      }
      return [...prev, note];
    });
    setEditingIndex(null);
  }

  /** 删除音符时，若恰好是当前编辑项则退出编辑模式 */
  function handleRemove(id: string) {
    setScore((prev) => {
      const removedIdx = prev.findIndex((n) => n.id === id);
      if (removedIdx >= 0 && editingIndex === removedIdx) {
        setEditingIndex(null);
      }
      return prev.filter((n) => n.id !== id);
    });
  }

  return (
    <main className="flex flex-col items-center min-h-dvh py-10 px-4">
      {/* ── 品牌：朱砂印章（主视觉标识） ── */}
      <div className="flex flex-col items-center gap-4">
        {/* 朱砂印章 */}
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full border-[3px] border-[var(--vermillion)]/50 shadow-xl shadow-[var(--vermillion)]/5">
          <span
            className="text-3xl font-black tracking-[0.25em] text-[var(--vermillion)]/85 select-none ink-bleed font-calligraphy"
          >
            太音
          </span>
        </div>
        <div className="text-center">
          <h1
            className="text-sm font-bold tracking-[0.4em] text-amber-100/80 leading-relaxed"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            古琴 · 减字谱 · 拼装键盘
          </h1>
          <p className="mt-1 text-[10px] tracking-[0.25em] text-amber-600/40">
            TAIYIN GUQIN
          </p>
        </div>
      </div>

      {/* ── 乐谱流 ── */}
      <div id="score-area" className="mt-8 w-full max-w-md">
        <ScoreView notes={score} onRemove={handleRemove} onEdit={handleEdit} editingIndex={editingIndex} />
      </div>

      {/* ── 导出按钮（有内容时显示） ── */}
      {score.length > 0 && (
        <div className="no-print mt-3 w-full max-w-md flex justify-end">
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all"
          >
            导出 PDF
          </button>
        </div>
      )}

      {/* ── 主卡片 —— 宣纸质感 ── */}
      <div
        id="keyboard-area"
        className="no-print mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30"
      >
        {/* 卡片顶部装饰线（朱砂色） */}
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />

        <div className="p-5">
          {editingIndex !== null && (
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] tracking-wider text-amber-600/60">
                正在编辑第 {editingIndex + 1} 音 · 确认后更新
              </p>
              <button
                onClick={() => setEditingIndex(null)}
                className="text-[10px] tracking-wider text-stone-400 hover:text-stone-600 transition-colors underline underline-offset-2"
              >
                取消编辑
              </button>
            </div>
          )}
          {/*
           * key 随 editingIndex 变化强制键盘组件完全重建，确保 useState 初始值携带新数据。
           * defaultNote 为 undefined 时键盘表现正常（追加模式）。
           */}
          <JianzipuKeyboard
            key={editingIndex ?? "default"}
            defaultNote={editingIndex !== null ? score[editingIndex] : undefined}
            onAppend={handleAppend}
          />
        </div>
      </div>

      {/* ── 页脚 ── */}
      <p className="no-print mt-auto pt-10 text-[11px] tracking-[0.15em] text-amber-700/30">
        先选音色，再依次拼出完整减字
      </p>
    </main>
  );
}
