"use client";

import type { JianziState } from "@/lib/types";
import { explainJianzi } from "@/lib/jianzi-explain";
import { usePitchContext } from "@/lib/use-pitch-context";
import { QinFingeringDiagram } from "./qin-fingering-diagram";
import { JianziConcordance } from "./jianzi-concordance";

/**
 * 减字释义面板 —— 把正在拼的谱字翻成人话。
 *
 * 位置在预览框正下方：拼到一半就告诉你还缺什么，拼完了就告诉你
 * 这一字怎么弹。宣纸浅底，文字统一用深墨色（浅底浅字在此处几乎不可读）。
 */
export function JianziExplainPanel({ state }: { state: JianziState }) {
  // 定弦或基准音一改，释义里的音高要跟着变，不能停在打开面板那一刻
  const { tuning, concertPitch } = usePitchContext();
  const explanation = explainJianzi(state, { tuning, concertPitch });
  if (explanation.parts.length === 0) return null;

  return (
    <div className="w-full rounded border border-amber-800/15 bg-amber-900/[0.04] px-3 py-2.5">
      {explanation.complete ? (
        <p className="text-[12px] leading-relaxed tracking-wide text-stone-800">
          <span className="mr-1.5 text-[10px] tracking-[0.2em] text-amber-800/60">读作</span>
          {explanation.summary}
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed tracking-wide text-stone-600">
          <span className="mr-1.5 text-[10px] tracking-[0.2em] text-amber-800/60">待补</span>
          还缺{explanation.missing.join("、")}
        </p>
      )}

      <dl className="mt-2 grid grid-cols-1 gap-y-1">
        {explanation.parts.map((part) => (
          <div key={part.label} className="flex gap-2 text-[11px] leading-relaxed">
            {/*
             * 标签宽度不能写死。原先用 `w-8`（32px）——12px 字号时刚好装下两字，
             * 2026-11-18 正文提到 14px 后「音色」被挤成上下两行（「音」上「色」下）。
             * 改成「最小 2em + 不换行」：宽度跟着字号自动走，对齐也保住了。
             */}
            <dt className="min-w-[2em] shrink-0 whitespace-nowrap tracking-[0.15em] text-amber-800/60">
              {part.label}
            </dt>
            <dd className="text-stone-700">{part.text}</dd>
          </div>
        ))}
      </dl>

      {/* 会说还得会看：文字说的是「四弦九徽六分」，图上是那一点落在哪儿 */}
      <QinFingeringDiagram state={state} />

      {/* 会看还要知道它在哪儿用过：这一字在曲库里的谱例，点一下当场试听 */}
      {explanation.complete && <JianziConcordance state={state} />}

      {explanation.pitchHint && (
        <p className="mt-1.5 border-t border-amber-800/10 pt-1.5 text-[10px] tracking-wider text-stone-500">
          {explanation.pitchHint}
        </p>
      )}
    </div>
  );
}
