"use client";

import { useState, type ReactNode } from "react";
import type { NoteColumn } from "@/lib/types";
import type { StickingPoint } from "@/lib/practice-progress";
import { JianziRecognizer } from "@/components/jianzi-recognizer";
import { JianziSheetRecognizer } from "@/components/jianzi-sheet-recognizer";
import { QinBoard } from "@/components/qin-board";
import { TunerPanel } from "@/components/tuner-panel";
import { PracticePlayer } from "@/components/practice-player";
import { RecorderPanel } from "@/components/recorder-panel";
import { PracticeLogPanel } from "@/components/practice-log-panel";

/**
 * 右栏五个「＋ …」工具面板。
 *
 * 它们只跟页面交换四样东西（导入的谱、标题、卡点句、练某句），
 * 五个开合状态和两个 tab 状态互不外泄，所以整组内聚在这里，
 * 不再让主页替它们各持一份 useState。
 */

/** 五张卡共用同一张宣纸外壳——以前在 page.tsx 里抄了五遍，
 *  改一次按钮尺寸 / 对比度就得同步五处（P0 修点击目标时踩过）。 */
const PANEL_SHELL =
  "no-print mt-4 w-full max-w-xl rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30 ty-panel xl:col-start-2";
const TOGGLE_CLASS =
  "inline-flex min-h-[32px] items-center text-[11px] tracking-wider text-amber-800 hover:text-amber-900 transition-colors";

function CollapsiblePanel({
  id,
  heading,
  openLabel,
  closeLabel,
  open,
  onToggle,
  children,
}: {
  /** 与右栏页内导航的锚点一致 */
  id: string;
  /** 屏幕阅读器用的区块名；刻意避开测试里的按钮文本正则 */
  heading: string;
  openLabel: string;
  closeLabel: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div id={id} className={PANEL_SHELL}>
      <div className="ty-panel-accent" />
      <div className="p-5">
        <h2 className="sr-only">{heading}</h2>
        <button onClick={onToggle} aria-expanded={open} className={TOGGLE_CLASS}>
          {open ? closeLabel : openLabel}
        </button>
        {open && <div className="mt-3">{children}</div>}
      </div>
    </div>
  );
}

