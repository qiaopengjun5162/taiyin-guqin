"use client";

import type { JianziState } from "@/lib/types";
import { isComplete } from "@/lib/jianzi";
import { JianziBlock } from "./jianzi-block";

const SERIF_FONT = "var(--font-serif), 'Noto Serif SC', 'Songti SC', serif";

/**
 * 减字预览 —— 在宣纸质感框内展示减字块。
 *
 * ## 为什么先判完整再画（2026-11-18 实拍后改的）
 *
 * 原先只要有任意一个字段就调 `JianziBlock`，而 `jianziToText` 对不完整的字
 * 也照样拼字符串。实测：用户只点了「四弦」，预览框里就画出一个「散四」——
 * 那**不是一个存在的减字**，字体把「散」「四」硬连成一团，看起来像字但是假的。
 *
 * 用户的原话是「感觉根本不能用」，这是其中一处：界面在替用户编一个不存在的字，
 * 他既不知道自己还没打完，也不知道画出来的东西是什么。
 *
 * 现在：完整的字才画；不完整的显示「还缺 X、Y」，指路而不编造。
 * 这是「宁可说未完成，也不画假字」。
 */
export function JianzipuPreview({ state }: { state: JianziState }) {
  const complete = isComplete(state);

  return (
    <div className="flex items-center justify-center">
      <div className="relative p-2 rounded-sm bg-gradient-to-br from-amber-100 to-amber-50 shadow-inner shadow-amber-900/10">
        {/* 外框 */}
        <div
          className="relative w-28 h-32 border border-amber-700/30 bg-[#f8f3eb] flex items-center justify-center"
          style={{ fontFamily: SERIF_FONT }}
        >
          {/* ── 外侧标签（音色/节奏） ── */}
          <div className="absolute -top-3.5 left-0 flex gap-2 text-[10px] leading-none tracking-widest text-amber-600/50 select-none">
            <span>{state.toneType ?? ""}</span>
            <span>{state.rhythmMode ?? ""}</span>
          </div>

          {complete ? (
            /* 完整的字才画——不完整的会被字体连成一个不存在的假字 */
            <JianziBlock state={state} />
          ) : (
            /*
             * 未完成：这里只显示「几 / 几」的进度感，不复述缺哪个字段。
             *
             * 键盘底部已经有一句「还需要：点下面的「右手」「弦序」」——
             * 那才是可执行的指引。早先两处都写「还缺 X、Y」，
             * 同一句话在一屏里出现两次，既啰嗦又让人以为哪里出错了（实拍确认）。
             */
            <div className="px-2 text-center">
              <span className="text-[11px] leading-relaxed tracking-wider text-amber-600/50">
                未完成
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

