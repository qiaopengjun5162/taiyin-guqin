"use client";

import type { JianziState } from "@/lib/types";
import { jianziToText } from "@/lib/types";

const JIANZI_FONT = '"TaiYinJianZiPuKaiTi", "KaiTi", "STKaiti", "Ma Shan Zheng", "Noto Serif SC", serif';

/**
 * 减字块 —— 纯字体连字方案。
 *
 * 忘机减字谱楷体本质是一个 OpenType GSUB 连字引擎。
 * 输入完整字符串（如"大九勾四"），字体自动通过 26 个 GSUB lookup
 * 完成传统半包围嵌套排版，无需任何 CSS 定位 hack。
 */
export function JianziBlock({
  state,
  fontSize = "36px",
  compact,
}: {
  state: JianziState;
  fontSize?: string;
  /** 紧凑模式：隐藏音色标记（用于连续同音省略） */
  compact?: boolean;
}) {
  const text = jianziToText(compact ? { ...state, toneType: null } : state);
  if (!text) return null;

  return (
    <div
      className="inline-flex items-center justify-center select-none no-underline"
      style={{
        fontFamily: JIANZI_FONT,
        fontSize: fontSize,
        color: "#1c1b1a",
        fontVariantLigatures: "common-ligatures",
        fontFeatureSettings: '"liga" on, "clig" on',
        lineHeight: 1.2,
        textDecoration: "none",
      }}
    >
      <span>{text}</span>
    </div>
  );
}
