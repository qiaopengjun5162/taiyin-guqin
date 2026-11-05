import { describe, it, expect } from "vitest";
import { segmentSheet, recognizeSheetCells, type CellBox } from "../jianzi-sheet-segment";
import type { TemplateIndex } from "../jianzi-template";

/** 白底（luma=255）灰度页。 */
function blank(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h).fill(255);
}

/** 在灰度页上填一个墨块（luma=0）。 */
function fillRect(img: Uint8Array, w: number, x0: number, y0: number, bw: number, bh: number) {
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) img[y * w + x] = 0;
  }
}

describe("segmentSheet · 投影切分", () => {
  it("找出网格的行再找列（2 行 × 3 列）", () => {
    const w = 130;
    const h = 70;
    const img = blank(w, h);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) fillRect(img, w, 10 + c * 40, 10 + r * 40, 10, 10);
    }
    const rows = segmentSheet(w, h, img);
    expect(rows.length).toBe(2);
    expect(rows[0].length).toBe(3);
    expect(rows[1].length).toBe(3);
    // 行从上到下、格从左到右
    expect(rows[0][0]).toEqual({ y0: 10, y1: 20, x0: 10, x1: 20 } as CellBox);
    expect(rows[1][2]).toEqual({ y0: 50, y1: 60, x0: 90, x1: 100 } as CellBox);
  });

  it("桥接字内白色通道、但切开相邻字（间隙容忍）", () => {
    const w = 80;
    const h = 30;
    const img = blank(w, h);
    fillRect(img, w, 10, 10, 8, 8); // 字 1 左半
    fillRect(img, w, 20, 10, 8, 8); // 字 1 右半，内部白缝 x=18..20（2px）
    fillRect(img, w, 48, 10, 8, 8); // 字 2，距字 1 有 20px 白缝
    const rows = segmentSheet(w, h, img);
    expect(rows.length).toBe(1);
    expect(rows[0].length).toBe(2);
    expect(rows[0][0]).toEqual({ y0: 10, y1: 18, x0: 10, x1: 28 } as CellBox);
    expect(rows[0][1]).toEqual({ y0: 10, y1: 18, x0: 48, x1: 56 } as CellBox);
  });

  it("全白页返回空", () => {
    expect(segmentSheet(20, 20, blank(20, 20))).toEqual([]);
  });

  it("luma 尺寸不符时抛错", () => {
    expect(() => segmentSheet(4, 4, new Uint8Array(10))).toThrow();
  });
});

describe("recognizeSheetCells · 切分 + 逐格匹配", () => {
  // 两个可区分的「已归一化」64×64 字形（墨=255）：甲=实心方块、乙=方框（中心镂空）。
  // 直接构造归一化模板像素，再用与 Rust loopback 同款方式：放大 2× + 反相
  // （墨=255 → 页面 luma 墨=0）拼成整页，断言切分+归一化+最近邻能认回原名
  // —— 验证整条链路接线（与 crates/taiyin-server sheet_segment.rs 的
  // recognize_cells_loopback_on_template_page 逐行等价）。
  const SIZE = 64;
  const filled = (n: number) => new Uint8Array(n * n).fill(255);
  const bordered = (n: number) => {
    const p = new Uint8Array(n * n);
    const t = Math.floor(n * 0.25);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (y < t || y >= n - t || x < t || x >= n - t) p[y * n + x] = 255;
    return p;
  };
  const index: TemplateIndex = {
    size: SIZE,
    entries: [
      { name: "甲", truths: ["甲"], pixels: filled(SIZE) },
      { name: "乙", truths: ["乙"], pixels: bordered(SIZE) },
    ],
  };

  it("端到端回环：拼出的整页应认回每个字格", () => {
    const scale = 2;
    const gap = 24;
    const margin = 12;
    const cell = SIZE * scale;
    const w = margin * 2 + cell * 2 + gap;
    const h = margin * 2 + cell * 2 + gap;
    const img = blank(w, h);
    const picks = ["甲", "乙", "甲", "乙"]; // 2×2 网格，按行优先
    for (let i = 0; i < 4; i++) {
      const r = Math.floor(i / 2);
      const c = i % 2;
      const src = picks[i] === "甲" ? filled(SIZE) : bordered(SIZE);
      const ox = margin + c * (cell + gap);
      const oy = margin + r * (cell + gap);
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const v = src[Math.floor(y / scale) * SIZE + Math.floor(x / scale)];
          img[(oy + y) * w + (ox + x)] = 255 - v; // 模板墨=255 → 页面 luma 墨=0
        }
      }
    }
    const cells = recognizeSheetCells(index, w, h, img);
    expect(cells.length).toBe(4);
    const nameAt = (row: number, col: number) =>
      cells.find((cl) => cl.row === row && cl.col === col)?.m?.name;
    expect(nameAt(0, 0)).toBe("甲");
    expect(nameAt(0, 1)).toBe("乙");
    expect(nameAt(1, 0)).toBe("甲");
    expect(nameAt(1, 1)).toBe("乙");
  });
});
