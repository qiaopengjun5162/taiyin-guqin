"use client";

import { Fragment, useState } from "react";
import type { NoteColumn, JianpuNumber } from "@/lib/types";
import { createEmptyState } from "@/lib/jianzi";
import {
  translateJianpuSequenceToJianzi,
  arrangeJianpuSequence,
  describeArrangement,
  type JianpuArrangement,
  type PhraseSpan,
} from "@/lib/taiyin-wasm";
import { selectCandidates } from "@/lib/api";
import { useNotePreview } from "@/lib/use-note-preview";
import {
  parseJianpuString,
  noteUnits,
  type ParsedJianpuNote,
  type ParsedJianpuItem,
} from "@/lib/jianpu-parser";
import type { JianziCandidate } from "@/lib/generated/taiyin";
import { buildJianziState, candidateToNoteColumn } from "./candidate";
import { CandidateChip } from "./candidate-chip";
import { TUNING_TO_ID, type Tuning } from "./types";

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
  const [candidatesPerNote, setCandidatesPerNote] = useState<JianziCandidate[][]>(
    [],
  );
  const [selectedIndex, setSelectedIndex] = useState<number[]>([]);
  // 候选产生时的调式；与当前调式不一致时整批候选作废
  const [notesTuning, setNotesTuning] = useState<Tuning | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [arrangeLoading, setArrangeLoading] = useState(false);
  // 上一次编排的完整结果（含两条路径的活动量）。用户手动改选后就不再代表
  // 当前这组选择，所以改动即清空——留着一个对不上的数字比不显示更糟。
  const [arrangeResult, setArrangeResult] = useState<JianpuArrangement | null>(
    null,
  );

  const preview = useNotePreview(TUNING_TO_ID[tuning]);

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
      let parsedResult: { candidates_per_note?: JianziCandidate[][] } = {};
      try {
        parsedResult = JSON.parse(raw);
      } catch {
        parsedResult = {};
      }

      const result = parsedResult.candidates_per_note ?? [];
      // 将可演奏音符的候选与休止符对齐：休止符位置用空数组填充。
      const aligned: JianziCandidate[][] = [];
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
      setArrangeResult(null);
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
      if (!candidate) {
        // 翻译没给这个音候选（罕见：后端返回的候选数少于音数）：
        // 不要静默丢掉——保留简谱、减字留空，播放时退回简谱音高，
        // 旋律与节奏不破。否则后续音符整体左移、小节线全错位。
        columns.push({
          id: crypto.randomUUID(),
          jianpuNumber: String(item.number) as JianpuNumber,
          jianpuOctave:
            item.octave === 2
              ? "··"
              : item.octave === 1
                ? "·"
                : item.octave === -1
                  ? ","
                  : item.octave === -2
                    ? ",,"
                    : "",
          jianpuDot: item.dotted,
          duration: item.duration,
          jianzi: createEmptyState(),
        });
        continue;
      }
      columns.push(candidateToNoteColumn(candidate, item));
    }
    if (columns.length === 0) return;
    onSelect(columns);
    setNotes([]);
    setCandidatesPerNote([]);
    setSelectedIndex([]);
    setArrangeResult(null);
  }

  function handleClear() {
    setInput("");
    setNotes([]);
    setCandidatesPerNote([]);
    setSelectedIndex([]);
    setAiHint(null);
    setArrangeResult(null);
  }

  /**
   * 全局指法编排：把整句当一条路径求最优，而不是逐音各自最舒服。
   *
   * 逐音贪心（也就是「翻译」拿到的默认选择）常在第一音就锁死一个孤立落点，
   * 后面每个音都在补偿——单看每个字都有分，连起来手在琴上东奔西跑。
   * 这里用 Rust 端的 Viterbi 求整句最小代价路径，会牺牲个别音的单音舒适度，
   * 换来整句少换把、少跨弦。
   *
   * 返回的候选与选中项出自同一次计算，一起替换：候选顺序也跟着变成
   * 「本条路径选中的排首位」，所以不能只更新选中下标。
   */
  async function handleArrange() {
    const playable = notes.filter(
      (n): n is ParsedJianpuNote => n.kind === "note",
    );
    if (playable.length === 0) return;
    setArrangeLoading(true);
    setError(null);
    try {
      // 带上时值：编排要知道「这个音留了多少时间给手」。
      // 不带时值也能跑（按四分音符算），但那样八分连奏里的换把会被判成「来得及」。
      const result = await arrangeJianpuSequence(
        playable.map((n) => ({
          number: n.number,
          octave: n.octave,
          duration_units: noteUnits(n),
        })),
        tuning,
      );

      // 与「翻译」同样的对齐方式：休止符位置留空数组，
      // 否则后面每个音都会左移一位、小节线全错。
      const alignedCands: JianziCandidate[][] = [];
      const alignedSel: number[] = [];
      let k = 0;
      for (const item of notes) {
        if (item.kind === "rest") {
          alignedCands.push([]);
          alignedSel.push(0);
        } else {
          alignedCands.push(result.candidates_per_note[k] ?? []);
          alignedSel.push(result.selections[k] ?? 0);
          k++;
        }
      }

      setCandidatesPerNote(alignedCands);
      setSelectedIndex(alignedSel);
      setArrangeResult(result);
      setAiHint(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "编排失败");
    } finally {
      setArrangeLoading(false);
    }
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
      // AI 优选换了路径，之前的编排代价不再对应现在这组选择
      setArrangeResult(null);
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
    // 手动改选后整句代价已经不对应了，别把旧数字继续挂在界面上
    setArrangeResult(null);
  }

  /**
   * 「这一行是第几句的开头」。
   *
   * Rust 给的是**送进去的那个数组**的下标（送进去时滤掉了休止符），
   * 这里按同样的顺序数一遍，换算回列表行号。少算一个休止符，
   * 后面的分隔线就整体错一行——看起来只是「分句有点怪」，实际已经错位。
   */
  const phraseByRow = new Map<number, PhraseSpan>();
  if (
    arrangeResult &&
    notesTuning === tuning &&
    arrangeResult.phrases.length > 1
  ) {
    const spanByStart = new Map(arrangeResult.phrases.map((p) => [p.start, p]));
    let playableIdx = 0;
    notes.forEach((item, row) => {
      if (item.kind !== "note") return;
      const phrase = spanByStart.get(playableIdx);
      if (phrase) phraseByRow.set(row, phrase);
      playableIdx++;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="例如：5 6 1 2 | 3 5 6 -"
        rows={2}
        className="w-full px-2 py-1 rounded border border-amber-700/20 bg-transparent text-stone-700 text-sm placeholder:text-stone-400 resize-none"
      />
      <p className="text-[9px] tracking-wider text-amber-800/60">
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
                  onClick={handleArrange}
                  disabled={arrangeLoading}
                  title="把整句当一个整体排指法：少换把、少跨弦，而不是每个音各自最舒服"
                  className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 disabled:opacity-30"
                >
                  {arrangeLoading ? "编排中…" : "智能编排"}
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
              <span className="text-[10px] tracking-wider text-stone-500">
                调式已变更，请重新翻译
              </span>
            )}
            <button
              onClick={handleClear}
              className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300"
            >
              清空
            </button>
            {arrangeResult && (
              <span className="text-[10px] tracking-wider text-amber-800/70">
                已编排
              </span>
            )}
            {aiHint && (
              <span className="text-[10px] tracking-wider text-stone-500">
                {aiHint}
              </span>
            )}
          </>
        )}
      </div>
      {/* 编排到底省了什么，单独一行说清楚：塞在按钮行里会被挤成省略号 */}
      {arrangeResult && notesTuning === tuning && (
        <p className="text-[10px] leading-relaxed tracking-wider text-amber-800/70">
          {describeArrangement(arrangeResult)}
        </p>
      )}
      {error && (
        <p className="text-[10px] tracking-wider text-red-400/80">{error}</p>
      )}
      {notes.length > 0 && notesTuning === tuning && (
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
          {notes.map((item, noteIdx) => {
            const phrase = phraseByRow.get(noteIdx);
            return (
              <Fragment key={`${noteIdx}-${item.raw}`}>
                {phrase && (
                  <div
                    data-phrase-index={phrase.index}
                    className="flex items-center gap-2 px-1 pt-1"
                  >
                    <span className="text-[9px] tracking-widest text-amber-700/60">
                      第 {phrase.index + 1} 句
                    </span>
                    <span className="h-px flex-1 bg-amber-700/15" />
                    <span className="text-[9px] tracking-wider text-stone-500">
                      {phrase.note_count} 音 · 换弦 {phrase.stats.string_changes}
                      {phrase.stats.rushed_moves > 0
                        ? ` · 快句换手 ${phrase.stats.rushed_moves}`
                        : ""}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 rounded border border-amber-700/15 bg-amber-900/5 px-2 py-1">
                  <span className="w-8 shrink-0 text-center text-xs text-stone-600">
                    {item.raw}
                  </span>
                  {/* 一个音常有三十多个落点，横排滑动看，不要把每个音拉成十几行 */}
                  <div className="flex flex-1 gap-1.5 overflow-x-auto pb-1">
                    {candidatesPerNote[noteIdx]?.map((c, candIdx) => {
                      const state = buildJianziState(c);
                      return (
                        <div key={candIdx} className="w-[72px] shrink-0">
                          <CandidateChip
                            state={state}
                            score={c.score}
                            selected={selectedIndex[noteIdx] === candIdx}
                            onPick={() => selectCandidate(noteIdx, candIdx)}
                            onPreview={() => preview(state)}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <span className="w-5 shrink-0 text-right text-[9px] text-stone-500">
                    {candidatesPerNote[noteIdx]?.length ?? 0}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
