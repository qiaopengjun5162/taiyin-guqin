"use client";

import { useMemo, useRef, useState } from "react";
import type { JianziState, NoteColumn } from "@/lib/types";
import { parseJianziText } from "@/lib/jianzi";
import { SvgJianziBlock } from "@/components/svg-jianzi-block";
import { recognizeJianziSheet, ApiError } from "@/lib/api";
import { schedulePluck } from "@/lib/audio-synth";
import { jianziToFrequency, jianziToJianpu } from "@/lib/jianzi-pitch";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 整页减字谱识别面板（P1：对标 udywang「琴与人的交互 1 号」5×7 字阵）。
 *
 * 上传一整页减字谱图片 → 后端 Claude 多模态识别为若干按网格坐标排布的字格 →
 * 前端重排为可读网格、每个减字可点听（正调空弦近似音）→ 可一键按阅读顺序导入为可演奏曲谱。
 */
export function JianziSheetRecognizer({
  onImport,
}: {
  onImport: (notes: NoteColumn[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cells, setCells] = useState<
    | { row: number; col: number; glyph: string | null; explanation: string | null; confidence: number | null }[]
    | null
  >(null);
  const [importedMsg, setImportedMsg] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(f: File) {
    setError(null);
    setCells(null);
    setImportedMsg(null);
    setLoading(true);
    try {
      const base64 = await fileToBase64(f);
      const mediaType = f.type || "image/jpeg";
      const resp = await recognizeJianziSheet(base64, mediaType);
      setCells(resp.cells);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setError("后端未启用 AI 识别（缺少 ANTHROPIC_API_KEY），无法识别图片。");
      } else {
        setError(e instanceof Error ? e.message : "识别失败，请重试");
      }
    } finally {
      setLoading(false);
    }
  }

  // 重排为网格：求行列上下界，构建 row→col 索引；同时给出阅读顺序（同排从右到左）。
  const grid = useMemo(() => {
    if (!cells || cells.length === 0) return null;
    let maxRow = 0;
    let maxCol = 0;
    for (const c of cells) {
      if (c.row > maxRow) maxRow = c.row;
      if (c.col > maxCol) maxCol = c.col;
    }
    const at: Record<string, (typeof cells)[number] | undefined> = {};
    for (const c of cells) at[`${c.row}-${c.col}`] = c;
    const readingOrder = [...cells].sort((a, b) =>
      a.row !== b.row ? a.row - b.row : b.col - a.col,
    );
    return { maxRow, maxCol, at, readingOrder };
  }, [cells]);

  const readableCount = cells ? cells.filter((c) => c.glyph).length : 0;

  function handlePlay(state: JianziState) {
    const freq = jianziToFrequency(state);
    if (freq == null) return;
    const ctx = ctxRef.current ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const tone = state.toneType === "散" ? "散" : state.toneType === "泛" ? "泛" : "按";
    schedulePluck(ctx, freq, ctx.currentTime + 0.05, 1.2, tone);
  }

  function handleImport() {
    if (!grid) return;
    const notes: NoteColumn[] = [];
    for (const c of grid.readingOrder) {
      if (!c.glyph) continue;
      const parsed = parseJianziText(c.glyph);
      if (!parsed) continue;
      const jp = jianziToJianpu(parsed);
      notes.push({
        id: crypto.randomUUID(),
        jianpuNumber: jp?.number ?? null,
        jianpuOctave: jp?.octave ?? "",
        jianpuDot: false,
        duration: "四分",
        jianzi: parsed,
      });
    }
    if (notes.length === 0) {
      setImportedMsg("没有可导入的减字（均未识别或无法解析）");
      return;
    }
    onImport(notes);
    setImportedMsg(`已按阅读顺序导入 ${notes.length} 个减字到曲谱`);
  }

  return (
    <div className="mt-3">
      <p className="mb-2 text-[10px] leading-relaxed tracking-wider text-amber-600/60">
        整页识别：上传一张含多行多列减字的整页谱图（如字格阵列），AI 按坐标识别每个减字，可逐个点听、可一键导入曲谱。
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="px-3 py-1.5 min-h-[40px] text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-400 hover:text-stone-200 hover:border-amber-600/50 disabled:opacity-40 transition-all"
        >
          {loading ? "识别中…" : "上传整页减字图片"}
        </button>
        <p className="text-[10px] tracking-wider text-amber-700/40">
          拍/传整页减字谱
        </p>
      </div>

      {error && (
        <p className="mt-2 text-[10px] tracking-wider text-red-200/80">{error}</p>
      )}

      {cells && cells.length === 0 && !error && (
        <p className="mt-2 text-[10px] tracking-wider text-amber-700/50">
          未识别到减字，请换一张更清晰的整页谱图。
        </p>
      )}

      {grid && (
        <div className="mt-3">
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: `repeat(${grid.maxCol + 1}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: grid.maxRow + 1 }, (_, r) =>
              Array.from({ length: grid.maxCol + 1 }, (_, c) => {
                const cell = grid.at[`${r}-${c}`];
                const parsed = cell?.glyph ? parseJianziText(cell.glyph) : null;
                return (
                  <div
                    key={`${r}-${c}`}
                    title={cell?.explanation ?? cell?.glyph ?? undefined}
                    onClick={() => parsed && handlePlay(parsed)}
                    className={`flex flex-col items-center justify-center gap-0.5 aspect-square rounded border border-amber-700/15 bg-[var(--paper)] ${
                      parsed
                        ? "cursor-pointer hover:border-amber-500/50"
                        : "opacity-40"
                    } transition-all`}
                  >
                    {parsed ? (
                      <>
                        <SvgJianziBlock state={parsed} fontSize="34px" />
                        {cell?.confidence !== null && cell?.confidence !== undefined && (
                          <span className="text-[8px] tracking-wider text-amber-700/40">
                            {(cell.confidence! * 100).toFixed(0)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px] text-amber-700/30">·</span>
                    )}
                  </div>
                );
              }),
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-[10px] tracking-wider text-amber-700/50">
              识别 {cells!.length} 格 · 可读 {readableCount} 字
            </p>
            <button
              onClick={handleImport}
              disabled={readableCount === 0}
              className="px-3 py-1.5 min-h-[38px] text-[10px] tracking-wider rounded border border-amber-600/40 text-amber-100/80 hover:bg-amber-800/30 hover:border-amber-500/60 disabled:opacity-30 transition-all"
            >
              导入为曲谱
            </button>
          </div>
          {importedMsg && (
            <p className="mt-2 text-[10px] tracking-wider text-amber-200/80">{importedMsg}</p>
          )}
        </div>
      )}
    </div>
  );
}
