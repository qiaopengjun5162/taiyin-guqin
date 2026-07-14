"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteColumn } from "@/lib/types";
import { ScoreView } from "@/components/score-view";
import { JianzipuKeyboard } from "@/components/jianzipu-keyboard";
import { SaveLoadToolbar } from "@/components/save-load-toolbar";
import { LoadDialog } from "@/components/load-dialog";
import { ExportFooter } from "@/components/export-footer";
import { JianpuTranslator } from "@/components/jianpu-translator";
import { useExportImage } from "@/lib/use-export-image";
import { useScoreHistory } from "@/lib/use-score-history";
import { EXAMPLE_SCORES, findExampleScore } from "@/lib/example-scores";
import { formatScoreAsText, downloadTextFile } from "@/lib/score-export";
import * as api from "@/lib/api";

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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const {
    score,
    title: scoreTitle,
    setScore,
    setTitle: setScoreTitle,
    commitScore,
    commitTitle: commitScoreTitle,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useScoreHistory([], "未命名曲谱");

  // 持久化状态
  const [currentScoreId, setCurrentScoreId] = useState<string | null>(null);
  const [savedScores, setSavedScores] = useState<api.ScoreListItem[]>([]);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const exportRef = useRef<HTMLDivElement>(null);
  const { exportPng, isExporting } = useExportImage({
    containerRef: exportRef,
    title: scoreTitle,
  });

  /** 全局撤销/重做快捷键 */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      const target = e.target as HTMLElement;
      const isTextInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "z" && !e.shiftKey) {
        if (isTextInput) return;
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        if (isTextInput) return;
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  /** 点击乐谱流音符 → 键盘回填数据 + 滚动到键盘区 */
  function handleEdit(index: number) {
    setEditingIndex(index);
    document.getElementById("keyboard-area")?.scrollIntoView({ behavior: "smooth" });
  }

  function handleAppend(note: NoteColumn) {
    commitScore((prev) => {
      if (editingIndex !== null) {
        const next = [...prev];
        next[editingIndex] = note;
        return next;
      }
      return [...prev, note];
    });
    setEditingIndex(null);
  }

  function handleRemove(id: string) {
    const removedIdx = score.findIndex((n) => n.id === id);
    commitScore((prev) => prev.filter((n) => n.id !== id));
    if (removedIdx >= 0 && editingIndex === removedIdx) {
      setEditingIndex(null);
    }
  }

  /** 保存曲谱到后端 */
  async function handleSave() {
    if (score.length === 0) return;
    setSaveStatus("saving");
    try {
      if (currentScoreId) {
        await api.updateScore(currentScoreId, { title: scoreTitle, notes: score });
      } else {
        const created = await api.createScore(scoreTitle, score);
        setCurrentScoreId(created.id);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }

  /** 打开加载对话框（拉取后端列表） */
  async function openLoadDialog() {
    try {
      const list = await api.listScores();
      setSavedScores(list);
      setShowLoadDialog(true);
    } catch {
      alert("无法连接到服务器，请确认后端已启动。");
    }
  }

  /** 删除选中的曲谱 */
  async function handleDeleteScore(id: string, title: string) {
    if (!confirm(`确认删除「${title}」？`)) return;
    try {
      await api.deleteScore(id);
      setSavedScores((prev) => prev.filter((s) => s.id !== id));
      if (currentScoreId === id) {
        setScore([]);
        setScoreTitle("未命名曲谱");
        setCurrentScoreId(null);
      }
    } catch {
      alert("删除失败。");
    }
    // 刷新列表
    try { setSavedScores(await api.listScores()); } catch {}
  }

  /** 加载选中的曲谱 */
  async function handleLoadScore(id: string) {
    try {
      const scoreData = await api.getScore(id);
      commitScore(() => scoreData.notes);
      commitScoreTitle(scoreData.title);
      setCurrentScoreId(scoreData.id);
      setShowLoadDialog(false);
      setEditingIndex(null);
    } catch {
      alert("加载失败。");
    }
  }

  /** 加载预置示例曲谱 */
  function handleLoadExample(id: string) {
    const example = findExampleScore(id);
    if (!example) return;
    commitScore(() => example.notes);
    commitScoreTitle(example.title);
    setCurrentScoreId(null);
    setEditingIndex(null);
  }

  /** 导出纯文本对照谱 */
  function handleExportText() {
    const text = formatScoreAsText(score, { title: scoreTitle, beatsPerBar });
    downloadTextFile(text, `${scoreTitle || "taiyin-score"}.txt`);
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

      {/* ── 乐谱流（导出截图目标） ── */}
      <div id="score-area" ref={exportRef} className="mt-8 w-full max-w-md">
        <ScoreView notes={score} beatsPerBar={beatsPerBar} onRemove={handleRemove} onEdit={handleEdit} editingIndex={editingIndex} />
        {score.length === 0 && (
          <p className="mt-4 text-center text-[11px] tracking-wider text-amber-700/40">
            暂无音符 · 用「简谱转减字」输入，或从上方「示例」加载一首曲谱
          </p>
        )}
        {score.length > 0 && <ExportFooter title={scoreTitle} />}
      </div>

      {/* ── 工具栏：标题 + 保存 / 加载 / 导出 ── */}
      <SaveLoadToolbar
        title={scoreTitle}
        onTitleChange={setScoreTitle}
        onTitleBlur={() => commitScoreTitle(scoreTitle)}
        onSave={handleSave}
        onLoad={openLoadDialog}
        onExportPng={exportPng}
        onExportText={handleExportText}
        examples={EXAMPLE_SCORES}
        onLoadExample={handleLoadExample}
        hasNotes={score.length > 0}
        saveStatus={saveStatus}
        isExporting={isExporting}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      {/* ── 拍号选择 ── */}
      <div className="no-print mt-2 w-full max-w-md flex items-center justify-end gap-2">
        <span className="text-[10px] tracking-wider text-amber-600/50">拍号</span>
        <select
          value={beatsPerBar}
          onChange={(e) => setBeatsPerBar(parseInt(e.target.value, 10))}
          className="px-2 py-1 text-[10px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 outline-none focus:border-amber-600/50"
        >
          <option value={3}>3/4</option>
          <option value={4}>4/4</option>
          <option value={6}>6/8</option>
        </select>
      </div>

      {/* ── 加载对话框 ── */}
      <LoadDialog
        open={showLoadDialog}
        onClose={() => setShowLoadDialog(false)}
        scores={savedScores}
        onLoad={handleLoadScore}
        onDelete={handleDeleteScore}
      />

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

          {/* 简谱转减字入口 */}
          {editingIndex === null && (
            <div className="mb-4 p-3 rounded border border-amber-700/20 bg-amber-900/10">
              <p className="mb-2 text-[10px] tracking-wider text-amber-600/60">简谱转减字</p>
              <JianpuTranslator
                onSelect={(notes) => {
                  commitScore((prev) => [...prev, ...notes]);
                }}
              />
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
