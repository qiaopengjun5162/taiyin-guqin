/**
 * 浏览器端减字模板匹配 —— 让线上（纯静态、无后端）也能真的识别减字。
 *
 * 算法与 `crates/taiyin-server/src/template_match.rs` 逐行等价：
 *   3×3 中值去斑 → 阈值 128 取墨迹 → 裁外接框 → 补正方形 → 半像素中心双线性缩放到 64
 *   → 与 257 个模板算欧氏距离 → 取最近邻，用 top-2 距离差算置信度。
 *
 * 为什么在浏览器里重写而不是把 Rust 编成 WASM：
 *   1. 那 1.4MB 模板索引要靠 `fetch` 懒加载，塞进 .wasm 会让每个访客先下一遍；
 *   2. 算法只有几十行、纯算术，TS 版好测、好读，省掉 wasm 工具链与产物同步。
 *   等价性由 `__tests__/jianzi-template.test.ts` 的黄金样例兜底。
 *
 * 诚实边界（与 Rust 端一致）：只对**干净电子谱面图**有效（字体渲染 / 清晰二值化扫描），
 * 拍照件的光照、倾斜、笔画粘连超出该算法适用范围。
 */

/** 模板边长（与 Rust `SIZE` 一致） */
export const TEMPLATE_SIZE = 64;

/** 一个模板字形 */
export interface TemplateEntry {
  name: string;
  /**
   * 等价文本写法，[0] 是规范文本。
   * ⚠️ 例子「大九勾四」是**设计意图**，不是当前生产索引内容：2026-11-09 判定
   * 257 模板 / 385 文本里 0 条标准完整减字，全是复合指法符号与部件。
   * 见 docs/articles/material/2026-11-09-真谱适用性判定-识别结构性失效.md。
   */
  truths: string[];
  /** 64×64 灰度，0..255 */
  pixels: Uint8Array;
}

export interface TemplateIndex {
  size: number;
  entries: TemplateEntry[];
}

export interface TemplateMatch {
  name: string;
  text: string;
  /** 与最佳模板的欧氏距离 */
  distance: number;
  /** 与次优的距离差，越大越可信 */
  margin: number;
  /** 1 - d1/d2，top-2 难分时接近 0 */
  confidence: number;
}

interface RawEntry {
  name: string;
  truths?: string[];
  pixels: string;
}

interface RawIndex {
  size: number;
  entries: RawEntry[];
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 解析模板索引 JSON 文本 */
export function parseTemplateIndex(json: string): TemplateIndex {
  const raw = JSON.parse(json) as RawIndex;
  return {
    size: raw.size,
    entries: raw.entries.map((e) => ({
      name: e.name,
      truths: e.truths ?? [],
      pixels: base64ToBytes(e.pixels),
    })),
  };
}

let cachedIndex: TemplateIndex | null = null;
let pendingFetch: Promise<TemplateIndex> | null = null;

/**
 * 懒加载模板索引（首次点击识别才下载，不拖慢首屏）。
 * `url` 需能通过 basePath 访问，调用方传 `"data/template_index.json"`。
 */
export async function loadTemplateIndex(url: string): Promise<TemplateIndex> {
  if (cachedIndex) return cachedIndex;
  if (pendingFetch) return pendingFetch;
  pendingFetch = (async () => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`模板索引加载失败（HTTP ${res.status}）`);
    }
    cachedIndex = parseTemplateIndex(await res.text());
    return cachedIndex;
  })();
  try {
    return await pendingFetch;
  } finally {
    pendingFetch = null;
  }
}

/** 3×3 中值滤波（边缘钳位）。与 Rust `median3` 同一公式。 */
export function median3(width: number, height: number, src: Uint8Array): Uint8Array {
  const out = new Uint8Array(width * height);
  const win = new Uint8Array(9);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(Math.max(y + dy, 0), height - 1);
          const xx = Math.min(Math.max(x + dx, 0), width - 1);
          win[k++] = src[yy * width + xx];
        }
      }
      // 9 个元素取中位数：插入排序足够快，也避免 TypedArray.sort 的比较器开销
      for (let i = 1; i < 9; i++) {
        const v = win[i];
        let j = i - 1;
        while (j >= 0 && win[j] > v) {
          win[j + 1] = win[j];
          j--;
        }
        win[j + 1] = v;
      }
      out[y * width + x] = win[4];
    }
  }
  return out;
}

