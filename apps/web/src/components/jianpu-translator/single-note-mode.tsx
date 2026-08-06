"use client";

import { useState } from "react";
import type { JianpuNumber, JianpuOctave, NoteColumn } from "@/lib/types";
import { jianziToText } from "@/lib/jianzi";
import { translateJianpuToJianzi } from "@/lib/taiyin-wasm";
import type { WasmCandidate } from "./types";
import { buildJianziState, candidateToNoteColumn } from "./candidate";
import type { Tuning } from "./types";

export function SingleNoteMode({
  tuning,
  onSelect,
  disabled,
}: {
  tuning: Tuning;
  onSelect: (columns: NoteColumn[]) => void;
  disabled?: boolean;
}) {
  const [number, setNumber] = useState<JianpuNumber | "">("");
  const [octave, setOctave] = useState<JianpuOctave>("");
  const [candidates, setCandidates] = useState<WasmCandidate[]>([]);
  // 候选产生时的调式；与当前调式不一致时候选作废，防止跨调式确认
  const [candTuning, setCandTuning] = useState<Tuning | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTranslate() {
    if (!number) return;
    setLoading(true);
    setError(null);
    try {
      const octaveValue = octave === "·" ? 1 : octave === "," ? -1 : 0;
      const raw = await translateJianpuToJianzi(
        JSON.stringify({ number: parseInt(number, 10), octave: octaveValue, tuning }),
      );
      let parsed: { candidates: WasmCandidate[] } = { candidates: [] };
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { candidates: [] };
      }
      setCandidates(parsed.candidates ?? []);
      setCandTuning(tuning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "翻译失败");
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(candidate: WasmCandidate) {
    onSelect([
      candidateToNoteColumn(candidate, {
        kind: "note",
        number: parseInt(number || "1", 10),
        octave: octave === "·" ? 1 : octave === "," ? -1 : 0,
        duration: "四分",
        dotted: false,
        raw: `${number}${octave}`,
      }),
    ]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={number}
          onChange={(e) => setNumber(e.target.value as JianpuNumber)}
          className="px-2 py-1 rounded border border-amber-700/20 bg-transparent text-amber-100/70"
        >
          <option value="">数字</option>
          {["1", "2", "3", "4", "5", "6", "7"].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <select
          value={octave}
          onChange={(e) => setOctave(e.target.value as JianpuOctave)}
          className="px-2 py-1 rounded border border-amber-700/20 bg-transparent text-amber-100/70"
        >
          <option value="">八度</option>
          <option value="·">高八度</option>
          <option value=",">低八度</option>
        </select>
        <button
          onClick={handleTranslate}
          disabled={!number || loading || disabled}
          className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 disabled:opacity-30"
        >
          {loading ? "翻译中…" : "翻译"}
        </button>
      </div>
      {error && (
        <p className="text-[10px] tracking-wider text-red-400/80">{error}</p>
      )}
      {candidates.length > 0 && candTuning === tuning && (
        <div className="flex flex-wrap gap-2">
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() => handleSelect(c)}
              className="px-2 py-1 rounded border border-amber-700/20 text-amber-100/70 hover:bg-amber-900/20"
              title={`评分: ${c.score}`}
            >
              {jianziToText(buildJianziState(c))}
            </button>
          ))}
        </div>
      )}
      {candidates.length > 0 && candTuning !== tuning && (
        <p className="text-[10px] tracking-wider text-amber-600/50">调式已变更，请重新翻译</p>
      )}
    </div>
  );
}
