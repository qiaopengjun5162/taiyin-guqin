"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteColumn, Duration } from "@/lib/types";
import { getRhythmLineCount } from "@/lib/jianzi";
import {
  groupIntoBars,
  equalBarWidth,
  NOTE_COLUMN_WIDTH,
  type Bar,
} from "@/lib/score-bars";
import {
  DENSITY_GAP,
  DENSITY_PADDING,
  type ScoreDensity,
  type ScoreLayout,
} from "@/lib/score-layout";
import { JianziBlock } from "./jianzi-block";

const SERIF_FONT =
  "var(--font-serif), 'Noto Serif SC', 'Songti SC', 'SimSun', 'STSong', serif";

/** 小节线占位宽度（px）。等宽小节算「每行能放几节」时要把它算进去。 */
const BAR_LINE_WIDTH = 16;

/**
 * 乐谱流视图 —— 三种排版：自然流式 / 小节换行 / 等宽小节。
 *
 * 三者的音符与减字渲染完全一致，差别只在「如何把小节组装成行」：
 * - `flow`：所有音符拍平成一串，小节线跟着流走，一行满了就换（默认，最紧凑）。
 * - `barline`：以小节为原子单位换行，一节不会被劈到两行。
 * - `equal`：小节宽度统一，右边缘对齐成一条线。
 *
 * 减字部分使用忘机减字谱楷体渲染，通过 OpenType 组字自动完成传统布局。
 */
