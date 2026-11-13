"use client";

import type { JianziState } from "@/lib/types";
import { jianziToText } from "@/lib/jianzi";
import { SvgJianziBlock } from "./svg-jianzi-block";

const JIANZI_FONT = '"WangJiJianZiPuKaiTi", "KaiTi", "STKaiti", "Ma Shan Zheng", "Noto Serif SC", serif';

/** 降级到 SVG 渲染的触发条件（字体 GSUB 无法正确处理的情况）。 */
function needsSvg(state: JianziState): boolean {
  const ra = state.rightAction ?? "";
  const hui = state.hui ?? "";
  return (
    state.toneType === "泛" ||
    ["打", "摘", "丁", "倽"].includes(ra) ||
    // 十一～十三徽是两字徽位。字体能把「十三」排进右上象限，但再接一位
    // 分数时会把分数甩到左下角（实测「大十三六勾四」的「六」跑到「大」下方），
    // 记成别的音位。这类组合交给 SVG 积木：位置由槽位决定，不看连字规则。
    (hui.length > 1 && state.fen !== null) ||
    // 「抹」+ 装饰记号字体没有对应连字（实测「大九六绰抹四」「大九六急抹四」
    // 都散成 1.5em），而「抹」单独用是好的——所以只在这个组合下降级，别一刀切。
    // 注意用 Boolean()：旧存档里 slide 字段整个不存在（undefined），
    // 写成 `!== null` 会把所有老谱子误判成有走手音、统统降级成 SVG。
    (Boolean(state.slide) && (ra === "抹" || ra === "木"))
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

/**
 * 谱面结构记号徽章——独立于减字四宫格的谱面层标记（少息/大息/再作/从头再作/入拍）。
 *
 * 字体直渲：忘机字体里有专属 `sm_*` 字形（sm_shaoxi 等），输入纯文本即触发 GSUB 合成，
 * 不需要 SVG 四象限提取（已用 measure-jianzi-block 量过：0.5~1.0em 紧凑真身，非占位框）。
 * 渲染在减字块下方作为小注释，琥珀色与减字区分。
 */
export function StructureMarkBadge({
  mark,
  size = "16px",
}: {
  mark: string;
  size?: string;
}) {
  return (
    <span
      data-structure-mark={mark}
      className="inline-block select-none leading-none"
      style={{
        fontFamily: JIANZI_FONT,
        fontSize: size,
        color: "#b45309",
        fontVariantLigatures: "common-ligatures",
        fontFeatureSettings: '"liga" on, "clig" on',
      }}
    >
      {mark}
    </span>
  );
}
