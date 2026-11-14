/*
 * 减字字形的家底统计：打印表格 + 退出码闸门（给人手动跑的辅助工具）。
 *
 * 首选，离线可用，且与 CI 走同一条路径：
 *   cd apps/web && pnpm exec vitest run src/lib/glyph-inventory.test.ts
 *   该测试会打印同样的表格并断言四项对外数字，不需要任何额外依赖。
 *
 * 想直接跑本文件（需要 npx 能联网下载 jiti）：
 *   cd apps/web && npx jiti scripts/inventory-glyphs.ts
 *   exit 0 = 与对外数字一致；exit 1 = 漂移（改过字体 / 字形表 / 示例谱，
 *   要同步 EXPECTED_GLYPH_INVENTORY 与 overview / competitive-analysis / pitch 四处文档）。
 * 注意：jiti 不是本项目依赖，靠 npx 临时下载；无网 / CI 环境一律用上面那条。
 *
 * CI 不靠这一步：src/lib/glyph-inventory.test.ts 让 vitest 直接 import 同一份
 * collectGlyphInventory / checkGlyphInventory，随 `pnpm --filter web test` 跑，
 * 两边不会各写一份统计逻辑（2026-11-14 D-7 销项）。本文件只负责打印和退出码。
 */
import { checkGlyphInventory, collectGlyphInventory } from "./glyph-inventory";

const inventory = collectGlyphInventory();

console.log("── 字形家底 ──");
console.log(`字体字形（maxp.numGlyphs）   ${inventory.fontGlyphs}`);
console.log(`SVG 降级部件                 ${inventory.svgParts}`);
console.log(
  `  分组                       ${Object.entries(inventory.svgGroups)
    .map(([k, v]) => `${k}:${v}`)
    .join("  ")}`,
);
console.log(`示例谱                        ${inventory.scoreCount} 首 / ${inventory.noteCount} 个音`);
console.log(`示例谱里不同的减字            ${inventory.distinctGlyphs} 个`);

const errors = checkGlyphInventory(inventory);
if (errors.length > 0) {
  for (const error of errors) console.error(`✗ ${error}`);
} else {
  console.log("\n✓ 与文档里的数字一致");
}
process.exit(errors.length > 0 ? 1 : 0);
