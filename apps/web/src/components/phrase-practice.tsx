"use client";

import {
  describePhrase,
  joinRange,
  phraseKey,
  type ScorePhrase,
} from "@/lib/score-phrases";
import {
  TEMPO_LADDER,
  clearedCount,
  isCleared,
  nextTempo,
  nextUnclearedIndex,
  type PhraseProgress,
} from "@/lib/practice-progress";

/** 新起一句从哪一档开始：没练过的地方，别拿已经练熟的速度去试。 */
const FIRST_TEMPO = 0.6;

/**
 * 逐句慢练 —— 谱面下面的一条句子选择条。
 *
 * 只在**两句以上**时出现：一整段就是一句的短曲没有「选哪句」这回事，
 * 摆一排只有一个按钮的句子条，用户会以为按钮坏了。
 *
 * 三行各有各的职责，不要合并：
 * 1. 句子 + 每句的进度点：告诉你**今天还差哪几句**；
 * 2. 档位：告诉你多快（等距 0.1，`再快一档` 才永远指同一件事）；
 * 3. 状态与唯一的下一步动作：练完三遍不用自己找按钮，「再快一档」就在眼前。
 *
 * 旁边那个「2+3 连着」是唯一的**次要**动作，样式压过一头：分句练是为了拆开，
 * 拆开练完必须合回去——不然你只会一句一句地弹，一到气口就断，而那个断裂
 * 恰好在单句练习里永远练不到（区间首尾都被切掉了）。
 */