/** 半像素中心双线性缩放（f32 画布 → size×size）。与 Rust `bilinear_resize` 同一公式。 */
function bilinearResize(
  canvas: Float32Array,
  w: number,
  h: number,
  size: number,
): Uint8Array {
  const out = new Uint8Array(size * size);
  const sy = h / size;
  const sx = w / size;
  for (let oy = 0; oy < size; oy++) {
    const fy = Math.min(Math.max((oy + 0.5) * sy - 0.5, 0), h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, h - 1);
    const wy = fy - y0;
    for (let ox = 0; ox < size; ox++) {
      const fx = Math.min(Math.max((ox + 0.5) * sx - 0.5, 0), w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, w - 1);
      const wx = fx - x0;
      const top = canvas[y0 * w + x0] * (1 - wx) + canvas[y0 * w + x1] * wx;
      const bot = canvas[y1 * w + x0] * (1 - wx) + canvas[y1 * w + x1] * wx;
      const v = top * (1 - wy) + bot * wy;
      out[oy * size + ox] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  return out;
}

/**
 * 归一化：中值去斑 → 阈值 128 取墨迹 → 裁外接框 → 补正方形 → 双线性缩放。
 * 全白图返回全 0（与 Rust 一致）。
 */
export function normalizeGray(
  width: number,
  height: number,
  luma: Uint8Array,
  size: number = TEMPLATE_SIZE,
): Uint8Array {
  if (luma.length !== width * height) {
    throw new Error("luma 缓冲区尺寸不匹配");
  }
  const smooth = median3(width, height, luma);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (smooth[y * width + x] < 128) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return new Uint8Array(size * size);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const side = Math.max(cw, ch);
  const canvas = new Float32Array(side * side);
  const oy = Math.floor((side - ch) / 2);
  const ox = Math.floor((side - cw) / 2);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (smooth[(minY + y) * width + minX + x] < 128) {
        canvas[(oy + y) * side + (ox + x)] = 1;
      }
    }
  }
  return bilinearResize(canvas, side, side, size);
}

/** 从 RGBA（ImageData.data）取亮度，alpha 先与白底合成，避免透明 PNG 变全黑。 */
export function rgbaToLuma(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = rgba[p + 3] / 255;
    const r = rgba[p] * a + 255 * (1 - a);
    const g = rgba[p + 1] * a + 255 * (1 - a);
    const b = rgba[p + 2] * a + 255 * (1 - a);
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

/** 在索引里给归一化像素找最近邻。与 Rust `match_pixels` 同一公式。 */
export function matchPixels(index: TemplateIndex, query: Uint8Array): TemplateMatch | null {
  if (index.entries.length === 0) return null;
  let best = -1;
  let bestDist = Infinity;
  let secondDist = Infinity;
  for (let i = 0; i < index.entries.length; i++) {
    const px = index.entries[i].pixels;
    let acc = 0;
    const n = Math.min(px.length, query.length);
    for (let k = 0; k < n; k++) {
      const d = px[k] - query[k];
      acc += d * d;
    }
    const dist = Math.sqrt(acc);
    if (dist < bestDist) {
      secondDist = bestDist;
      bestDist = dist;
      best = i;
    } else if (dist < secondDist) {
      secondDist = dist;
    }
  }
  if (best < 0) return null;
  const entry = index.entries[best];
  const margin = secondDist - bestDist;
  const d2 = bestDist + margin;
  const confidence = d2 <= 1e-6 ? 1 : Math.min(1, Math.max(0, 1 - bestDist / d2));
  return {
    name: entry.name,
    text: entry.truths[0] ?? entry.name,
    distance: bestDist,
    margin,
    confidence,
  };
}

/** 一张图（宽高 + 亮度）→ 最佳匹配 */
export function recognizeLuma(
  index: TemplateIndex,
  width: number,
  height: number,
  luma: Uint8Array,
): TemplateMatch | null {
  const query = normalizeGray(width, height, luma, index.size || TEMPLATE_SIZE);
  return matchPixels(index, query);
}

/** 画布/图片 → 亮度 → 匹配。浏览器环境用，测试里可传入 mock 画布。 */
export function recognizeImageData(
  index: TemplateIndex,
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): TemplateMatch | null {
  return recognizeLuma(index, width, height, rgbaToLuma(data, width, height));
}

/** 图片解码后的最大边长：手机原图 4000px 直接跑中值滤波太慢，等比缩到这个尺寸足够。 */
const MAX_DECODE_SIDE = 512;

/**
 * 把用户选的图片解成 RGBA（仅浏览器）。透明背景按白纸处理，拍照的深色背景也能吃到。
 */
export async function fileToRgba(
  file: File | Blob,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = (canvas as OffscreenCanvas).getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("无法创建画布上下文");
  // 先铺白纸：透明 PNG 直接读像素会得到全黑，归一化后必然匹配失败
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

/** 一步到位：图片文件 → 最佳匹配（浏览器环境） */
export async function recognizeFile(
  index: TemplateIndex,
  file: File | Blob,
): Promise<TemplateMatch | null> {
  const { data, width, height } = await fileToRgba(file);
  return recognizeImageData(index, data, width, height);
}
