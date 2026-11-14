/*
 * 字形家底闸门（CI）。
 *
 * 背景：apps/web/scripts/inventory-glyphs.ts 曾是个「没接 CI 的哨兵」——
 * svg-paths 从 45 涨到 77 时脚本 exit 1，却因为没人跑而无人发现
 * （docs/team-healthcheck.md D-7）。本测试让同一份统计逻辑进入
 * `pnpm --filter web test`：改了字体 / 字形表 / 示例谱却没同步
 * EXPECTED_GLYPH_INVENTORY 与对外文档，CI 立刻红。
 *
 * 放在 src/ 下是 vitest.config.ts 的 include 要求（匹配 src 里所有 *.test.ts 文件）；
 * 被 import 的 scripts/glyph-inventory.ts 不在 coverage include 口径内，不影响阈值。
 * 块注释里不能出现「星号紧跟斜杠」的字符组合，否则会提前闭合注释导致 PARSE_ERROR。
 */
import { describe, expect, it } from "vitest";

import {
  EXPECTED_GLYPH_INVENTORY,
  checkGlyphInventory,
  collectGlyphInventory,
} from "../../scripts/glyph-inventory";

type Inventory = Parameters<typeof checkGlyphInventory>[0];

const inventory = collectGlyphInventory();

describe("字形家底闸门", () => {
  it("统计来自真实字体与源码，且各项非空（排除环境缺失造成的假绿）", () => {
    // 人工检查出口：跑这个单文件就能抄到数字，不必依赖需要联网下载的 npx jiti。
    // 放在断言前，即使发生了漂移也能先看到真实值。
    console.log(
      [
        "── 字形家底（现场统计）──",
        `字体字形  ${inventory.fontGlyphs}`,
        `SVG 部件  ${inventory.svgParts}  ${Object.entries(inventory.svgGroups)
          .map(([k, v]) => `${k}:${v}`)
          .join("  ")}`,
        `示例谱    ${inventory.scoreCount} 首 / ${inventory.noteCount} 个音`,
        `不同减字  ${inventory.distinctGlyphs} 个`,
      ].join("\n"),
    );

    expect(inventory.fontGlyphs).toBeGreaterThan(0);
    expect(inventory.svgParts).toBeGreaterThan(0);
    expect(inventory.scoreCount).toBeGreaterThan(0);
    expect(inventory.noteCount).toBeGreaterThan(0);
    expect(inventory.distinctGlyphs).toBeGreaterThan(0);
  });

  it("四项对外数字与真实存量一致", () => {
    expect(inventory.fontGlyphs).toBe(EXPECTED_GLYPH_INVENTORY.fontGlyphs);
    expect(inventory.svgParts).toBe(EXPECTED_GLYPH_INVENTORY.svgParts);
    expect(inventory.distinctGlyphs).toBe(EXPECTED_GLYPH_INVENTORY.distinctGlyphs);
    expect(inventory.scoreCount).toBe(EXPECTED_GLYPH_INVENTORY.scoreCount);
    expect(checkGlyphInventory(inventory)).toEqual([]);
  });

  it("分组数之和等于部件总数（分组逻辑不许漂移）", () => {
    const sum = Object.values(inventory.svgGroups).reduce((a, b) => a + b, 0);
    expect(sum).toBe(inventory.svgParts);
  });

  // 变异验证：逐项把数字改错 1，证明闸门真能抓到漂移，而不是恒返回 []。
  // 断言具体错误文本与条数，避免「解析崩溃 / 环境缺失」被误当成「抓到了」。
  it("变异：四项对外数字各错 1 都能被抓到，且错误文本明确", () => {
    const cases: Array<[keyof typeof EXPECTED_GLYPH_INVENTORY, RegExp]> = [
      ["fontGlyphs", /字体字形数漂移/],
      ["svgParts", /SVG 部件数漂移/],
      ["distinctGlyphs", /示例谱不同减字数漂移/],
      ["scoreCount", /示例谱曲数漂移/],
    ];
    for (const [key, pattern] of cases) {
      const drifted = { ...inventory, [key]: inventory[key] + 1 } as Inventory;
      const errors = checkGlyphInventory(drifted);
      expect(errors, `字段 ${key} 漂移未被抓到`).toHaveLength(1);
      expect(errors[0]).toMatch(pattern);
    }
  });
});