export function PracticePanels({
  onImportNotes,
  scoreTitle,
  sticking,
  onPracticePhrase,
}: {
  /** 整页识别的结果追加到当前谱；撤销栈仍由页面的 commitScore 管。 */
  onImportNotes: (notes: NoteColumn[]) => void;
  scoreTitle: string;
  sticking: StickingPoint[];
  onPracticePhrase: (index: number) => void;
}) {
  /*
   * 五个面板用**一个** state 管：同时只开一个（手风琴）。
   *
   * 2026-11-18 实拍发现的问题：五个独立 useState 允许同时展开，
   * 全打开后右栏 2775px、左栏 1777px——页面被撑到 3214px，底部一大片空白，
   * 而且用户点第二个面板时第一个还占着位置，得一路滚过去才能看到新的。
   *
   * 这些是「工具」，不是「文档章节」：用户一次只会用一件。
   */
  const [openPanel, setOpenPanel] = useState<
    "recognizer" | "board" | "tuner" | "practice" | "log" | null
  >(null);
  /** 点同一个就收起，点别的就换过去——手风琴的标准行为。 */
  const toggle = (id: NonNullable<typeof openPanel>) =>
    setOpenPanel((cur) => (cur === id ? null : id));
  const [recognizerTab, setRecognizerTab] = useState<"single" | "sheet">("single");
  const [practiceLogTab, setPracticeLogTab] = useState<"record" | "log">("record");

  return (
    <>
      {/* ── 减字谱识别（模板匹配主路径；「AI 识别」是超口径，按钮文案不说 AI） ── */}
      <CollapsiblePanel
        id="sec-recognizer"
        heading="谱字识别"
        openLabel="＋ 识别减字图片"
        closeLabel="收起识别"
        open={openPanel === "recognizer"}
        onToggle={() => toggle("recognizer")}
      >
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => setRecognizerTab("single")}
            className={`px-2 py-1 text-[10px] tracking-wider rounded border transition-all ${
              recognizerTab === "single"
                ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                : "border-amber-700/30 text-stone-500 hover:text-stone-300"
            }`}
          >
            单字
          </button>
          <button
            onClick={() => setRecognizerTab("sheet")}
            className={`px-2 py-1 text-[10px] tracking-wider rounded border transition-all ${
              recognizerTab === "sheet"
                ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                : "border-amber-700/30 text-stone-500 hover:text-stone-300"
            }`}
          >
            整页
          </button>
        </div>
        {recognizerTab === "single" ? (
          <JianziRecognizer />
        ) : (
          <JianziSheetRecognizer onImport={onImportNotes} />
        )}
      </CollapsiblePanel>

      {/* ── 琴面音位全览（七弦十三徽 · 点哪听哪 · 按住拖是走手音） ── */}
      <CollapsiblePanel
        id="sec-board"
        heading="琴面音位"
        openLabel="＋ 琴面音位全览（七弦十三徽 · 点哪听哪 · 按住拖是走手音）"
        closeLabel="收起琴面"
        open={openPanel === "board"}
        onToggle={() => toggle("board")}
      >
        <QinBoard />
      </CollapsiblePanel>

      {/* ── 调音 · 定弦（定弦决定减字反推的音高） ── */}
      <CollapsiblePanel
        id="sec-tuner"
        heading="调音定弦"
        openLabel="＋ 调音 / 定弦（麦克风校弦 · 换调式）"
        closeLabel="收起调音"
        open={openPanel === "tuner"}
        onToggle={() => toggle("tuner")}
      >
        <TunerPanel />
      </CollapsiblePanel>

      {/* ── 跟录音练琴（对标华夏古琴网的「古琴播放器」） ── */}
      <CollapsiblePanel
        id="sec-practice"
        heading="跟奏"
        openLabel="＋ 跟录音练（导入音频 / AB 循环 / 变速）"
        closeLabel="收起跟录音练"
        open={openPanel === "practice"}
        onToggle={() => toggle("practice")}
      >
        <PracticePlayer />
      </CollapsiblePanel>

      {/* ── 练琴记录（对标「古琴助手」的录音器 + 打卡 + 统计） ── */}
      <CollapsiblePanel
        id="sec-log"
        heading="练琴日志"
        openLabel="＋ 练琴记录（录音回听 · 打卡 · 周月统计）"
        closeLabel="收起练琴记录"
        open={openPanel === "log"}
        onToggle={() => toggle("log")}
      >
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => setPracticeLogTab("record")}
            aria-pressed={practiceLogTab === "record"}
            className={`min-h-[36px] px-2 py-1 text-[10px] tracking-wider rounded border transition-colors ${
              practiceLogTab === "record"
                ? "border-amber-600/50 bg-amber-800/15 text-stone-900"
                : "border-amber-700/25 text-stone-600 hover:border-amber-600/50"
            }`}
          >
            录音
          </button>
          <button
            onClick={() => setPracticeLogTab("log")}
            aria-pressed={practiceLogTab === "log"}
            className={`min-h-[36px] px-2 py-1 text-[10px] tracking-wider rounded border transition-colors ${
              practiceLogTab === "log"
                ? "border-amber-600/50 bg-amber-800/15 text-stone-900"
                : "border-amber-700/25 text-stone-600 hover:border-amber-600/50"
            }`}
          >
            打卡与统计
          </button>
        </div>
        {practiceLogTab === "record" ? (
          <RecorderPanel scoreTitle={scoreTitle} />
        ) : (
          <PracticeLogPanel
            scoreTitle={scoreTitle}
            sticking={sticking}
            onPracticePhrase={onPracticePhrase}
          />
        )}
      </CollapsiblePanel>
    </>
  );
}
