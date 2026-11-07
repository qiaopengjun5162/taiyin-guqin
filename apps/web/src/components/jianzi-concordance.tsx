"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { JianziState } from "@/lib/types";
import { EXAMPLE_SCORES } from "@/lib/example-scores";
import {
  getScoresSnapshot,
  getServerScoresSnapshot,
  subscribeScores,
} from "@/lib/local-score-store";
import { splitScorePhrases } from "@/lib/score-phrases";
import {
  countScores,
  findConcordance,
  type ConcordanceScore,
} from "@/lib/score-concordance";
import { useNotePreview } from "@/lib/use-note-preview";
import { usePitchContext } from "@/lib/use-pitch-context";

/**
 * 谱例溯源面板 —— 「这个字，在哪些曲子里出现过」。
 *
 * 挂的位置在释义面板里、琴面图下面：读懂了这一字怎么弹，紧接着想知道
 * 「哪首谱里有它」——这是同一个问题往下问一步。
 *
 * 与查字工具的区别就在这一步：它们能告诉你释义（有的还有视频），
 * 但它们的曲谱是图片，点进去只能看。我们的曲谱是一列音，所以每一处都能
 * **当场试听**——而且听到的是弹进谱子里那套合成，不是另配一段音频。
 */

/** 面板里最多列这么多处。再长就不是「见过」，是把整本曲库倒出来。 */
const MAX_ROWS = 8;

const EMPTY: ConcordanceScore[] = [];

export function JianziConcordance({ state }: { state: JianziState }) {
  const stored = useSyncExternalStore(
    subscribeScores,
    getScoresSnapshot,
    getServerScoresSnapshot,
  );
  const { tuning, concertPitch } = usePitchContext();
  const previewNote = useNotePreview(tuning, concertPitch);
  const [scores, setScores] = useState<ConcordanceScore[]>(EMPTY);

  /*
   * 曲库 = 内置示例谱 + 本机「我的曲谱」。
   * 句号必须问 WASM（`phrase_ranges` 是气口阈值的唯一一处定义，前端不许自己判），
   * 所以每首都要 await；哪首切句失败就当它没切，界面只说「第几个音」不猜第几句。
   */
  useEffect(() => {
    const bases: Array<Omit<ConcordanceScore, "phrases">> = [
      ...EXAMPLE_SCORES.map((score) => ({
        id: score.id,
        title: score.title,
        notes: score.notes,
        source: "示例" as const,
      })),
      ...stored.map((score) => ({
        id: score.id,
        title: score.title,
        notes: score.notes,
        source: "我的" as const,
      })),
    ];
    // 空曲库保持初始的 EMPTY，不必起一轮异步
    if (bases.length === 0) return;

    let cancelled = false;
    Promise.all(
      bases.map(async (base) => {
        const phrases = await splitScorePhrases(base.notes)
          .then((list) => list.map((span) => ({ start: span.start, end: span.end })))
          .catch(() => []);
        return { ...base, phrases };
      }),
    ).then((next) => {
      if (!cancelled) setScores(next);
    });
    return () => {
      cancelled = true;
    };
  }, [stored]);

  const hits = useMemo(() => findConcordance(state, scores), [state, scores]);
  const visible = hits.slice(0, MAX_ROWS);
  const rest = hits.length - visible.length;
  const scoreCount = countScores(hits);

  // 曲库还是空的、或者这个字一次都没出现：不显示。
  // 「暂时没查到」在这里没有信息量——它只说明你的曲库还小，不值得占一行。
  if (visible.length === 0) return null;

  return (
    <div className="mt-2 border-t border-amber-800/10 pt-1.5">
      <p className="flex items-baseline justify-between text-[10px] tracking-[0.15em] text-amber-800/60">
        <span>谱中见过</span>
        <span className="tracking-normal text-stone-500">
          {hits.length} 处 · {scoreCount} 首
        </span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {visible.map((hit) => (
          <li key={`${hit.scoreId}-${hit.index}`}>
            <button
              type="button"
              onClick={() => previewNote(hit.note.jianzi)}
              title="点一下听这个字"
              className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-[11px] leading-relaxed text-stone-700 hover:bg-amber-900/[0.06]"
            >
              <span className="shrink-0 text-stone-500">
                {hit.source === "我的" ? "我" : "例"}
              </span>
              <span className="min-w-0 flex-1 truncate">{hit.title}</span>
              <span className="shrink-0 text-stone-500">
                {hit.phraseIndex === null ? "" : `第 ${hit.phraseIndex + 1} 句`}
              </span>
              <span className="shrink-0 tabular-nums text-stone-500">
                第 {hit.index + 1} 音
              </span>
              {hit.kind === "loose" && (
                <span className="shrink-0 text-[10px] text-amber-800/70">别弦</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="mt-1 text-[10px] tracking-wider text-stone-500">
          另有 {rest} 处
        </p>
      )}
    </div>
  );
}
