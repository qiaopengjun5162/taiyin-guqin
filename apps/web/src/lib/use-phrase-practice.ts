/**
 * 逐句慢练 —— 从 `page.tsx` 拆出来的一个关注点。
 *
 * ## 这一簇为什么值得单独成 hook
 *
 * 慢练相关的状态有 5 个、相互之间有硬约束，散在 2000 行的 `page.tsx` 里
 * 任何一处改动都要通读全文才能确认没破坏它们：
 *
 * - `practiceTempo`（手选的档）与 `practicePlay.tempo`（**实际走的那一档**）是两件事。
 *   播放中档位可拨且不打断这一遍，走完之后两者可能已经不同——记账必须用后者，
 *   否则「0.6 走完」会被写成「1× 走完」，谱面上立刻多一根朱砂横线，那是句谎话。
 * - 合练的档取两句里更慢的那句（`joinTempo`），且**不写回** `practiceTempo`——
 *   写回去会让下次点句子莫名其妙地变快/变慢。
 * - 句界由 Rust 切（`useScorePhrases` → `split_phrases_to_json`），
 *   与指法编排同源；前端抄一份就会「谱面分 5 句、编排按 4 句算」。
 *
 * ## 依赖注入的边界
 *
 * 播放器与节拍器不在这里创建，由调用方传进来（它们服务于整首播放，不只服务慢练）。
 * 这样这个 hook 只依赖「能停、能播、能停节拍器」三件事，不绑死具体实现，
 * 测试里也不必造一套 AudioContext。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  JOIN_REPEATS,
  PRACTICE_REPEATS,
  joinRange,
  phraseKey,
  useScorePhrases,
} from "./score-phrases";
import {
  joinTempo,
  recordTempo,
  scoreProgressKey,
  stickingPoints,
  writeProgress,
  readProgress,
  type PhraseProgress,
} from "./practice-progress";
import type { NoteColumn } from "./types";
import type { PracticeRange } from "./use-score-player";

/** 正在走的那一段：哪句到哪句、什么档、走几遍。 */
export interface PracticePlay {
  from: number;
  to: number;
  tempo: number;
  repeat: number;
}

interface Options {
  score: NoteColumn[];
  currentScoreId: string | null;
  scoreTitle: string;
  /** 播放器：`play(startIndex, practice)`。 */
  play: (startIndex?: number, practice?: PracticeRange) => void;
  stopPlayback: () => void;
  /** 节拍器：慢练时必须停掉，否则会把人往原速上带。 */
  metronomeRunning: boolean;
  stopMetronome: () => void;
  /** 整首是否正在播放（用来决定「是不是真的在慢练」）。 */
  isPlaying: boolean;
  /** 本节拍播放到第几个音；非空表示在慢练循环里。 */
  practicePass: number | null;
}

