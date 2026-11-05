/**
 * 浏览器端整页减字谱识别（模板切分 + 逐格匹配）。
 *
 * 让纯静态站点（无后端、无 LLM）也能识别「电子谱面」整页：把一整页切成
 * 字格，逐格用 `jianzi-template` 的模板匹配认出减字。整套算法与
 * `crates/taiyin-server/src/sheet_segment.rs` 逐行等价：
 *
 *   3×3 中值（边缘钳位）去斑 → 阈值 128 取墨 → 行投影找行带 →
 *   带内列投影找字格 → **间隙容忍**（白缝 < 0.10×S 不切，S = 最大墨段边长）
 *   → 逐格最近邻匹配。
 *
 * 诚实边界（与 Rust 端一致）：只对**干净电子谱面图**有效（本项目字体渲染 /
 * 清晰二值化扫描）。拍照、手写件的光照、倾斜、笔画粘连超出该算法适用范围。
 */

import {
  median3,
  normalizeGray,
  matchPixels,
  fileToRgba,
  rgbaToLuma,
  TEMPLATE_SIZE,
  type TemplateIndex,
  type TemplateMatch,
} from "./jianzi-template";

const MIN_RUN = 3;
const THRESH = 128;
const COL_GAP_FRAC = 0.10;
const ROW_GAP_FRAC = 0.10;

/** 字格外接框（end-exclusive）。 */
export interface CellBox {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

/** 一个字格的识别结果（几何 + 模板匹配）。 */
export interface SheetCellRecognized {
  /** 行号：从上到下，首行 = 0。 */
  row: number;
  /** 列号：从左到右，最左 = 0（减字谱阅读顺序为同排从右到左，前端换算）。 */
  col: number;
  rect: CellBox;
  m: TemplateMatch | null;
}

/** 布尔序列的连续 True 段 [(start, endExclusive), ...]。 */
function runs(
  flags: boolean[],
  minRun: number,
  gapTol: number,
): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  let start: number | null = null;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && start === null) start = i;
    else if (!flags[i] && start !== null) {
      raw.push([start, i]);
      start = null;
    }
  }
  if (start !== null) raw.push([start, flags.length]);

  const merged: Array<[number, number]> = [];
  for (const [s, e] of raw) {
    if (merged.length && s - merged[merged.length - 1][1] < gapTol) {
      merged[merged.length - 1][1] = e;
    } else merged.push([s, e]);
  }
  return merged.filter(([s, e]) => e - s >= minRun);
}

/** 整页灰度（白底黑字）→ 按行分组的字格外接框。行从上到下、格从左到右。 */
export function segmentSheet(
  width: number,
  height: number,
  luma: Uint8Array,
): CellBox[][] {
  if (luma.length !== width * height) throw new Error("luma buffer size mismatch");
  const smooth = median3(width, height, luma);
  const ink: boolean[] = new Array(width * height);
  for (let i = 0; i < smooth.length; i++) ink[i] = smooth[i] < THRESH;

  const rowFlags: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let any = false;
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x]) {
        any = true;
        break;
      }
    }
    rowFlags.push(any);
  }
  const colFlagsIn = (y0: number, y1: number): boolean[] => {
    const out: boolean[] = [];
    for (let x = 0; x < width; x++) {
      let any = false;
      for (let y = y0; y < y1; y++) {
        if (ink[y * width + x]) {
          any = true;
          break;
        }
      }
      out.push(any);
    }
    return out;
  };

  // 页面墨迹尺度 S = 原始墨段里「最大带高 ∪ 最大带宽」，对过切/漏切都稳。
  let sEst = 0;
  for (const [y0, y1] of runs(rowFlags, 1, 0)) {
    sEst = Math.max(sEst, y1 - y0);
    for (const [x0, x1] of runs(colFlagsIn(y0, y1), 1, 0)) {
      sEst = Math.max(sEst, x1 - x0);
    }
  }
  // int(x + 0.5) half-up 取整，与 Rust `(x + 0.5) as usize` 一致；
  // 勿用 Math.round 的银行家舍入（8.5→8 而 Rust 为 9，临界间隙会分叉）。
  const kRow = Math.max(3, Math.floor(ROW_GAP_FRAC * sEst + 0.5));
  const kCol = Math.max(3, Math.floor(COL_GAP_FRAC * sEst + 0.5));

  const rows: CellBox[][] = [];
  for (const [y0, y1] of runs(rowFlags, MIN_RUN, kRow)) {
    const boxes = runs(colFlagsIn(y0, y1), MIN_RUN, kCol).map(
      ([x0, x1]) => ({ y0, y1, x0, x1 }) as CellBox,
    );
    rows.push(boxes);
  }
  return rows;
}

/** 切分 + 逐格最近邻匹配。 */
export function recognizeSheetCells(
  index: TemplateIndex,
  width: number,
  height: number,
  luma: Uint8Array,
): SheetCellRecognized[] {
  const rows = segmentSheet(width, height, luma);
  const out: SheetCellRecognized[] = [];
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      const b = rows[row][col];
      const cw = b.x1 - b.x0;
      const ch = b.y1 - b.y0;
      const crop = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          crop[y * cw + x] = luma[(b.y0 + y) * width + (b.x0 + x)];
        }
      }
      const query = normalizeGray(cw, ch, crop, index.size || TEMPLATE_SIZE);
      out.push({ row, col, rect: b, m: matchPixels(index, query) });
    }
  }
  return out;
}

/** 一步到位：整页图片文件 → 切分 + 逐格识别（浏览器环境）。 */
export async function recognizeSheetFile(
  index: TemplateIndex,
  file: File | Blob,
): Promise<SheetCellRecognized[]> {
  const { data, width, height } = await fileToRgba(file);
  const luma = rgbaToLuma(data, width, height);
  return recognizeSheetCells(index, width, height, luma);
}
