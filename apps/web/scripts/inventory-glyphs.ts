/*
 * 减字字形的家底统计（可复跑，退出码闸门）。
 *
 * 为什么要有这个脚本：我们对外的说法里最容易翻车的一句是「字库很全」。
 * 包松平 2015 年的输入法自述「基础指法减字近 1500 个（含异体字与上古声曲折谱符），
 * 组合输出数百万字，已基本覆盖《琴曲集成》全 30 册」——而我们从来没数过自己有多少。
 * 「理论上部件可无限组合」是架构话术，不是答案；能拿出去比的是**数出来的数字**。
 *
 * 统计三项（都是可复现的事实，不含推测）：
 *   1. 字体字形数：WangJiJianZiPuKaiTi.ttf 的 maxp.numGlyphs（含部件、汉字、符号）
 *   2. SVG 降级部件：SVG_PATHS 的条目数，按前缀（fen_/hui_/…）分组
 *   3. 示例谱用到的不同减字：按字段签名去重后的个数
 *
 * 用法：cd apps/web && npx jiti scripts/inventory-glyphs.ts
 * 退出码：0 = 数字与 EXPECTED 一致；1 = 漂移（改过字体/字形/示例谱就要同步这里）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { SVG_PATHS } from "../src/lib/svg-paths";
import { EXAMPLE_SCORES } from "../src/lib/example-scores";
import { rightActionInfo, leftFingerInfo } from "../src/lib/jianzi-explain";
import type { JianziState } from "../src/lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT = resolve(HERE, "../public/fonts/WangJiJianZiPuKaiTi.ttf");

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
 * 左右手要先归一（键盘存偏旁「勹」，谱本存全字「勾」），否则同一个字会被算成两个。
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

const fontGlyphs = countFontGlyphs(FONT);
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

console.log("── 字形家底 ──");
console.log(`字体字形（maxp.numGlyphs）   ${fontGlyphs}`);
console.log(`SVG 降级部件                 ${svgKeys.length}`);
console.log(
  `  分组                       ${Object.entries(svgGroups)
    .map(([k, v]) => `${k}:${v}`)
    .join("  ")}`,
);
console.log(`示例谱                        ${EXAMPLE_SCORES.length} 首 / ${noteCount} 个音`);
console.log(`示例谱里不同的减字            ${signatures.size} 个`);

/*
 * 闸门：这三个数一旦变动就说明有人改了字体/字形表/示例谱，
 * 而文档（competitive-analysis 二十章、pitch 4.3）里的数字会跟着过期。
 * 改了就同步改这里，别让「对外数字」和「实际存量」各说各的。
 */
const EXPECTED = { fontGlyphs: 471, svgParts: 77 };

let failed = false;
if (fontGlyphs !== EXPECTED.fontGlyphs) {
  console.error(`✗ 字体字形数漂移：期望 ${EXPECTED.fontGlyphs}，实际 ${fontGlyphs}`);
  failed = true;
}
if (svgKeys.length !== EXPECTED.svgParts) {
  console.error(`✗ SVG 部件数漂移：期望 ${EXPECTED.svgParts}，实际 ${svgKeys.length}`);
  failed = true;
}
if (!failed) console.log("\n✓ 与文档里的数字一致");

process.exit(failed ? 1 : 0);
