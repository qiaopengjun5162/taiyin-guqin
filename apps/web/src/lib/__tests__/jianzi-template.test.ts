import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeGray,
  matchPixels,
  median3,
  rgbaToLuma,
  parseTemplateIndex,
  recognizeLuma,
  TEMPLATE_SIZE,
  type TemplateIndex,
} from "../jianzi-template";

const REPO_ROOT = join(__dirname, "../../../../..");
const RUST_INDEX = join(
  REPO_ROOT,
  "crates/taiyin-server/data/template_index.json",
);
const WEB_INDEX = join(REPO_ROOT, "apps/web/public/data/template_index.json");

/** 与 Rust 端 `golden_tmp` 完全相同的合成输入（20×20，黑块 + 两个缺口）。 */
function synthetic(): { w: number; h: number; luma: Uint8Array } {
  const w = 20;
  const h = 20;
  const luma = new Uint8Array(w * h).fill(255);
  for (let y = 6; y < 16; y++) {
    for (let x = 4; x < 14; x++) luma[y * w + x] = 20;
  }
  luma[7 * w + 5] = 255;
  luma[9 * w + 6] = 255;
  return { w, h, luma };
}

describe("模板索引", () => {
  it("前端静态副本与 Rust 端数据逐字节一致（防漂移）", () => {
    const a = readFileSync(RUST_INDEX);
    const b = readFileSync(WEB_INDEX);
    expect(b.equals(a)).toBe(true);
  });

  it("能解析出 64 边长的模板表", () => {
    const index = parseTemplateIndex(readFileSync(WEB_INDEX, "utf8"));
    expect(index.size).toBe(64);
    expect(index.entries.length).toBeGreaterThan(200);
    expect(index.entries[0].pixels.length).toBe(64 * 64);
    expect(index.entries[0].truths.length).toBeGreaterThan(0);
  });
});

describe("normalizeGray", () => {
  it("与 Rust 实现逐值对齐（黄金样例）", () => {
    const { w, h, luma } = synthetic();
    const norm = normalizeGray(w, h, luma, TEMPLATE_SIZE);
    expect(norm.length).toBe(64 * 64);
    // Rust: println!("GOLDEN_HEAD={:?}", &norm[..16])
    expect(Array.from(norm.slice(0, 16))).toEqual([
      0, 0, 0, 12, 52, 92, 131, 171, 211, 251, 255, 255, 255, 255, 255, 255,
    ]);
    // Rust: GOLDEN_SUM=1002796（f32/f64 累加差异允许极小误差）
    const sum = norm.reduce((acc, v) => acc + v, 0);
    expect(Math.abs(sum - 1002796)).toBeLessThanOrEqual(64);
  });

  it("全白图返回全 0，不抛异常", () => {
    const norm = normalizeGray(10, 10, new Uint8Array(100).fill(255), 64);
    expect(norm.every((v) => v === 0)).toBe(true);
  });

  it("尺寸不匹配时抛错", () => {
    expect(() => normalizeGray(4, 4, new Uint8Array(10), 64)).toThrow();
  });
});

describe("median3", () => {
  it("抹掉孤立噪点，平坦区保持原值", () => {
    const src = new Uint8Array(25).fill(200);
    src[12] = 0;
    const out = median3(5, 5, src);
    expect(out[12]).toBe(200);
    expect(out[0]).toBe(200);
  });
});

describe("rgbaToLuma", () => {
  it("透明像素按白纸合成，不会变黑", () => {
    const rgba = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255]);
    const luma = rgbaToLuma(rgba, 2, 1);
    expect(luma[0]).toBe(255);
    expect(luma[1]).toBe(0);
  });

  it("红绿蓝权重符合 BT.601", () => {
    const luma = rgbaToLuma(new Uint8Array([255, 0, 0, 255]), 1, 1);
    expect(luma[0]).toBe(Math.round(0.299 * 255));
  });
});

describe("matchPixels / recognizeLuma", () => {
  let index: TemplateIndex;

  beforeAll(() => {
    index = parseTemplateIndex(readFileSync(WEB_INDEX, "utf8"));
  });

  it("查询向量等于某模板时，该模板必然命中且置信度高", () => {
    const target = index.entries[97];
    const m = matchPixels(index, target.pixels);
    expect(m).not.toBeNull();
    expect(m!.name).toBe(target.name);
    expect(m!.distance).toBeCloseTo(0, 5);
  });

  it("合成输入的最佳匹配与 Rust 一致（sm_zhong4）", () => {
    const { w, h, luma } = synthetic();
    const m = recognizeLuma(index, w, h, luma);
    expect(m).not.toBeNull();
    // Rust: GOLDEN_MATCH=sm_zhong4 d=10289.1631 margin=57.8262 conf=0.005589
    expect(m!.name).toBe("sm_zhong4");
    expect(m!.distance).toBeCloseTo(10289.1631, 0);
    expect(m!.confidence).toBeCloseTo(0.005589, 4);
  });

  it("空索引返回 null", () => {
    expect(matchPixels({ size: 64, entries: [] }, new Uint8Array(64 * 64))).toBeNull();
  });
});

/**
 * 懒加载模板索引：识别功能第一次点击才下载。
 *
 * 三条边界都会让「识别」整体不可用，但平时很难察觉：
 * ① 缓存失效 → 每识别一次重下几百 KB；
 * ② 并发去重失效 → 连点两下下两遍；
 * ③ 失败后 pending 没清 → 之后永远拿到同一个失败结果，重试也没用。
 */
describe("loadTemplateIndex · 懒加载与缓存", () => {
  const INDEX_JSON = JSON.stringify({
    size: 64,
    entries: [{ name: "sm_x", pixels: "AA==" }],
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("首次加载后缓存：第二次不再发请求", async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => INDEX_JSON });
    vi.stubGlobal("fetch", fetchMock);
    const { loadTemplateIndex } = await import("../jianzi-template");

    const first = await loadTemplateIndex("data/index.json");
    const second = await loadTemplateIndex("data/index.json");

    expect(first).toBe(second);
    expect(first.size).toBe(64);
    // 缺省 truths 补成空数组，而不是 undefined（下游会直接 .length）
    expect(first.entries[0].truths).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("并发调用共享同一次请求，不会下两遍", async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => INDEX_JSON });
    vi.stubGlobal("fetch", fetchMock);
    const { loadTemplateIndex } = await import("../jianzi-template");

    const [a, b] = await Promise.all([
      loadTemplateIndex("data/index.json"),
      loadTemplateIndex("data/index.json"),
    ]);

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 非 2xx 抛错，失败后清掉 pending 可重试", async () => {
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, text: async () => INDEX_JSON });
    vi.stubGlobal("fetch", fetchMock);
    const { loadTemplateIndex } = await import("../jianzi-template");

    await expect(loadTemplateIndex("data/index.json")).rejects.toThrow("HTTP 404");
    // finally 已清空 pendingFetch：再来一次会真的重试，而不是永远拿到失败结果
    const ok = await loadTemplateIndex("data/index.json");
    expect(ok.entries).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