export function PhrasePractice({
  phrases,
  bpm,
  tempo,
  activeIndex,
  selectedIndex,
  pass,
  repeat,
  progress,
  joinTo,
  joinedTempo,
  onTempoChange,
  onStart,
  onStop,
  onJoin,
}: {
  phrases: ScorePhrase[];
  /** 当前速度，用来把拍数说成秒数。 */
  bpm: number;
  /** 当前选中的档位。 */
  tempo: number;
  /** 正在播第几句（0 起）；没在播为 null。合练时是区间的**头**一句。 */
  activeIndex: number | null;
  /** 合练时区间到第几句（0 起，一定 ≥ `activeIndex`）；单句慢练为 null。 */
  joinTo: number | null;
  /** 合练实际用的档位（两句里更慢的那句）；单句慢练为 null。 */
  joinedTempo: number | null;
  /** 最近练过的那一句；决定「再快一档」练的是哪句。 */
  selectedIndex: number | null;
  /** 已经进行到第几遍（1 起）；没在练为 null。 */
  pass: number | null;
  /** 一共连弹几遍。 */
  repeat: number;
  /** 每句的最好成绩（倍率），键由 `phraseKey` 给出。 */
  progress: PhraseProgress;
  onTempoChange: (tempo: number) => void;
  onStart: (index: number, tempo: number) => void;
  onStop: () => void;
  /** 合练：把最近练过那句和相邻那句连着走。 */
  onJoin: () => void;
}) {
  // 一句及以下不显示：整首播放按钮已经在上面，再给一个「只播这一句」是噪声
  if (phrases.length < 2) return null;

  const keys = phrases.map(phraseKey);
  const cleared = clearedCount(keys, progress);
  const target = selectedIndex !== null ? phrases[selectedIndex] : undefined;
  const targetBest = target ? (progress[phraseKey(target)] ?? 0) : 0;
  const playing = activeIndex !== null && pass !== null;

  // 合练区间：最近练过那句 + 相邻那句。练过一遍以上才给——一次都没走完的音，
  // 先合起来只会把「不会」和「接不上」混成一件说不清的事。
  const joined = selectedIndex !== null ? joinRange(phrases, selectedIndex) : null;
  const canJoin = joined !== null && !playing && targetBest > 0;

  let status: string;
  let action: { label: string; onClick: () => void } | null = null;

  if (playing && activeIndex !== null) {
    const phrase = phrases[activeIndex];
    if (joinTo !== null) {
      // 合练时说「这两句一共多少位置」，而不是只报头一句——用户听到的是两段。
      const span = phrases
        .slice(activeIndex, joinTo + 1)
        .reduce((sum, p) => sum + p.noteCount, 0);
      status = `第 ${activeIndex + 1}+${joinTo + 1} 句 · ${span} 个位置 · ${joinedTempo ?? tempo}× · 第 ${pass}/${repeat} 遍`;
    } else {
      status = `第 ${activeIndex + 1} 句 · ${phrase.noteCount} 个位置 · 第 ${pass}/${repeat} 遍`;
    }
  } else if (target && selectedIndex !== null && isCleared(targetBest)) {
    const nextIdx = nextUnclearedIndex(keys, progress);
    status =
      nextIdx === null
        ? `第 ${selectedIndex + 1} 句已到原速 · 全曲都过了`
        : `第 ${selectedIndex + 1} 句已到原速`;
    if (nextIdx !== null) {
      action = {
        label: `接着练第 ${nextIdx + 1} 句`,
        onClick: () => onStart(nextIdx, FIRST_TEMPO),
      };
    }
  } else if (target && selectedIndex !== null && targetBest > 0) {
    // 从**记录**往上加，不是从当前选中的档位往上加：
    // 手滑把档位拨回 0.6，按「再快一档」不该退回去重练已经过了的 0.7。
    const up = nextTempo(targetBest);
    status = `第 ${selectedIndex + 1} 句练到 ${targetBest}×`;
    if (up !== null) {
      status += `，再快一档 ${up}×`;
      action = { label: "再快一档", onClick: () => onStart(selectedIndex, up) };
    }
  } else if (target && selectedIndex !== null) {
    status = `第 ${selectedIndex + 1} 句还没走完一遍——再点一次它`;
  } else {
    status = `点一句慢练：${tempo}× 连弹 ${repeat} 遍，起手前空两拍`;
  }

  return (
    <div className="no-print mt-2 w-full max-w-md flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] tracking-wider text-amber-600/50">
          分句
        </span>
        {phrases.map((phrase, index) => {
          // 合练时区间的两句都在响，就都点亮：只亮头一句，用户会以为后一句没放出来。
          const isActive =
            activeIndex !== null &&
            index >= activeIndex &&
            index <= (joinTo ?? activeIndex);
          const isSelected = selectedIndex === index;
          const best = progress[phraseKey(phrase)] ?? 0;
          const passed = isCleared(best);
          return (
            <button
              key={`${phrase.start}-${phrase.end}`}
              onClick={() => (isActive ? onStop() : onStart(index, tempo))}
              aria-pressed={isActive}
              aria-label={
                isActive
                  ? `停止慢练第 ${index + 1} 句`
                  : passed
                    ? `慢练第 ${index + 1} 句 · 已过原速`
                    : `慢练第 ${index + 1} 句`
              }
              title={describePhrase(phrase, index, bpm, tempo)}
              className={`min-h-[44px] min-w-[44px] px-2 rounded border text-[10px] tabular-nums tracking-wider transition-all ${
                isActive
                  ? "border-amber-500/60 bg-amber-800/30 text-amber-100"
                  : isSelected
                    ? "border-amber-600/45 text-stone-300"
                    : "border-amber-700/25 text-stone-500 hover:text-stone-300 hover:border-amber-600/50"
              }`}
            >
              {index + 1}
              {/* 一条 3px 的横线代替对勾：44px 的格子里再塞「✓」会挤掉数字本身 */}
              <span
                aria-hidden
                className={`mx-auto mt-0.5 block h-[3px] w-3 rounded-full ${
                  passed
                    ? "bg-[var(--vermillion)]"
                    : best > 0
                      ? "bg-amber-500/50"
                      : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
        {cleared > 0 && (
          <span className="ml-auto text-[10px] tabular-nums tracking-wider text-amber-600/60">
            已过 {cleared}/{phrases.length}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] tracking-wider text-amber-600/50">
          倍数
        </span>
        {TEMPO_LADDER.map((t) => (
          <button
            key={t}
            onClick={() => onTempoChange(t)}
            aria-pressed={tempo === t}
            aria-label={`慢练倍速 ${t}×`}
            className={`min-h-[44px] px-2 rounded border text-[10px] tabular-nums tracking-wider transition-all ${
              tempo === t
                ? "border-amber-600/60 bg-amber-700/25 text-amber-100"
                : "border-amber-700/20 text-stone-500 hover:border-amber-600/50 hover:text-stone-300"
            }`}
          >
            {t}×
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[10px] tracking-wider text-amber-600/50">
          {status}
        </span>
        {action && (
          <button
            onClick={action.onClick}
            className="shrink-0 min-h-[44px] px-2.5 rounded border border-amber-600/50 bg-amber-800/20 text-[10px] tracking-wider text-amber-100 hover:bg-amber-800/35"
          >
            {action.label}
          </button>
        )}
        {canJoin && joined && (
          <button
            onClick={onJoin}
            aria-label={`连弹第 ${joined.from + 1}+${joined.to + 1} 句`}
            title={`把第 ${joined.from + 1}、${joined.to + 1} 句连着走一遍，跨过中间那个气口——分句练会的那两句，合起来才算会`}
            className="shrink-0 min-h-[44px] px-2.5 rounded border border-amber-700/25 text-[10px] tabular-nums tracking-wider text-stone-400 hover:text-stone-200 hover:border-amber-600/50 transition-all"
          >
            {joined.from + 1}+{joined.to + 1} 连着
          </button>
        )}
      </div>
    </div>
  );
}
