"use client";

/**
 * 「我的减字」工具栏。
 *
 * 放在预览下面：拼好一个字，顺手存起来；下次同一个字不用再走六步。
 * 导出/导入是一对——包里就是这些字的语义数据，换台电脑、发给琴友都能接着用。
 */

import { useRef, useState, useSyncExternalStore } from "react";
import { JianziBlock } from "./jianzi-block";
import { isComplete } from "@/lib/jianzi";
import {
  exportSaved,
  getSavedSnapshot,
  getServerSavedSnapshot,
  importSaved,
  removeSaved,
  saveJianzi,
  subscribeSaved,
  touchSaved,
  type SavedJianzi,
} from "@/lib/custom-jianzi";
import { downloadJianziImage, type JianziImageFormat } from "@/lib/jianzi-image";
import type { JianziState } from "@/lib/types";

interface Notice {
  text: string;
  tone: "ok" | "warn";
}

export function SavedJianziBar({
  current,
  onPick,
}: {
  current: JianziState;
  onPick: (state: JianziState) => void;
}) {
  const saved = useSyncExternalStore(subscribeSaved, getSavedSnapshot, getServerSavedSnapshot);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 每张卡片里「字块」那个节点：截图必须截它，不能连按钮和文字标签一起截进去。
  const glyphRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  const canSave = isComplete(current);

  function handleSave() {
    const result = saveJianzi(current);
    if (!result) {
      setNotice({ text: "这个减字还没填完，填完再存。", tone: "warn" });
      return;
    }
    setNotice({
      text: result.isNew
        ? `已存入「${result.item.label}」`
        : `「${result.item.label}」已在库中，使用次数 +1`,
      tone: "ok",
    });
  }

  function handlePick(item: SavedJianzi) {
    touchSaved(item.id);
    onPick(item.state);
    setNotice(null);
  }

  function handleExport() {
    const json = exportSaved();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `taiyin-jianzi-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice({ text: "已导出，换台机器导入即可接着用。", tone: "ok" });
  }

  async function handleImport(file: File) {
    const result = importSaved(await file.text());
    if (result.error) {
      setNotice({ text: result.error, tone: "warn" });
      return;
    }
    const skipped = result.skipped > 0 ? `、跳过 ${result.skipped}` : "";
    setNotice({
      text: `导入完成：新增 ${result.added}、合并 ${result.updated}${skipped}`,
      tone: "ok",
    });
  }

  /** 把这一个减字存成图片：给笔记 / 课件 / 文章配图用，不必导出一整首谱。 */
  async function handleSaveImage(item: SavedJianzi, format: JianziImageFormat) {
    // ref 理论上一定挂上了；万一没有，交给 downloadJianziImage 统一判空并回 false，
    // 失败提示走下面同一条路径，不另开一个平时跑不到的分支。
    const node = glyphRefs.current[item.id] ?? null;
    const ok = await downloadJianziImage(node, item.label, format);
    setNotice({
      text: ok
        ? `已存成 ${format.toUpperCase()}，可直接贴进笔记或课件。`
        : "存图失败，换个浏览器再试一次。",
      tone: ok ? "ok" : "warn",
    });
  }

  return (
    <div className="w-full rounded border border-amber-700/25 bg-amber-50/50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] tracking-wider text-stone-600">
          我的减字 {saved.length > 0 ? `· ${saved.length}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="min-h-[30px] rounded border border-amber-700/35 px-2 text-[10px] text-stone-700 transition-colors hover:bg-amber-700/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            存为常用
          </button>
          <button
            onClick={handleExport}
            disabled={saved.length === 0}
            className="min-h-[30px] rounded border border-amber-700/35 px-2 text-[10px] text-stone-700 transition-colors hover:bg-amber-700/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            导出
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="min-h-[30px] rounded border border-amber-700/35 px-2 text-[10px] text-stone-700 transition-colors hover:bg-amber-700/10"
          >
            导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="导入我的减字（JSON）"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      {saved.length === 0 ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-stone-500">
          还没有存过。拼好一个字后点「存为常用」，下次一键填回；卡片上的「图 / 矢」能把它存成图片，
          直接贴进笔记或课件；导出的 JSON 可以备份或给琴友。
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {saved.map((item) => (
            <div
              key={item.id}
              className="group flex items-stretch overflow-hidden rounded border border-amber-700/25 bg-white/70"
            >
              <button
                onClick={() => handlePick(item)}
                aria-label={`填入 ${item.label}`}
                title={`${item.label} · 用过 ${item.uses} 次`}
                className="flex items-center gap-1 px-1.5 py-1 transition-colors hover:bg-amber-700/10"
              >
                <span
                  ref={(el) => {
                    glyphRefs.current[item.id] = el;
                  }}
                  className="flex h-7 w-7 items-center justify-center bg-[#f8f3eb]"
                >
                  <JianziBlock state={item.state} fontSize="20px" />
                </span>
                <span className="max-w-[64px] truncate text-[10px] text-stone-700">{item.label}</span>
              </button>
              <button
                onClick={() => void handleSaveImage(item, "png")}
                aria-label={`存为图片 ${item.label}`}
                title="存成 PNG 图片，可直接贴进笔记 / 课件"
                className="border-l border-amber-700/20 px-1 text-[10px] text-stone-600 transition-colors hover:bg-amber-700/10 hover:text-amber-900"
              >
                图
              </button>
              <button
                onClick={() => void handleSaveImage(item, "svg")}
                aria-label={`存为矢量图 ${item.label}`}
                title="存成 SVG 矢量图，放大不糊"
                className="border-l border-amber-700/20 px-1 text-[10px] text-stone-600 transition-colors hover:bg-amber-700/10 hover:text-amber-900"
              >
                矢
              </button>
              <button
                onClick={() => removeSaved(item.id)}
                aria-label={`删除 ${item.label}`}
                className="border-l border-amber-700/20 px-1 text-[10px] text-stone-400 transition-colors hover:bg-amber-700/10 hover:text-stone-700"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {notice && (
        <p
          role="status"
          className={`mt-1.5 text-[10px] ${notice.tone === "warn" ? "text-amber-800" : "text-stone-600"}`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
