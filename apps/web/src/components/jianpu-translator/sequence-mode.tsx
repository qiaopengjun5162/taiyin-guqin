"use client";

import { useState } from "react";
import type { NoteColumn } from "@/lib/types";
import { jianziToText, createEmptyState } from "@/lib/types";
import { translateJianpuSequenceToJianzi } from "@/lib/taiyin-wasm";
import { selectCandidates } from "@/lib/api";
import {
  parseJianpuString,
  type ParsedJianpuNote,
  type ParsedJianpuItem,
} from "@/lib/jianpu-parser";
import type { WasmCandidate } from "./types";
import { buildJianziState, candidateToNoteColumn } from "./candidate";
import type { Tuning } from "./types";

export function SequenceMode({
  tuning,
  onSelect,
  disabled,
}: {
  tuning: Tuning;
  onSelect: (columns: NoteColumn[]) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<ParsedJianpuItem[]>([]);
  const [candidatesPerNote, setCandidatesPerNote] = useState<WasmCandidate[][]>(
    [],
  );
  const [selectedIndex, setSelectedIndex] = useState<number[]>([]);
  // 候选产生时的调式；与当前调式不一致时整批候选作废
  const [notesTuning, setNotesTuning] = useState<Tuning | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);

  async function handleTranslate() {
    const parsed = parseJianpuString(input);
    const playable = parsed.filter(
      (n): n is ParsedJianpuNote => n.kind === "note",
    );
    if (playable.length === 0) {
      setNotes(parsed);
      setCandidatesPerNote([]);
      setSelectedIndex([]);
      setNotesTuning(tuning);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const raw = await translateJianpuSequenceToJianzi(
        JSON.stringify({
          notes: playable.map((n) => ({ number: n.number, octave: n.octave })),
          tuning,
        }),
      );
      let parsedResult: { candidates_per_note?: WasmCandidate[][] } = {};
      try {
        parsedResult = JSON.parse(raw);
      } catch {
        parsedResult = {};
      }

      const result = parsedResult.candidates_per_note ?? [];
      // 将可演奏音符的候选与休止符对齐：休止符位置用空数组填充。
      const aligned: WasmCandidate[][] = [];
      let resultIdx = 0;
      for (const n of parsed) {
        if (n.kind === "rest") {
          aligned.push([]);
        } else {
          aligned.push(result[resultIdx] ?? []);
          resultIdx++;
        }
      }

      setNotes(parsed);
      setCandidatesPerNote(aligned);
      setSelectedIndex(parsed.map(() => 0));
      setNotesTuning(tuning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "翻译失败");
    } finally {
      setLoading(false);
    }
  }

  function handleConfirm() {
    const columns: NoteColumn[] = [];
    for (let i = 0; i < notes.length; i++) {
      const item = notes[i];
      if (item.kind === "rest") {
        columns.push({
          id: crypto.randomUUID(),
          jianpuNumber: "0",
          jianpuOctave: "",
          jianpuDot: item.dotted,
          duration: item.duration,
          jianzi: createEmptyState(),
        });
        continue;
      }
      const candidates = candidatesPerNote[i];
      const idx = selectedIndex[i] ?? 0;
      const candidate = candidates[idx];
      if (!candidate) continue;
      columns.push(candidateToNoteColumn(candidate, item));
    }
    if (columns.length === 0) return;
    onSelect(columns);
    setNotes([]);
    setCandidatesPerNote([]);
    setSelectedIndex([]);
  }

  function handleClear() {
    setInput("");
    setNotes([]);
    setCandidatesPerNote([]);
    setSelectedIndex([]);
    setAiHint(null);
  }

  /** 调用后端 LLM 为每音优选候选；note_index 需映射回含休止符的 parsed 位置 */
  async function handleAiSelect() {
    const playable = notes.filter(
      (n): n is ParsedJianpuNote => n.kind === "note",
    );
    if (playable.length === 0) return;
    setAiLoading(true);
    try {
      const { method, selections } = await selectCandidates(
        playable.map((n) => ({ number: n.number, octave: n.octave })),
        tuning,
      );
      setSelectedIndex((prev) => {
        const next = [...prev];
        let playableIdx = 0;
        for (let p = 0; p < notes.length; p++) {
          if (notes[p].kind !== "note") continue;
          const sel = selections.find((s) => s.note_index === playableIdx);
          if (sel) next[p] = sel.candidate_index;
          playableIdx++;
        }
        return next;
      });
      setAiHint(method === "llm" ? "AI 已优选" : "未配置 LLM，按启发式选择");
    } catch {
      setAiHint("AI 优选失败");
    } finally {
      setAiLoading(false);
    }
  }

  function selectCandidate(noteIndex: number, candidateIndex: number) {
    setSelectedIndex((prev) => {
      const next = [...prev];
      next[noteIndex] = candidateIndex;
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="例如：5 6 1 2 | 3 5 6 -"
        rows={2}
        className="w-full px-2 py-1 rounded border border-amber-700/20 bg-transparent text-amber-100/70 text-sm placeholder:text-amber-700/30 resize-none"
      />
      <p className="text-[9px] tracking-wider text-amber-700/40">
        支持：· 高八度　, 低八度　| 小节线　- 延音　_ 八分　__ 十六分　. 附点
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={handleTranslate}
          disabled={!input.trim() || loading || disabled}
          className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 disabled:opacity-30"
        >
          {loading ? "翻译中…" : "翻译"}
        </button>
        {notes.length > 0 && (
          <>
            {notesTuning === tuning ? (
              <>
                <button
                  onClick={handleConfirm}
                  className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300"
                >
                  确认全部
                </button>
                <button
                  onClick={handleAiSelect}
                  disabled={aiLoading}
                  className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 disabled:opacity-30"
                >
                  {aiLoading ? "优选中…" : "AI 优选"}
                </button>
              </>
            ) : (
              <span className="text-[10px] tracking-wider text-amber-600/50">
                调式已变更，请重新翻译
              </span>
            )}
            <button
              onClick={handleClear}
              className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300"
            >
              清空
            </button>
            {aiHint && (
              <span className="text-[10px] tracking-wider text-amber-600/50">
                {aiHint}
              </span>
            )}
          </>
        )}
      </div>
      {error && (
        <p className="text-[10px] tracking-wider text-red-400/80">{error}</p>
      )}
      {notes.length > 0 && notesTuning === tuning && (
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
          {notes.map((item, noteIdx) => (
            <div
              key={`${noteIdx}-${item.raw}`}
              className="flex items-center gap-2 px-2 py-1 rounded border border-amber-700/10 bg-amber-900/5"
            >
              <span className="w-8 shrink-0 text-center text-xs text-amber-100/60">
                {item.raw}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {candidatesPerNote[noteIdx]?.map((c, candIdx) => (
                  <button
                    key={candIdx}
                    onClick={() => selectCandidate(noteIdx, candIdx)}
                    className={`px-1.5 py-0.5 text-xs rounded border ${
                      selectedIndex[noteIdx] === candIdx
                        ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                        : "border-amber-700/20 text-amber-100/70 hover:bg-amber-900/20"
                    }`}
                    title={`评分: ${c.score}`}
                  >
                    {jianziToText(buildJianziState(c))}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
