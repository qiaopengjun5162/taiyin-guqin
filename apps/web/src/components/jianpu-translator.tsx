"use client";

import { useState } from "react";
import type { JianpuNumber, JianpuOctave, NoteColumn } from "@/lib/types";
import { jianziToText, createEmptyState } from "@/lib/types";
import { translateJianpuToJianzi } from "@/lib/taiyin-wasm";

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
  onSelect: (column: NoteColumn) => void;
}

const NOTE_TYPE_MAP: Record<string, "散" | "泛" | "按"> = {
  SanYin: "散",
  FanYin: "泛",
  AnYin: "按",
};

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

export function JianpuTranslator({ onSelect }: JianpuTranslatorProps) {
  const [number, setNumber] = useState<JianpuNumber | "">("");
  const [octave, setOctave] = useState<JianpuOctave>("");
  const [candidates, setCandidates] = useState<WasmCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleTranslate() {
    if (!number) return;
    setLoading(true);
    const octaveValue = octave === "·" ? 1 : octave === "," ? -1 : 0;
    const raw = await translateJianpuToJianzi(
      JSON.stringify({ number: parseInt(number, 10), octave: octaveValue }),
    );
    let parsed: { candidates: WasmCandidate[] } = { candidates: [] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { candidates: [] };
    }
    setCandidates(parsed.candidates ?? []);
    setLoading(false);
  }

  function buildJianziState(candidate: WasmCandidate) {
    const note = candidate.note;
    const jianzi = createEmptyState();
    jianzi.toneType = NOTE_TYPE_MAP[note.note_type] ?? null;
    if (note.left_finger) {
      jianzi.leftFinger = LEFT_FINGER_MAP[note.left_finger] ?? note.left_finger;
    }
    if (note.hui) {
      jianzi.hui = toChineseNumber(note.hui.hui);
    }
    jianzi.rightAction = RIGHT_ACTION_MAP[note.right_action] ?? note.right_action;
    jianzi.stringNumber = toChineseNumber(note.string_number);
    return jianzi;
  }

  function handleSelect(candidate: WasmCandidate) {
    const jianzi = buildJianziState(candidate);

    onSelect({
      id: crypto.randomUUID(),
      jianpuNumber: number || null,
      jianpuOctave: octave,
      jianpuDot: false,
      duration: "四分",
      jianzi,
    });
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
      {candidates.length > 0 && (
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
    </div>
  );
}
