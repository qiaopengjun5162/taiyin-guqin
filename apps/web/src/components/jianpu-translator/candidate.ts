import type { JianpuNumber, NoteColumn } from "@/lib/types";
import { createEmptyState } from "@/lib/jianzi";
import type { ParsedJianpuNote } from "@/lib/jianpu-parser";
import { parseToneType, toChineseNumber } from "./types";
// 由 Rust wire 类型自动生成（见 crates/taiyin-core/src/bin/gen_types.rs），杜绝手工对齐。
import type { JianziCandidate } from "@/lib/generated/taiyin";

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

export function buildJianziState(candidate: JianziCandidate) {
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

export function candidateToNoteColumn(
  candidate: JianziCandidate,
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