export function usePhrasePractice({
  score,
  currentScoreId,
  scoreTitle,
  play,
  stopPlayback,
  metronomeRunning,
  stopMetronome,
  isPlaying,
  practicePass,
}: Options) {
  // 句界由 Rust 切（与编排同一套判据），前端只提供时值。
  const scorePhrases = useScorePhrases(score);

  const [practiceTempo, setPracticeTempo] = useState(0.6);
  const [practiceIndex, setPracticeIndex] = useState<number | null>(null);
  const [practicePlay, setPracticePlay] = useState<PracticePlay | null>(null);

  /**
   * 每句练到哪一档。
   *
   * 键里带着社区 id / 曲名 / 音数：换了谱就是另一份进度，
   * 不会出现「这首的第 3 句已过原速」标在你没练过的一段音上。
   */
  const practiceProgressKey = scoreProgressKey(
    currentScoreId,
    scoreTitle,
    score.length,
  );
  const [phraseProgress, setPhraseProgress] = useState<PhraseProgress>({});
  // 渲染期读 localStorage 会让预渲染与首帧不一致，只能进 effect 读。
  // 这不是为了「少一帧」——是为了 SSR 输出与客户端首帧一致，否则水合报错。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部存储 → React 状态的同步
    setPhraseProgress(readProgress(practiceProgressKey));
  }, [practiceProgressKey]);

  /** 记一笔成绩；只升不降。无变化时返回原引用，避免多余渲染。 */
  const recordPhrase = useCallback(
    (phraseIndexSig: string, tempo: number) => {
      setPhraseProgress((prev) => {
        const next = recordTempo(prev, phraseIndexSig, tempo);
        if (next === prev) return prev;
        writeProgress(practiceProgressKey, next);
        return next;
      });
    },
    [practiceProgressKey],
  );

  /**
   * 慢练某一句：先停再播，区间 / 倍率 / 遍数一次性交给播放器。
   *
   * 倍率由调用方显式传入（句子按钮给当前档，`再快一档` 给下一档）：
   * 若在这里读 `practiceTempo` 再 `setPracticeTempo`，同一次事件里
   * 播放拿到的仍是旧值，听起来就像「按了没反应」。
   *
   * 节拍器一并停掉：它按原速走，慢练时留着只会把人往原速上带。
   * 慢练的全部意义就是「这一段手还跟不上原速」，让它跟着一个原速的
   * 滴答声去弹，等于一边踩刹车一边踩油门。
   */
  const practicePhrase = useCallback(
    (index: number, tempo: number) => {
      const phrase = scorePhrases[index];
      if (!phrase) return;
      stopPlayback();
      if (metronomeRunning) stopMetronome();
      setPracticeTempo(tempo);
      setPracticeIndex(index);
      setPracticePlay({ from: index, to: index, tempo, repeat: PRACTICE_REPEATS });
      play(phrase.start, {
        endIndex: phrase.end,
        repeat: PRACTICE_REPEATS,
        tempo,
      });
    },
    [scorePhrases, stopPlayback, metronomeRunning, stopMetronome, play],
  );

  /**
   * 卡点句：练过但还没到原速的句子，最慢的排前面。
   * 喂给日课面板——「哪句卡着」是周/月汇总答不出来的，它只回答「练了多久」。
   */
  const sticking = useMemo(
    () => stickingPoints(scorePhrases.map(phraseKey), phraseProgress),
    [scorePhrases, phraseProgress],
  );

  /**
   * 从日课点「练这句」：档位接着它自己的最好成绩走，不硬塞面板上选的档。
   * 刚到 0.6× 的句子直接按 0.8× 起步，多半一上来就垮，反而打击人。
   * 还没成绩的句子才退回当前选的档位。
   */
  const practiceSticking = useCallback(
    (index: number) => {
      const phrase = scorePhrases[index];
      const best = phrase ? (phraseProgress[phraseKey(phrase)] ?? 0) : 0;
      practicePhrase(index, best > 0 ? best : practiceTempo);
    },
    [scorePhrases, phraseProgress, practiceTempo, practicePhrase],
  );

  /**
   * 合练：把刚练过那句和相邻那句连着走两遍。
   *
   * 分句是为了拆开练，拆完必须合回去——单句练习的区间首尾都被切掉了，
   * 所以「上一句收尾 → 下一句起手」这一下，在单句里永远练不到。
   *
   * 档位取两句里更慢的那句：快的那句等一等，慢的那句不追。
   */
  const practiceJoin = useCallback(() => {
    const range =
      practiceIndex !== null ? joinRange(scorePhrases, practiceIndex) : null;
    if (!range) return;
    const first = scorePhrases[range.from];
    const last = scorePhrases[range.to];
    if (!first || !last) return;
    const tempo = joinTempo(
      phraseProgress[phraseKey(first)] ?? 0,
      phraseProgress[phraseKey(last)] ?? 0,
      practiceTempo,
    );
    stopPlayback();
    if (metronomeRunning) stopMetronome();
    setPracticePlay({
      from: range.from,
      to: range.to,
      tempo,
      repeat: JOIN_REPEATS,
    });
    play(range.start, {
      endIndex: range.end,
      repeat: JOIN_REPEATS,
      tempo,
    });
  }, [
    practiceIndex,
    scorePhrases,
    phraseProgress,
    practiceTempo,
    stopPlayback,
    metronomeRunning,
    stopMetronome,
    play,
  ]);

  const stopPractice = useCallback(() => {
    stopPlayback();
    setPracticeIndex(null);
    setPracticePlay(null);
  }, [stopPlayback]);

  /**
   * 三遍真的走完才记一笔。
   *
   * 记的是「这次练到的那一档」，不是「已过关」——过没过是读的时候用
   * `isCleared` 算的。两件事分开，才不会被一句没走完的练习骗过去。
   *
   * 合练（两句连着走）**不会**虚报成绩，靠的是两件事实而不是一个 if：
   * ① 合练档位取两句里更慢的那句（`joinTempo`），所以它永远不高于任一句的
   *    已有成绩，`recordTempo` 的「只升不降」在这里天然写不进东西；
   * ② 记的是**实际走的那一档**（`practicePlay.tempo`），不是手边拨到的档。
   * 少任何一条都会冒出「合练一遍就过关」的假横线，所以这两条各有用例守着。
   */
  const handlePracticeEnd = useCallback(() => {
    if (practiceIndex === null) return;
    const phrase = scorePhrases[practiceIndex];
    if (!phrase) return;
    const usedTempo = practicePlay?.tempo ?? practiceTempo;
    recordPhrase(phraseKey(phrase), usedTempo);
  }, [practicePlay, practiceIndex, scorePhrases, practiceTempo, recordPhrase]);

  /**
   * 跟弹判定通过：记这一句练到的档位。
   *
   * 只有一处与慢练那条路不同：慢练记「实际走的那一档」（可能被合练改过），
   * 判定记的就是面板上选的那一档。但「只升不降」必须一致——否则判定一遍 0.6
   * 会把已经练到 0.9 的句子打回 0.6，谱面上那根朱砂线会往回缩。
   */
  const handleFollowPass = useCallback(
    (tempo: number) => {
      if (practiceIndex === null) return;
      const phrase = scorePhrases[practiceIndex];
      if (!phrase) return;
      recordPhrase(phraseKey(phrase), tempo);
    },
    [practiceIndex, scorePhrases, recordPhrase],
  );

  // 只有「正在慢练」才高亮：整首播放时若也高亮，用户会以为在循环某一句
  const activePractice = isPlaying && practicePass != null ? practicePlay : null;
  const activePracticeIndex = activePractice?.from ?? null;
  // 合练才给「到哪一句」：单句时 from === to，没必要让组件再判一次
  const activeJoinTo =
    activePractice && activePractice.to > activePractice.from
      ? activePractice.to
      : null;

  return {
    // 派生数据
    scorePhrases,
    sticking,
    activePractice,
    activePracticeIndex,
    activeJoinTo,
    practiceProgressKey,
    // 状态
    practiceTempo,
    setPracticeTempo,
    practiceIndex,
    setPracticeIndex,
    practicePlay,
    phraseProgress,
    setPhraseProgress,
    // 动作
    practicePhrase,
    practiceSticking,
    practiceJoin,
    stopPractice,
    handlePracticeEnd,
    handleFollowPass,
  };
}
