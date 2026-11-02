"use client";

import { useMemo, useState } from "react";
import type { JianpuNumber, JianpuOctave, NoteColumn } from "@/lib/types";
import { translateJianpuToJianzi } from "@/lib/taiyin-wasm";
import { useNotePreview } from "@/lib/use-note-preview";
import type { JianziCandidate } from "@/lib/generated/taiyin";
import { buildJianziState, candidateToNoteColumn } from "./candidate";
import { CandidateChip } from "./candidate-chip";
import { TUNING_TO_ID, type Tuning } from "./types";

/** 弦序筛选：一个音在七根弦上都有落点，先按弦收窄再看，比翻十几张卡片快。 */
const STRINGS = ["一", "二", "三", "四", "五", "六", "七"] as const;

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
  const [candidates, setCandidates] = useState<JianziCandidate[]>([]);
  // 候选产生时的调式；与当前调式不一致时候选作废，防止跨调式确认
  const [candTuning, setCandTuning] = useState<Tuning | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stringFilter, setStringFilter] = useState<string | null>(null);

  const preview = useNotePreview(TUNING_TO_ID[tuning]);

  const octaveValue =
    octave === "··" ? 2 : octave === "·" ? 1 : octave === ",," ? -2 : octave === "," ? -1 : 0;

  /** 候选 → 谱字状态；顺手按弦序筛掉不要的。 */
  const shown = useMemo(
    () =>
      candidates
        .map((candidate, index) => ({ candidate, index, state: buildJianziState(candidate) }))
        .filter(({ state }) => !stringFilter || state.stringNumber === stringFilter),
    [candidates, stringFilter],
  );

  async function handleTranslate() {
    if (!number) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await translateJianpuToJianzi(
        JSON.stringify({ number: parseInt(number, 10), octave: octaveValue, tuning }),
      );
      let parsed: { candidates: JianziCandidate[] } = { candidates: [] };
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { candidates: [] };
      }
      setCandidates(parsed.candidates ?? []);
      setCandTuning(tuning);
      setStringFilter(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "翻译失败");
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(candidate: JianziCandidate) {
    onSelect([
      candidateToNoteColumn(candidate, {
        kind: "note",
        number: parseInt(number || "1", 10),
        octave: octaveValue,
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
          aria-label="简谱数字"
          className="px-2 py-1 rounded border border-amber-700/20 bg-transparent text-stone-700"
        >
          <option value="">数字</option>
          {["1", "2", "3", "4", "5", "6", "7"].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <select
          value={octave}
          onChange={(e) => setOctave(e.target.value as JianpuOctave)}
          aria-label="八度"
          className="px-2 py-1 rounded border border-amber-700/20 bg-transparent text-stone-700"
        >
          <option value="">八度</option>
          <option value="··">高两个八度</option>
          <option value="·">高八度</option>
          <option value=",">低八度</option>
          <option value=",,">低两个八度</option>
        </select>
        <button
          onClick={handleTranslate}
          disabled={!number || loading || disabled}
          className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 disabled:opacity-30"
        >
          {loading ? "翻译中…" : "查音位"}
        </button>
      </div>
      {error && <p className="text-[10px] tracking-wider text-red-400/80">{error}</p>}
      {candidates.length > 0 && candTuning === tuning && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[9px] tracking-wider text-amber-800/70">按弦</span>
            <button
              onClick={() => setStringFilter(null)}
              aria-pressed={stringFilter === null}
              className={`px-1.5 py-0.5 text-[10px] rounded border ${
                stringFilter === null
                  ? "border-amber-700/60 bg-amber-100 text-amber-900"
                  : "border-amber-700/20 text-stone-500 hover:text-stone-700"
              }`}
            >
              全部
            </button>
            {STRINGS.map((s) => (
              <button
                key={s}
                onClick={() => setStringFilter(stringFilter === s ? null : s)}
                aria-pressed={stringFilter === s}
                className={`px-1.5 py-0.5 text-[10px] rounded border ${
                  stringFilter === s
                    ? "border-amber-700/60 bg-amber-100 text-amber-900"
                    : "border-amber-700/20 text-stone-500 hover:text-stone-700"
                }`}
              >
                {s}
              </button>
            ))}
            <span className="ml-auto text-[9px] tracking-wider text-amber-800/60">
              {shown.length} 个位置 · 点卡片录入 · ▶ 试听
            </span>
          </div>
          {/* 一个音在琴上常有三十多个落点：限高滚动，别把整页撑长 */}
          <div className="grid max-h-[19rem] grid-cols-3 gap-1.5 overflow-y-auto pr-1">
            {shown.map(({ candidate, index, state }) => (
              <CandidateChip
                key={index}
                state={state}
                score={candidate.score}
                onPick={() => handleSelect(candidate)}
                onPreview={() => preview(state)}
              />
            ))}
          </div>
          {shown.length === 0 && (
            <p className="text-[10px] tracking-wider text-stone-500">
              这个音在{stringFilter}弦上没有落点，换一根弦试试。
            </p>
          )}
        </>
      )}
      {candidates.length === 0 && candTuning === tuning && !loading && number && (
        <p className="text-[10px] tracking-wider text-stone-500">
          这个音在古琴上找不到对应位置——先确认调式，或降低/升高八度再查。
        </p>
      )}
      {candidates.length > 0 && candTuning !== tuning && (
        <p className="text-[10px] tracking-wider text-stone-500">调式已变更，请重新查音位</p>
      )}
    </div>
  );
}
