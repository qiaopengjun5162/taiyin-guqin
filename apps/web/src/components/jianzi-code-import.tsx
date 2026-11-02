"use client";

/**
 * 减字码入谱 —— 把一串码（`ad9g4 sg3`）粘回来变成曲谱。
 *
 * 导出文本谱时我们多印一行「编码」，本意是让没有字体的人也能照着敲。
 * 但只有「导出」没有「导入」，那一行码就只是注释：看得懂，用不上。
 * 这里补上另一半——粘回去即可成谱，码才真的算一份可搬运的存档。
 *
 * 切词与解码都在 Rust（`jianzi_code::decode_batch_json`）：
 * 粘一整段导出的文本也行，简谱数字、小节线、标题里的中文会被滤掉，
 * 只留下像码的片段；读不通的那条单独报错，不影响其余。
 */

import { useState } from "react";
import type { NoteColumn } from "@/lib/types";
import { decodeJianziBatch, useWasmInit } from "@/lib/taiyin-wasm";
import { jianziToJianpu } from "@/lib/jianzi-pitch";
import { createEmptyState } from "@/lib/jianzi";
import { usePitchContext } from "@/lib/use-pitch-context";

interface JianziCodeImportProps {
  /** 解析成功的那批音符，按粘入顺序追加到曲谱。 */
  onImport: (notes: NoteColumn[]) => void;
}

/** 一眼能看懂的样例：散音、按音、带分的按音、泛音各一，末位标了时值。 */
const SAMPLE = "sg3:4 st5:8 ad9g4:4. am7f6cm2:8 fd9g4:2 r:4";

interface ImportSummary {
  ok: number;
  rest: number;
  failed: number;
  errors: { code: string; reason: string }[];
}

export function JianziCodeImport({ onImport }: JianziCodeImportProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { state: wasmState } = useWasmInit();
  // 音高按当前定弦 + 基准音反推：同一串码在慢角调上弹出来不是同一个音，
  // 若这里固定用正调，导入的简谱行就会与琴上实际音高对不上。
  const { tuning, concertPitch } = usePitchContext();

  const ready = wasmState === "ready";

  async function handleImport() {
    const raw = text.trim();
    if (!raw) {
      setError("先粘一段码进来（如 ad9g4 sg3）");
      setSummary(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await decodeJianziBatch(raw);
      const notes: NoteColumn[] = [];
      let rest = 0;
      for (const entry of result.entries) {
        // 休止符没有减字，但占时值：漏掉它，小节线就全错位了。
        if (entry.isRest) {
          rest += 1;
          notes.push({
            id: crypto.randomUUID(),
            jianpuNumber: "0",
            jianpuOctave: "",
            jianpuDot: entry.dotted,
            duration: entry.duration ?? "四分",
            jianzi: createEmptyState(),
          });
          continue;
        }
        if (!entry.state) continue;
        const jp = jianziToJianpu(entry.state, { tuning, concertPitch });
        notes.push({
          id: crypto.randomUUID(),
          jianpuNumber: jp?.number ?? null,
          jianpuOctave: jp?.octave ?? "",
          // 码尾写了 `:8.` 就按八分附点入谱；没写退回四分——不猜。
          jianpuDot: entry.dotted,
          duration: entry.duration ?? "四分",
          jianzi: entry.state,
        });
      }
      if (notes.length > 0) onImport(notes);
      setSummary({
        ok: notes.length,
        rest,
        failed: result.failed,
        errors: result.entries
          .filter((e) => !e.state && !e.isRest)
          .map((e) => ({ code: e.code, reason: e.error ?? "读不通" })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失败");
      setSummary(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] leading-relaxed tracking-wider text-stone-600">
        把导出的编码行整段粘进来即可成谱（夹着简谱数字、小节线、标题都不碍事）；
        码尾的 <code className="font-mono">:时值</code>（<code className="font-mono">1/2/4/8/16</code>，
        附点加 <code className="font-mono">.</code>，如 <code className="font-mono">ad9g4:8.</code>）
        决定这一声多长，<code className="font-mono">r:4</code> 是休止符；不写按四分。
        音高随当前定弦反推，码怎么写见
        <span className="text-amber-800">「减字谱 · 科普」</span>的键盘速录。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="ad9g4 sg3 | st5 …"
        aria-label="减字码"
        className="w-full resize-y rounded border border-amber-700/25 bg-white/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-stone-800 outline-none placeholder:text-stone-400 focus:border-amber-600/60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleImport}
          disabled={!ready || busy}
          className="min-h-[36px] rounded border border-amber-700/40 px-2.5 py-1 text-[10px] tracking-wider text-amber-900 transition-colors hover:bg-amber-800/10 disabled:opacity-40"
        >
          {busy ? "解析中…" : "解析并加入曲谱"}
        </button>
        <button
          onClick={() => setText(SAMPLE)}
          className="min-h-[36px] rounded border border-amber-700/20 px-2.5 py-1 text-[10px] tracking-wider text-stone-500 transition-colors hover:text-stone-700"
        >
          填入示例
        </button>
        <button
          onClick={() => {
            setText("");
            setSummary(null);
            setError(null);
          }}
          disabled={!text && !summary && !error}
          className="min-h-[36px] rounded px-2 py-1 text-[10px] tracking-wider text-stone-400 underline underline-offset-2 transition-colors hover:text-stone-600 disabled:opacity-30"
        >
          清空
        </button>
        {wasmState === "loading" && (
          <span className="text-[10px] tracking-wider text-stone-500">减字引擎加载中…</span>
        )}
        {wasmState === "error" && (
          <span className="text-[10px] tracking-wider text-red-700">减字引擎加载失败，暂时无法解析</span>
        )}
      </div>

      {error && (
        <p role="status" className="text-[10px] leading-relaxed tracking-wider text-red-700">
          {error}
        </p>
      )}

      {summary && (
        <div role="status" className="text-[10px] leading-relaxed tracking-wider">
          <p className="text-stone-700">
            {summary.ok > 0
              ? `已入谱 ${summary.ok} 个音符${summary.rest > 0 ? `（其中休止 ${summary.rest}）` : ""}`
              : "没有可入谱的减字"}
            {summary.failed > 0 && (
              <span className="text-red-700">；{summary.failed} 条码读不通</span>
            )}
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-red-700/90">
              {summary.errors.slice(0, 3).map((e) => (
                <li key={e.code}>
                  <code className="font-mono">{e.code}</code> · {e.reason}
                </li>
              ))}
              {summary.errors.length > 3 && (
                <li>…另有 {summary.errors.length - 3} 条</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
