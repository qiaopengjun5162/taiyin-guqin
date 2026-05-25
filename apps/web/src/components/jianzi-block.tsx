"use client";

import type { JianziState } from "@/lib/types";
import { jianziToText } from "@/lib/types";
import { SvgJianziBlock } from "./svg-jianzi-block";

const JIANZI_FONT = '"TaiYinJianZiPuKaiTi", "KaiTi", "STKaiti", "Ma Shan Zheng", "Noto Serif SC", serif';

/** 降级到 SVG 渲染的触发条件（字体 GSUB 无法正确处理的情况）。 */
function needsSvg(state: JianziState): boolean {
  const ra = state.rightAction ?? "";
  return (
    state.toneType === "泛" ||
    ["打", "摘", "丁", "倽"].includes(ra)
  );
}

/**
 * 减字块 —— 渐进式混合渲染引擎。
 *
 * 第一层 FontJianziBlock：纯字体 GSUB 连字方案（80% 常用字）。
 *   - 忘机减字谱楷体本质是 OpenType GSUB 连字引擎
 *   - 输入完整字符串（如"大九勾五"），字体自动完成传统半包围嵌套排版
 *
 * 第二层 SvgJianziBlock：SVG 积木四象限矩阵（20% 生僻组合）。
 *   - 降级条件：泛音（空格阻断 GSUB 链）| 打/摘（字体拆分问题）
 *   - 使用从字体提取的 SVG path 积木手动装配布局
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
  // SVG 降级分支
  if (needsSvg(state)) {
    return <SvgJianziBlock state={state} fontSize={fontSize} compact={compact} />;
  }

  // 字体 GSUB 分支（默认，处理 80% 常用组合）
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
