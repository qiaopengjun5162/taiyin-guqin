"use client";

import type { NoteColumn, Duration } from "@/lib/types";
import { getRhythmLineCount, durationToBeats } from "@/lib/types";
import { JianziBlock } from "./jianzi-block";

const SERIF_FONT =
  "var(--font-serif), 'Noto Serif SC', 'Songti SC', 'SimSun', 'STSong', serif";

/**
 * 乐谱流视图 —— 将复合音符列以 flex-wrap 流动排列，并按拍号插入小节线。
 *
 * 减字部分使用忘机减字谱楷体渲染，通过 OpenType 组字自动完成传统布局。
 */
export function ScoreView({
  notes,
  beatsPerBar = 4,
  onRemove,
  onEdit,
  editingIndex,
  playingIndex,
}: {
  notes: NoteColumn[];
  beatsPerBar?: number;
  onRemove?: (id: string) => void;
  onEdit?: (index: number) => void;
  editingIndex?: number | null;
  playingIndex?: number | null;
}) {
  if (notes.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-xs tracking-widest text-stone-400/50 select-none rounded border border-dashed border-stone-400/20">
        在下方拼装减字后点「确认」，乐谱流会出现在这里
      </div>
    );
  }

  const elements: React.ReactNode[] = [];
  let acc = 0;

  notes.forEach((note, index) => {
    const noteBeats = durationToBeats(note.duration, note.jianpuDot);

    // 当前音符会跨过小节边界时，先插入小节线并重置累计
    if (acc > 0 && acc + noteBeats > beatsPerBar) {
      elements.push(<BarLine key={`bar-before-${note.id}`} />);
      acc = 0;
    }

    const prev = index > 0 ? notes[index - 1] : null;
    const sameTone =
      prev?.jianzi.toneType === note.jianzi.toneType &&
      note.jianzi.toneType !== null;

    elements.push(
      <NoteColumnView
        key={note.id}
        note={note}
        index={index}
        compact={sameTone}
        onRemove={onRemove}
        onEdit={onEdit}
        isEditing={editingIndex === index}
        isPlaying={playingIndex === index}
      />,
    );

    acc += noteBeats;
    if (acc >= beatsPerBar) {
      // 不是最后一音时，在当前音后插小节线
      if (index < notes.length - 1) {
        elements.push(<BarLine key={`bar-after-${note.id}`} />);
      }
      acc = 0;
    }
  });

  return (
    <div
      className="flex flex-wrap gap-3 p-4 rounded bg-[#f8f3eb] min-h-20"
      style={{ fontFamily: SERIF_FONT }}
    >
      {elements}
    </div>
  );
}

/** 小节线 —— 竖直分隔符。 */
function BarLine() {
  return (
    <div
      data-testid="bar-line"
      className="flex flex-col items-center justify-center w-4 self-stretch"
    >
      <div className="w-px h-full bg-amber-700/30" />
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
  onEdit,
  isEditing,
  isPlaying,
}: {
  note: NoteColumn;
  index: number;
  compact?: boolean;
  onRemove?: (id: string) => void;
  onEdit?: (index: number) => void;
  isEditing?: boolean;
  isPlaying?: boolean;
}) {
  const { jianzi } = note;

  return (
    <div
      data-note-column
      data-playing={isPlaying || undefined}
      className={`group flex flex-col items-center w-[72px] select-none cursor-pointer rounded pt-1 transition-all duration-150 hover:bg-amber-50/50 ${
        isPlaying
          ? "ring-1 ring-emerald-600/50 bg-emerald-50 shadow-sm shadow-emerald-500/10"
          : isEditing
            ? "ring-1 ring-amber-500/40 bg-amber-50 shadow-sm shadow-amber-500/10"
            : ""
      }`}
      onClick={() => onEdit?.(index)}
    >
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

      {/*
       * stopPropagation 防止点击删除时触发外层 div 的 onClick（即进入编辑模式）。
       * 删除和编辑是互斥操作，用户期望点 × 只删除不编辑。
       */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(note.id);
          }}
          aria-label="删除此音"
          className="mt-1 min-w-[44px] min-h-[44px] -my-2 flex items-center justify-center rounded-full
                     text-stone-400/30 hover:text-amber-600/70 hover:bg-amber-50
                     transition-all duration-200
                     opacity-0 group-hover:opacity-100
                     [@media(hover:none)]:opacity-100
                     text-xs leading-none"
          title="删除此音"
        >
          ×
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
