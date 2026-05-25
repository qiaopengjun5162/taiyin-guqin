"use client";

import type { NoteColumn, Duration } from "@/lib/types";
import { getRhythmLineCount } from "@/lib/types";
import { JianziBlock } from "./jianzi-block";

const SERIF_FONT =
  "var(--font-serif), 'Noto Serif SC', 'Songti SC', 'SimSun', 'STSong', serif";

/**
 * 乐谱流视图 —— 将复合音符列以 flex-wrap 流动排列。
 *
 * 减字部分使用忘机减字谱楷体渲染，通过 OpenType 组字自动完成传统布局。
 */
export function ScoreView({
  notes,
  onRemove,
}: {
  notes: NoteColumn[];
  onRemove?: (id: string) => void;
}) {
  if (notes.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-xs tracking-widest text-stone-400/50 select-none rounded border border-dashed border-stone-400/20">
        在下方拼装减字后点"确认"，乐谱流会出现在这里
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap gap-3 p-4 rounded bg-[#f8f3eb] min-h-20"
      style={{ fontFamily: SERIF_FONT }}
    >
      {notes.map((note, index) => {
        const prev = index > 0 ? notes[index - 1] : null;
        const sameTone = prev?.jianzi.toneType === note.jianzi.toneType && note.jianzi.toneType !== null;
        return (
          <NoteColumnView
            key={note.id}
            note={note}
            index={index}
            compact={sameTone}
            onRemove={onRemove}
          />
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────
// 单个复合音符列
// ──────────────────────────────────────────────

function NoteColumnView({
  note,
  index,
  compact,
  onRemove,
}: {
  note: NoteColumn;
  index: number;
  compact?: boolean;
  onRemove?: (id: string) => void;
}) {
  const { jianzi } = note;

  return (
    <div className="flex flex-col items-center w-[72px] select-none">
      {/* 序号 */}
      <span className="text-[8px] text-stone-400/40 mb-0.5 leading-none">
        {index + 1}
      </span>

      {/* ── 简谱区域 ── */}
      <JianpuView note={note} />

      {/* ── 减字区域（忘机减字谱楷体渲染） ── */}
      <JianziBlock state={jianzi} fontSize="24px" compact={compact} />

      {/* ── 节奏线区域 ── */}
      <RhythmView duration={note.duration} />

      {/* ── 删除按钮 ── */}
      {onRemove && (
        <button
          onClick={() => onRemove(note.id)}
          className="mt-0.5 text-[8px] text-stone-400/30 hover:text-amber-600/50 transition-colors leading-none"
        >
          删除
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 简谱数字渲染
// ──────────────────────────────────────────────

function JianpuView({ note }: { note: NoteColumn }) {
  const { jianpuNumber, jianpuOctave, jianpuDot } = note;
  if (!jianpuNumber) {
    return <div className="h-6" />;
  }

  return (
    <div className="relative h-6 flex items-center justify-center">
      {jianpuOctave === "·" && (
        <span className="absolute -top-0.5 text-sm leading-none text-stone-800 font-bold">
          ·
        </span>
      )}
      <span className="text-base font-bold leading-none text-stone-800">
        {jianpuNumber}
        {jianpuDot && <span className="ml-px">·</span>}
      </span>
      {jianpuOctave === "," && (
        <span className="absolute -bottom-0.5 text-sm leading-none text-stone-800 font-bold">
          ,
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 节奏线（减时线）
// ──────────────────────────────────────────────

function RhythmView({ duration }: { duration: Duration }) {
  const count = getRhythmLineCount(duration);
  const isDefault = duration === "四分";

  return (
    <div className="flex flex-col items-center gap-[0.5px] mt-0.5">
      {!isDefault && (
        <span className="text-[6px] text-stone-400/60 leading-none mb-px">
          {duration}
        </span>
      )}
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-8 h-[1.5px] bg-stone-700 rounded-full" />
      ))}
    </div>
  );
}