export function ScoreView({
  notes,
  beatsPerBar = 4,
  layout = "flow",
  density = "normal",
  onRemove,
  onEdit,
  onSeekLyric,
  editingIndex,
  playingIndex,
}: {
  notes: NoteColumn[];
  beatsPerBar?: number;
  layout?: ScoreLayout;
  density?: ScoreDensity;
  onRemove?: (id: string) => void;
  onEdit?: (index: number) => void;
  onSeekLyric?: (index: number) => void;
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

  const bars = groupIntoBars(notes, beatsPerBar);
  const gap = DENSITY_GAP[density];
  const pad = DENSITY_PADDING[density];
  /**
   * 等宽小节的列宽下限：按最长的一节算，**并加上小节线占位**。
   * 少加这 16px 的表现是：音符刚好铺满后，小节线被挤到列外，右边缘就差一格。
   */
  const barWidth =
    layout === "equal" ? equalBarWidth(bars, gap) + BAR_LINE_WIDTH : 0;

  /** 同一音色连排时收窄减字，让"同一种指法连着走"在视线上成组。 */
  const isCompact = (index: number) =>
    index > 0 &&
    notes[index - 1].jianzi.toneType === notes[index].jianzi.toneType &&
    notes[index].jianzi.toneType !== null;

  const renderColumn = (note: NoteColumn, index: number) => (
    <NoteColumnView
      key={note.id}
      note={note}
      index={index}
      compact={isCompact(index)}
      onRemove={onRemove}
      onEdit={onEdit}
      onSeekLyric={onSeekLyric}
      isEditing={editingIndex === index}
      isPlaying={playingIndex === index}
    />
  );

  const shell = (children: React.ReactNode) => (
    <div
      data-score-layout={layout}
      className="rounded bg-[#f8f3eb] min-h-20"
      style={{
        fontFamily: SERIF_FONT,
        padding: pad,
        ...(layout === "equal" && barWidth > 0
          ? {
              /*
               * 等宽小节用 grid 而不用 flex + space-between：
               * space-between 会把一行剩下的空间全塞进「唯一的那个间隙」，
               * 一行两节时中间出现一个大洞。grid 的 auto-fill 让列数由可用宽度决定、
               * 每列等宽，剩余空间均摊进每一列——小节既等宽、右边缘齐、又不留洞。
               */
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${barWidth}px, 1fr))`,
              columnGap: gap,
              rowGap: 16,
              overflowX: "auto",
            }
          : {
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              gap,
              justifyContent: "flex-start",
              // 小节成组后是「不可拆」的原子块，比容器还宽时无法像音符那样折行。
              // 让它自己横向滚动，而不是把整页撑出横向滚动条（手机上尤其明显）。
              overflowX: layout === "barline" ? "auto" : undefined,
            }),
      }}
    >
      {children}
    </div>
  );

  // ── 自然流式：拍平成一串，小节线是普通流元素 ──
  if (layout === "flow") {
    const flat: React.ReactNode[] = [];
    bars.forEach((bar, barIndex) => {
      // 最后一节后面不画线：谱尾多一根竖线不像谱，像表格没画完
      if (barIndex > 0) flat.push(<BarLine key={`bar-${barIndex}`} />);
      bar.notes.forEach((note, i) =>
        flat.push(renderColumn(note, bar.startIndex + i)),
      );
    });
    return shell(flat);
  }

  // ── 小节换行 / 等宽小节：小节是原子单位，整节换行 ──
  return shell(
    bars.map((bar, barIndex) => (
      <BarGroup
        key={`bar-group-${barIndex}`}
        bar={bar}
        // 等宽档交给 grid 的列宽决定，bar 自己撑满整列——这样右边缘才齐到页边
        fill={layout === "equal"}
        gap={gap}
        isLast={barIndex === bars.length - 1}
        equal={layout === "equal"}
      >
        {bar.notes.map((note, i) => renderColumn(note, bar.startIndex + i))}
      </BarGroup>
    )),
  );
}

/**
 * 一个小节的渲染容器。
 *
 * 为什么小节线和音符要包在同一个 flex 项里：若把小节线做成同级的独立 flex 项，
 * 换行时可能把小节线单独推到下一行行首，看起来像凭空多了一根线。包成一组，
 * 它就是不可分割的整体，换行只会发生在两组之间。
 */
function BarGroup({
  bar,
  fill,
  gap,
  isLast,
  equal,
  children,
}: {
  bar: Bar;
  fill?: boolean;
  gap: number;
  isLast: boolean;
  equal: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-bar-group
      data-bar-start={bar.startIndex}
      className="flex items-stretch"
      style={{
        gap,
        width: fill ? "100%" : undefined,
        // 等宽小节：音符在一个固定宽度的盒子里均匀铺开，右边缘才对得齐
        justifyContent: equal ? "space-around" : "flex-start",
        // 整节不被拆到两行；打印同理（见 globals.css 的 @media print）
        breakInside: "avoid",
      }}
    >
      {children}
      {!isLast && <BarLine />}
    </div>
  );
}

/** 小节线 —— 竖直分隔符。 */
function BarLine() {
  return (
    <div
      data-testid="bar-line"
      className="flex flex-col items-center justify-center self-stretch"
      style={{ width: BAR_LINE_WIDTH }}
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
  onSeekLyric,
  isEditing,
  isPlaying,
}: {
  note: NoteColumn;
  index: number;
  compact?: boolean;
  onRemove?: (id: string) => void;
  onEdit?: (index: number) => void;
  onSeekLyric?: (index: number) => void;
  isEditing?: boolean;
  isPlaying?: boolean;
}) {
  const { jianzi } = note;

  // 双谱联动高亮：悬停简谱↔减字互相反向强调，让"音高"与"指法"的对应一眼可见。
  const [linkHover, setLinkHover] = useState<"jianpu" | "jianzi" | null>(null);

  // 播放时把当前音符列滚动进视野，长曲不跟丢（仅在浏览器支持 scrollIntoView 时）
  const columnRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      isPlaying &&
      typeof columnRef.current?.scrollIntoView === "function"
    ) {
      columnRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isPlaying]);

  return (
    <div
      ref={columnRef}
      data-note-column
      data-playing={isPlaying || undefined}
      className={`group flex flex-col items-center select-none cursor-pointer rounded pt-1 transition-all duration-150 hover:bg-amber-50/50 ${
        isPlaying
          ? "ring-1 ring-emerald-600/50 bg-emerald-50 shadow-sm shadow-emerald-500/10"
          : isEditing
            ? "ring-1 ring-amber-500/40 bg-amber-50 shadow-sm shadow-amber-500/10"
            : ""
      }`}
      style={{ width: NOTE_COLUMN_WIDTH, flex: "0 0 auto" }}
      onClick={() => onEdit?.(index)}
    >
      {/* 序号 */}
      <span className="text-[8px] text-stone-400/40 mb-0.5 leading-none">
        {index + 1}
      </span>

      {/* ── 简谱区域 ── */}
      <div
        onMouseEnter={() => setLinkHover("jianpu")}
        onMouseLeave={() => setLinkHover(null)}
        className={`rounded transition-shadow ${
          linkHover === "jianzi" ? "ring-1 ring-amber-400/60 bg-amber-50/40" : ""
        }`}
      >
        <JianpuView note={note} />
      </div>

      {/* ── 减字区域（忘机减字谱楷体渲染） ── */}
      <div
        onMouseEnter={() => setLinkHover("jianzi")}
        onMouseLeave={() => setLinkHover(null)}
        className={`rounded transition-shadow ${
          linkHover === "jianpu" ? "ring-1 ring-amber-400/60 bg-amber-50/40" : ""
        }`}
      >
        <JianziBlock state={jianzi} fontSize="24px" compact={compact} />
      </div>

      {/* ── 节奏线区域 ── */}
      <RhythmView duration={note.duration} />

      {/* ── 歌词区域（按字对齐到音符下方；播放时高亮当前字） ── */}
      <div className="mt-0.5 min-h-[14px] flex items-center justify-center px-0.5">
        {note.lyric && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onSeekLyric?.(index);
            }}
            title="点击从此音开始播放"
            className={`text-[11px] leading-none font-medium cursor-pointer hover:text-rose-900 transition-colors ${
              isPlaying ? "text-rose-700" : "text-rose-700/70"
            }`}
          >
            {note.lyric}
          </span>
        )}
      </div>

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
      {jianpuOctave.startsWith("·") && (
        <span className="absolute -top-1 text-sm leading-none text-stone-800 font-bold">
          {jianpuOctave}
        </span>
      )}
      <span className="text-base font-bold leading-none text-stone-800">
        {jianpuNumber}
        {jianpuDot && <span className="ml-px">·</span>}
      </span>
      {jianpuOctave.startsWith(",") && (
        <span className="absolute -bottom-1 text-sm leading-none text-stone-800 font-bold">
          {jianpuOctave}
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
