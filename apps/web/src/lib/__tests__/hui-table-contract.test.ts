/**
 * @vitest-environment node
 *
 * 科普页的十三徽比例必须与功能实现一致。
 *
 * ## 为什么值得一条测试
 *
 * 科普页 `/jianzipu` 把十三徽的弦长比例（1/8、1/6 … 7/8）直接列给读者看，
 * 而 `lib/jianzi-pitch.ts` 里的 `HUI_FRACTION` 是**算音高用的真实数据**。
 *
 * 两处一旦不一致，后果很难发现：页面照样漂亮、代码照样算出音，
 * 但读者按页面上的说法去理解，听到的音却是另一回事——
 * 这是「文档与实现悄悄分家」的典型，只能靠比对守住。
 *
 * ## 判据
 *
 * 逐徽比对**数值**而不是字符串：页面写「1/8」、代码写 `1 / 8`，
 * 文本形式本来就不同，比数值才是有意义的检查。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

/** 从 `HUI_FRACTION` 抽出「徽号 → 占弦长比例」。 */
function implementationRatios(): Record<number, number> {
  const src = readFileSync(resolve(ROOT, "lib/jianzi-pitch.ts"), "utf8");
  const block = src.match(/const HUI_FRACTION[^{]*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error("找不到 HUI_FRACTION");
  const out: Record<number, number> = {};
  for (const m of block[1].matchAll(/(\d+):\s*(\d+)\s*\/\s*(\d+)/g)) {
    out[Number(m[1])] = Number(m[2]) / Number(m[3]);
  }
  return out;
}

/** 从科普页的 `HUI_TABLE` 抽出同样的映射。 */
function pageRatios(): Record<number, number> {
  const src = readFileSync(resolve(ROOT, "app/jianzipu/page.tsx"), "utf8");
  const names = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三"];
  const out: Record<number, number> = {};
  for (const m of src.matchAll(/hui:\s*"([^"]+)",\s*ratio:\s*"(\d+)\/(\d+)"/g)) {
    const idx = names.indexOf(m[1].replace("徽", ""));
    if (idx >= 0) out[idx + 1] = Number(m[2]) / Number(m[3]);
  }
  return out;
}

describe("科普页十三徽比例 · 与功能实现一致", () => {
  const impl = implementationRatios();
  const page = pageRatios();

  it("两边都解析出十三项", () => {
    expect(Object.keys(impl)).toHaveLength(13);
    expect(Object.keys(page)).toHaveLength(13);
  });

  it("逐徽数值完全相同", () => {
    for (let hui = 1; hui <= 13; hui += 1) {
      expect(page[hui], `第 ${hui} 徽`).toBeCloseTo(impl[hui], 10);
    }
  });

  it("七徽是中点 1/2（按音比空弦高八度的依据）", () => {
    expect(impl[7]).toBeCloseTo(0.5, 10);
    expect(page[7]).toBeCloseTo(0.5, 10);
  });
});
