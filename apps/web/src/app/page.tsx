"use client";

import { useState } from "react";
import type { NoteColumn } from "@/lib/types";
import { ScoreView } from "@/components/score-view";
import { JianzipuKeyboard } from "@/components/jianzipu-keyboard";

export default function Home() {
  const [score, setScore] = useState<NoteColumn[]>([]);

  function handleAppend(note: NoteColumn) {
    setScore((prev) => [...prev, note]);
  }

  function handleRemove(id: string) {
    setScore((prev) => prev.filter((n) => n.id !== id));
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
        <ScoreView notes={score} onRemove={handleRemove} />
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
      <div className="no-print mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        {/* 卡片顶部装饰线（朱砂色） */}
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />

        <div className="p-5">
          <JianzipuKeyboard onAppend={handleAppend} />
        </div>
      </div>

      {/* ── 页脚 ── */}
      <p className="no-print mt-auto pt-10 text-[11px] tracking-[0.15em] text-amber-700/30">
        先选音色，再依次拼出完整减字
      </p>
    </main>
  );
}
