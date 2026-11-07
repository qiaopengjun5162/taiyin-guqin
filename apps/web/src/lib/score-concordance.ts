import type { JianziState, NoteColumn } from "./types";
import { leftFingerInfo, rightActionInfo } from "./jianzi-explain";

/**
 * 谱例溯源 —— 「这个字在哪些曲子里出现过」。
 *
 * 为什么要做这件事：查字的工具（2015 年的爱搜减字、2021 年的华夏古琴网小程序）
 * 都能告诉你一个字读什么、什么意思，但到此为止。它们的曲谱是**图片索引**，
 * 点进去只能看图；我们的曲谱是一列结构化音，所以能回答更进一步的问题——
 * 这个字出现在哪首谱、第几句、第几个音，并且当场把它弹出来。
 *
 * 这里只做检索，不碰 UI，也不碰播放：给定一个待查的谱字和一批曲谱，
 * 返回命中位置。切句由调用方先算好传进来（前端不许自己抄气口阈值，
 * 句界只有 Rust 的 `phrase_ranges` 一处定义）。
 */

/** 一首可参与检索的曲谱。 */
export interface ConcordanceScore {
  id: string;
  title: string;
  /** 来源：内置示例谱，或存在本机「我的曲谱」里。 */
  source: "示例" | "我的";
  notes: NoteColumn[];
  /**
   * 句界（下标闭区间）。调用方用 `splitScorePhrases` 算好；
   * 还没切句或切句失败时给空数组——此时命中项的 `phraseIndex` 为 null，
   * 界面只说「第几个音」，不猜它是第几句。
   */
  phrases: Array<{ start: number; end: number }>;
}

/** 一处命中。 */
export interface ConcordanceHit {
  scoreId: string;
  title: string;
  source: "示例" | "我的";
  /** 这个音在曲谱里的下标（0 起）。 */
  index: number;
  /** 第几句（0 起）；没切句时为 null。 */
  phraseIndex: number | null;
  /**
   * exact = 同一个字（连弦号都一样）；
   * loose = 同指法但换了弦——「大九勾四」与「大九勾二」是同一个动作格局。
   */
  kind: "exact" | "loose";
  note: NoteColumn;
}

/**
 * 谱字的检索键。
 *
 * 键里放什么是有取舍的：
 * - `toneType` 必须算——按音与泛音同形不同声，混起来会给出错的谱例；
 * - `rhythmMode` 不算——板/散/宕解释的是时值，不改这个字怎么写；
 * - `slide` 要算——「大九六绰勾四」与「大九六勾四」弹出的音高并不相同。
 *
 * 音色或右手指法还没选时返回 null：这时用户还在拼字，查出来的是半截键，
 * 只能匹配到别的半截键，不如不查。
 */
export function jianziSignature(
  state: JianziState,
  options: { ignoreString?: boolean } = {},
): string | null {
  if (!state.toneType || !state.rightAction) return null;
  // 左手与右手指法都存在两套写法：键盘给偏旁（勹 = 勾），粘贴传统谱本给全字。
  // 不归一化就会「同一个字两个键」——拼出来的勹查不到导进来的勾。
  // 释义表本来就两套都收，借它把两边对齐成同一个名字。
  const finger = leftFingerInfo(state.leftFinger)?.name ?? state.leftFinger;
  const action = rightActionInfo(state.rightAction)?.name ?? state.rightAction;
  const slot = (value: string | null) => value ?? "-";
  const parts = [
    state.toneType,
    slot(finger),
    slot(state.hui),
    slot(state.fen),
    slot(state.slide),
    slot(action),
  ];
  if (!options.ignoreString) parts.push(slot(state.stringNumber));
  return parts.join("|");
}

/** 这个音落在第几句；曲谱没切句或下标越界时返回 null。 */
function phraseIndexOf(
  phrases: Array<{ start: number; end: number }>,
  index: number,
): number | null {
  for (let i = 0; i < phrases.length; i++) {
    const span = phrases[i];
    if (span && index >= span.start && index <= span.end) return i;
  }
  return null;
}

const DEFAULT_LIMIT = 24;

/**
 * 在曲库里找这个字。
 *
 * 规则只有一条，但要说清：**先按严匹配找，一处都没有才退到宽匹配。**
 * 不把两种结果混在一起列，是因为「同一字」和「同指法换了弦」对学琴的人
 * 是两件事——前者是「这句里也有它」，后者是「这个动作还能落在别处」。
 * 混着排会让前者被后者稀释，而前者才是他想找的。
 */
export function findConcordance(
  target: JianziState,
  scores: ConcordanceScore[],
  options: { limit?: number } = {},
): ConcordanceHit[] {
  const strictKey = jianziSignature(target);
  if (strictKey === null) return [];
  const looseKey = jianziSignature(target, { ignoreString: true });
  if (looseKey === null) return [];

  // 弦号没选时严匹配不可能命中（真实谱字的弦号不会是 "-"），直接走宽匹配
  const strictUsable = target.stringNumber !== null;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const strict: ConcordanceHit[] = [];
  const loose: ConcordanceHit[] = [];

  for (const score of scores) {
    for (let index = 0; index < score.notes.length; index++) {
      const note = score.notes[index];
      if (!note) continue;
      const key = jianziSignature(note.jianzi, { ignoreString: true });
      if (key !== looseKey) continue;

      const isExact =
        strictUsable && jianziSignature(note.jianzi) === strictKey;
      (isExact ? strict : loose).push({
        scoreId: score.id,
        title: score.title,
        source: score.source,
        index,
        phraseIndex: phraseIndexOf(score.phrases, index),
        kind: isExact ? "exact" : "loose",
        note,
      });
    }
  }

  const hits = strict.length > 0 ? strict : loose;
  return hits.slice(0, limit);
}

/** 命中分布在几首曲谱里——界面上「共 N 处 · M 首」的后半句。 */
export function countScores(hits: ConcordanceHit[]): number {
  return new Set(hits.map((hit) => hit.scoreId)).size;
}
