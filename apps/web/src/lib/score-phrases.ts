"use client";

import { useEffect, useState } from "react";
import type { NoteColumn } from "./types";
import { durationToBeats } from "./jianzi";
import { splitPhrases } from "./taiyin-wasm";

/**
 * 曲谱的「句」——按气口切出来的一段，供谱面画分隔线、供练习按句循环。
 *
 * 与 0.34.0 编排里的 `PhraseSpan` 是同一套句界（都问 Rust 的 `phrase_ranges`），
 * 但这里只切分、不评价：谱面上画一条线不该先算一遍最优指法，
 * 而「哪一句最赶」需要候选与转移代价，属于编排结果，不在这里。
 */
export interface ScorePhrase {
  /** 起始音下标（含）。 */
  start: number;
  /** 结束音下标（含）。 */
  end: number;
  /** 这一句有几个位置（含休止符——它占拍子，慢练时要等够）。 */
  noteCount: number;
  /** 这一句一共多少拍（含休止符与附点）。 */
  beats: number;
}

/**
 * 一句在下标上的身份：**边界即身份**。
 *
 * 谱面一改，句的起止就变了，这条键也跟着变——练习进度因此自然作废，
 * 不会出现「第 3 句已过原速」标在一段你根本没练过的音上。
 * 带上 noteCount 是为了区分「边界相同但少了一个音」这种裁剪。
 */
export function phraseKey(phrase: ScorePhrase): string {
  return `${phrase.start}-${phrase.end}-${phrase.noteCount}`;
}

/** 一拍 = 8 个单位，与 Rust 的 `duration_units` 是同一把尺子。 */
const UNITS_PER_BEAT = 8;

/**
 * 一句慢练连弹几遍。
 *
 * 三遍是刻意的：一遍是「听清」，两遍是「跟着落手」，三遍才开始「记住」。
 * 再多就该让练琴的人自己按停止——程序替他决定还要练多久，
 * 他会在第四遍开始走神，然后以为是自己不行。
 */
export const PRACTICE_REPEATS = 3;

/**
 * 合练（两句连着走）连弹几遍。
 *
 * 两遍，比单句少一遍：合练不是记肌肉，是确认「上一句收尾之后手还找得到下一句的起手」。
 * 一遍跨过那个气口，一遍确认不是碰巧；再往下就是重复单句已经练过的东西，
 * 而多走一遍的代价是两句的时间——长句两句一遍就二十秒，三遍一分钟，
 * 练琴的人会在第二分钟开始怀疑这个按钮。
 */
export const JOIN_REPEATS = 2;

/**
 * 合练区间：本句 + 相邻那一句。
 *
 * 有下一句就往后再接——练琴真正会断的地方是「上一句收尾 → 下一句起手」这一个气口，
 * 往后接正好跨过一次；末句没有下一句，就往前接，跨的仍然是它前面那个气口。
 *
 * 只有一句时返回 null：那时「合」只是把这一句再弹一遍，叫重复，不叫合练。
 */
export function joinRange(
  phrases: ScorePhrase[],
  index: number,
): { from: number; to: number; start: number; end: number } | null {
  const current = phrases[index];
  if (!current || phrases.length < 2) return null;
  const neighbor = index + 1 < phrases.length ? index + 1 : index - 1;
  const from = Math.min(index, neighbor);
  const to = Math.max(index, neighbor);
  const first = phrases[from];
  const last = phrases[to];
  if (!first || !last) return null;
  return { from, to, start: first.start, end: last.end };
}

/**
 * 一个音占多少 1/8 拍。
 *
 * 时值表只有 `durationToBeats` 一份（它已经处理了附点），这里只做单位换算，
 * 不另立一套时值定义——两套时值定义迟早会不一致，而且没人会发现。
 */
export function noteUnits(note: NoteColumn): number {
  return Math.round(durationToBeats(note.duration, note.jianpuDot) * UNITS_PER_BEAT);
}

/** 每句的拍数与位置数——纯统计，边界一律来自 Rust。 */
export function describeRanges(
  notes: NoteColumn[],
  ranges: { start: number; end: number }[],
): ScorePhrase[] {
  return ranges.map(({ start, end }) => {
    let beats = 0;
    for (let i = start; i <= end; i++) {
      const note = notes[i];
      if (note) beats += durationToBeats(note.duration, note.jianpuDot);
    }
    return { start, end, noteCount: end - start + 1, beats };
  });
}

/**
 * 切句。空谱给空结果；WASM 尚未就绪时由 `splitPhrases` 内部等待，
 * 加载失败则抛错，交给调用方决定「不显示」而不是猜一个边界。
 */
export async function splitScorePhrases(
  notes: NoteColumn[],
): Promise<ScorePhrase[]> {
  if (notes.length === 0) return [];
  const ranges = await splitPhrases(notes.map(noteUnits));
  return describeRanges(notes, ranges);
}

const NO_PHRASES: ScorePhrase[] = [];

/**
 * 订阅「当前这份谱切成哪几句」。
 *
 * 用 `source` 做同一性检查而不是直接存结果：谱面改动后、新一轮切句回来之前，
 * 旧句界会指向已经不存在的音——照着它画线或按它循环，会练到别的音上去。
 * 宁可这一瞬间不显示分隔线，也不要显示一条错的。
 */
export function useScorePhrases(notes: NoteColumn[]): ScorePhrase[] {
  const [state, setState] = useState<{
    source: NoteColumn[] | null;
    phrases: ScorePhrase[];
  }>({ source: null, phrases: NO_PHRASES });

  useEffect(() => {
    // 空谱没有句可切：不必起一次异步请求，也免得每次都触发一轮状态更新
    if (notes.length === 0) return;
    let cancelled = false;
    splitScorePhrases(notes)
      .then((phrases) => {
        if (!cancelled) setState({ source: notes, phrases });
      })
      .catch(() => {
        // WASM 加载失败 / 旧产物没有这个导出：不显示分句，其余功能照旧。
        // 这里刻意不报错——练习的人不需要知道「切句这次没跑成」。
        if (!cancelled) setState({ source: notes, phrases: NO_PHRASES });
      });
    return () => {
      cancelled = true;
    };
  }, [notes]);

  return state.source === notes ? state.phrases : NO_PHRASES;
}

/**
 * 一句有多长（秒），按当前的「原速 + 慢练倍率」算。
 *
 * 用拍数而不是数音数：一个二分音符和两个四分音符听起来一样长，
 * 数音数会让慢练的时间条对不上耳朵。
 */
export function phraseSeconds(
  phrase: ScorePhrase,
  bpm: number,
  tempo = 1,
): number {
  if (bpm <= 0 || tempo <= 0) return 0;
  return (phrase.beats * 60) / (bpm * tempo);
}

/** 「第 3 句 · 8 个位置 · 0.6× 约 9 秒」——只给这一句本身的事实。 */
export function describePhrase(
  phrase: ScorePhrase,
  index: number,
  bpm: number,
  tempo: number,
): string {
  const seconds = phraseSeconds(phrase, bpm, tempo);
  const rounded = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return `第 ${index + 1} 句 · ${phrase.noteCount} 个位置 · ${tempo}× 约 ${rounded} 秒`;
}
