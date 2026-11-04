"use client";

import { describePhrase, type ScorePhrase } from "@/lib/score-phrases";

/** 慢练倍率：0.6 是「慢到能想清楚下一个动作」，0.75 是「差不多能连上」。 */
const TEMPOS = [0.6, 0.75] as const;

/**
 * 逐句慢练 —— 谱面下面的一条句子选择条。
 *
 * 只在**两句以上**时出现：一整段就是一句的短曲没有「选哪句」这回事，
 * 摆一排只有一个按钮的句子条，用户会以为按钮坏了。
 *
 * 点一句就按当前倍率连弹三遍，每遍之间空一拍。三遍是刻意的：
 * 一遍是「听」，两遍是「跟」，三遍才轮到「记住」；再多就该自己按停止，
 * 而不是让程序替他决定还要练多久。
 */
export function PhrasePractice({
  phrases,
  bpm,
  tempo,
  activeIndex,
  pass,
  repeat,
  onTempoChange,
  onStart,
  onStop,
}: {
  phrases: ScorePhrase[];
  /** 当前速度，用来把拍数说成秒数。 */
  bpm: number;
  tempo: number;
  /** 正在慢练第几句（0 起）；没在练为 null。 */
  activeIndex: number | null;
  /** 已经进行到第几遍（1 起）；没在练为 null。 */
  pass: number | null;
  /** 一共连弹几遍。 */
  repeat: number;
  onTempoChange: (tempo: number) => void;
  onStart: (index: number) => void;
  onStop: () => void;
}) {
  // 一句及以下不显示：整首播放按钮已经在上面，再给一个「只播这一句」是噪声
  if (phrases.length < 2) return null;

  const active = activeIndex !== null ? phrases[activeIndex] : undefined;

  return (
    <div className="no-print mt-2 w-full max-w-md flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] tracking-wider text-amber-600/50">
          分句
        </span>
        {phrases.map((phrase, index) => {
          const isActive = activeIndex === index;
          return (
            <button
              key={`${phrase.start}-${phrase.end}`}
              onClick={() => (isActive ? onStop() : onStart(index))}
              aria-pressed={isActive}
              aria-label={isActive ? `停止慢练第 ${index + 1} 句` : `慢练第 ${index + 1} 句`}
              title={describePhrase(phrase, index, bpm, tempo)}
              className={`min-h-[44px] min-w-[44px] px-2 rounded border text-[10px] tabular-nums tracking-wider transition-all ${
                isActive
                  ? "border-amber-500/60 bg-amber-800/30 text-amber-100"
                  : "border-amber-700/25 text-stone-500 hover:text-stone-300 hover:border-amber-600/50"
              }`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] tracking-wider text-amber-600/50">
          倍数
        </span>
        {TEMPOS.map((t) => (
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
        <span className="min-w-0 flex-1 truncate text-[10px] tracking-wider text-amber-600/50">
          {active && pass !== null
            ? `第 ${(activeIndex ?? 0) + 1} 句 · ${active.noteCount} 个位置 · 第 ${pass}/${repeat} 遍`
            : `点一句慢练：${tempo}× 连弹 ${repeat} 遍，每遍之间空一拍`}
        </span>
      </div>
    </div>
  );
}
