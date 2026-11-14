/*
 * 字形家底的「唯一真相源」：统计逻辑 + 对外期望值。
 *
 * 为什么单独成模块（2026-11-14）：CLI（scripts/inventory-glyphs.ts）要给人跑出表格，
 * CI 闸门（src/lib/glyph-inventory.test.ts）要 import 同一份断言。两边各写一份就又会漂移——
 * 之前正是「脚本没接进 CI」，部件表 45→77 改了却没人发现（team-healthcheck.md D-7）。
 * 本模块必须无副作用：不打印、不 process.exit，才能被 vitest 直接 import。
 *
 * 放在 scripts/ 而不是 src/lib/：不进 vitest coverage 的 include 口径，
 * 避免把一个校验工具算进业务代码覆盖率（阈值 94/91/84/92 不为它调整）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { SVG_PATHS } from "../src/lib/svg-paths";
import { EXAMPLE_SCORES } from "../src/lib/example-scores";
import { rightActionInfo, leftFingerInfo } from "../src/lib/jianzi-explain";
import type { JianziState } from "../src/lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FONT = resolve(HERE, "../public/fonts/WangJiJianZiPuKaiTi.ttf");

/**
 * 对外文档里的数字，改字体 / svg-paths / 示例谱后必须同步这里与下列出处：
 * - fontGlyphs / svgParts：overview.md:318、competitive-analysis.md:13,1695、pitch.md:163,222
 * - distinctGlyphs / scoreCount：overview.md:318「实测减字 27」、
 *   pitch.md「内置 4 首谱加起来只用到 27 个不同的减字」
 * noteCount 只做诊断打印、不设阈值：它没写进对外材料，别让闸门为一个内部数字吵。
 */
export const EXPECTED_GLYPH_INVENTORY = {
  fontGlyphs: 471,
  svgParts: 77,
  distinctGlyphs: 27,
  scoreCount: 4,
} as const;

export interface GlyphInventory {
  fontGlyphs: number;
  svgParts: number;
  svgGroups: Record<string, number>;
  scoreCount: number;
  noteCount: number;
  distinctGlyphs: number;
}

/** 只钉「写进了对外文档」的四项；noteCount 与分组明细是诊断信息。 */
type Expected = Pick<
  GlyphInventory,
  "fontGlyphs" | "svgParts" | "distinctGlyphs" | "scoreCount"
>;

/** 读 TTF 的 maxp.numGlyphs。不引第三方字体库：只要这一个字段。 */
function countFontGlyphs(path: string): number {
  const buf = readFileSync(path);
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const off = 12 + i * 16;
    const tag = buf.subarray(off, off + 4).toString("latin1");
    if (tag === "maxp") {
      const tableOffset = buf.readUInt32BE(off + 8);
      return buf.readUInt16BE(tableOffset + 4);
    }
  }
  throw new Error("maxp 表不存在，字体文件可能损坏");
}

/** SVG 部件按前缀分组：fen_3 → fen，hui_10 → hui。 */
function groupByPrefix(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const prefix = key.includes("_") ? key.slice(0, key.indexOf("_")) : "(无前缀)";
    out[prefix] = (out[prefix] ?? 0) + 1;
  }
  return out;
}

/**
 * 一个减字的「身份」= 音色 + 左手 + 徽 + 分 + 走手音 + 右手 + 弦。
 * 左右手先归一（键盘存偏旁「勹」，谱本存全字「勾」），否则同一个字会被算成两个。
 */
function signature(state: JianziState): string {
  const slot = (v: string | null | undefined) => v ?? "-";
  return [
    slot(state.toneType),
    slot(leftFingerInfo(state.leftFinger)?.name ?? state.leftFinger),
    slot(state.hui),
    slot(state.fen),
    slot(state.slide),
    slot(rightActionInfo(state.rightAction)?.name ?? state.rightAction),
    slot(state.stringNumber),
  ].join("|");
}

/** 现场统计：读真实字体 + 真实源码表，不接受调用方传入的数字。 */
export function collectGlyphInventory(fontPath: string = DEFAULT_FONT): GlyphInventory {
  const fontGlyphs = countFontGlyphs(fontPath);
  const svgKeys = Object.keys(SVG_PATHS);
  const svgGroups = groupByPrefix(svgKeys);

  const signatures = new Set<string>();
  let noteCount = 0;
  for (const score of EXAMPLE_SCORES) {
    for (const note of score.notes) {
      noteCount += 1;
      signatures.add(signature(note.jianzi));
    }
  }

  return {
    fontGlyphs,
    svgParts: svgKeys.length,
    svgGroups,
    scoreCount: EXAMPLE_SCORES.length,
    noteCount,
    distinctGlyphs: signatures.size,
  };
}

/**
 * 返回漂移说明列表；空数组 = 与对外数字一致。
 * 单独导出是为了让测试能做变异验证：证明闸门真会红，而不是恒返回 []。
 */
export function checkGlyphInventory(
  inventory: GlyphInventory,
  expected: Expected = EXPECTED_GLYPH_INVENTORY,
): string[] {
  const errors: string[] = [];
  const checks: Array<[keyof Expected, string]> = [
    ["fontGlyphs", "字体字形数"],
    ["svgParts", "SVG 部件数"],
    ["distinctGlyphs", "示例谱不同减字数"],
    ["scoreCount", "示例谱曲数"],
  ];
  for (const [key, label] of checks) {
    if (inventory[key] !== expected[key]) {
      errors.push(`${label}漂移：期望 ${expected[key]}，实际 ${inventory[key]}`);
    }
  }
  return errors;
}
