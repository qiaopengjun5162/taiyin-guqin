"use client";

import { useState } from "react";
import type { JianpuNumber, JianpuOctave, NoteColumn } from "@/lib/types";
import { jianziToText, createEmptyState } from "@/lib/types";
import { translateJianpuToJianzi, translateJianpuSequenceToJianzi } from "@/lib/taiyin-wasm";
import { selectCandidates } from "@/lib/api";
import { parseJianpuString, type ParsedJianpuNote, type ParsedJianpuItem } from "@/lib/jianpu-parser";

interface WasmCandidateNote {
  note_type: string;
  left_finger: string | null;
  hui: { hui: number; fen: number | null } | null;
  right_action: string;
  string_number: number;
}

interface WasmCandidate {
  score: number;
  note: WasmCandidateNote;
}

interface JianpuTranslatorProps {
  onSelect: (columns: NoteColumn[]) => void;
}

type InputMode = "single" | "sequence";

type Tuning = "zheng" | "ruibin" | "manjiao";

const TUNING_OPTIONS: { value: Tuning; label: string }[] = [
  { value: "zheng", label: "正调" },
  { value: "ruibin", label: "蕤宾调" },
  { value: "manjiao", label: "慢角调" },
];

// WASM 真实契约：note_type 序列化为中文（散/泛/按），left_finger/right_action 为 Rust 枚举名
const TONE_TYPES = ["散", "泛", "按"] as const;
type ToneType = (typeof TONE_TYPES)[number];

function parseToneType(value: string): ToneType | null {
  return (TONE_TYPES as readonly string[]).includes(value) ? (value as ToneType) : null;
}

const LEFT_FINGER_MAP: Record<string, string> = {
  Da: "大",
  Ming: "夕",
  Zhong: "中",
  Shi: "亻",
  Gui: "跪",
};

const RIGHT_ACTION_MAP: Record<string, string> = {
  Tiao: "乚",
  Gou: "勹",
  Mo: "木",
  Ti: "剔",
  Tuo: "乇",
  Bo: "尸",
  Da: "丁",
  Zhai: "倽",
};

const FEN_MAP: Record<number, string> = {
  3: "三分",
  6: "六分",
  8: "八分",
};

const CHINESE_DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function toChineseNumber(n: number): string {
  if (n <= 10) return CHINESE_DIGITS[n];
  if (n <= 13) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    if (tens === 1) return `十${CHINESE_DIGITS[ones]}`;
    return `${CHINESE_DIGITS[tens]}十${CHINESE_DIGITS[ones]}`;
  }
  return String(n);
}

function buildJianziState(candidate: WasmCandidate) {
  const note = candidate.note;
  const jianzi = createEmptyState();
  jianzi.toneType = parseToneType(note.note_type);
  if (note.left_finger) {
    jianzi.leftFinger = LEFT_FINGER_MAP[note.left_finger] ?? note.left_finger;
  }
  if (note.hui) {
    jianzi.hui = toChineseNumber(note.hui.hui);
    if (note.hui.fen != null) {
      jianzi.fen = note.hui.fen === 5 ? "半" : FEN_MAP[note.hui.fen] ?? null;
    }
  }
  jianzi.rightAction = RIGHT_ACTION_MAP[note.right_action] ?? note.right_action;
  jianzi.stringNumber = toChineseNumber(note.string_number);
  return jianzi;
}

function candidateToNoteColumn(
  candidate: WasmCandidate,
  parsedNote: ParsedJianpuNote,
): NoteColumn {
  const jianzi = buildJianziState(candidate);
  return {
    id: crypto.randomUUID(),
    jianpuNumber: String(parsedNote.number) as JianpuNumber,
    jianpuOctave:
      parsedNote.octave === 1 ? "·" : parsedNote.octave === -1 ? "," : "",
    jianpuDot: parsedNote.dotted,
    duration: parsedNote.duration,
    jianzi,
  };
}

function SingleNoteMode({ tuning, onSelect }: { tuning: Tuning; onSelect: (columns: NoteColumn[]) => void }) {
  const [number, setNumber] = useState<JianpuNumber | "">("");
  const [octave, setOctave] = useState<JianpuOctave>("");
  const [candidates, setCandidates] = useState<WasmCandidate[]>([]);
  // 候选产生时的调式；与当前调式不一致时候选作废，防止跨调式确认
  const [candTuning, setCandTuning] = useState<Tuning | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleTranslate() {
    if (!number) return;
    setLoading(true);
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
    setLoading(false);
  }

  function handleSelect(candidate: WasmCandidate) {
    const parsed: ParsedJianpuNote = {
      kind: "note",
      number: parseInt(number || "1", 10),
      octave: octave === "·" ? 1 : octave === "," ? -1 : 0,
      duration: "四分",
      dotted: false,
      raw: `${number}${octave}`,
    };
    onSelect([candidateToNoteColumn(candidate, parsed)]);
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
          disabled={!number || loading}
          className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 disabled:opacity-30"
        >
          {loading ? "翻译中…" : "翻译"}
        </button>
      </div>
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

function SequenceMode({ tuning, onSelect }: { tuning: Tuning; onSelect: (columns: NoteColumn[]) => void }) {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<ParsedJianpuItem[]>([]);
  const [candidatesPerNote, setCandidatesPerNote] = useState<WasmCandidate[][]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number[]>([]);
  // 候选产生时的调式；与当前调式不一致时整批候选作废
  const [notesTuning, setNotesTuning] = useState<Tuning | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);

  async function handleTranslate() {
    const parsed = parseJianpuString(input);
    const playable = parsed.filter((n): n is ParsedJianpuNote => n.kind === "note");
    if (playable.length === 0) {
      setNotes(parsed);
      setCandidatesPerNote([]);
      setSelectedIndex([]);
      setNotesTuning(tuning);
      return;
    }

    setLoading(true);
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
    setLoading(false);
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
    const playable = notes.filter((n): n is ParsedJianpuNote => n.kind === "note");
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
      <div className="flex items-center gap-2">
        <button
          onClick={handleTranslate}
          disabled={!input.trim() || loading}
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
              <span className="text-[10px] tracking-wider text-amber-600/50">调式已变更，请重新翻译</span>
            )}
            <button
              onClick={handleClear}
              className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300"
            >
              清空
            </button>
            {aiHint && (
              <span className="text-[10px] tracking-wider text-amber-600/50">{aiHint}</span>
            )}
          </>
        )}
      </div>
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

export function JianpuTranslator({ onSelect }: JianpuTranslatorProps) {
  const [mode, setMode] = useState<InputMode>("single");
  const [tuning, setTuning] = useState<Tuning>("zheng");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {[
          { key: "single", label: "单音" },
          { key: "sequence", label: "序列" },
        ].map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key as InputMode)}
            className={`px-2 py-0.5 text-[10px] tracking-wider rounded border transition-colors ${
              mode === m.key
                ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                : "border-amber-700/20 text-amber-100/50 hover:text-amber-100/70"
            }`}
          >
            {m.label}
          </button>
        ))}
        <select
          value={tuning}
          onChange={(e) => setTuning(e.target.value as Tuning)}
          className="ml-auto px-2 py-0.5 text-[10px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 outline-none"
        >
          {TUNING_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {mode === "single" ? (
        <SingleNoteMode tuning={tuning} onSelect={onSelect} />
      ) : (
        <SequenceMode tuning={tuning} onSelect={onSelect} />
      )}
    </div>
  );
}
