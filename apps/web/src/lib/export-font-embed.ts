/**
 * 导出截图前，只把「这次真要画的字」用得上的字体分片内联进 SVG。
 *
 * 为什么需要这一层：html-to-image 的默认行为是把文档里**所有** `@font-face`
 * 的 `src` 全部拉一遍、再 base64 塞进 foreignObject。本站用了 `next/font`，
 * 中文按 unicode-range 切成了 613 个分片（`Noto_Serif_SC` 506 + `Ma_Shan_Zheng`
 * 93 + 西文 13 + 谱面字体 1）。在本机 localhost 这只是一次「稍慢」；放到
 * GitHub Pages 上就是每个分片十几秒、507 个请求挂到超时——**导出永远出不来**
 * （2026-11-26 线上实测：608 个字体请求，25 秒后仍挂 507 个，60 秒无下载）。
 *
 * 做法：先算截图节点里真正出现的字符，再按 `@font-face` 的 `unicode-range`
 * 过滤分片，只内联命中的那几个；没有声明 `unicode-range` 的（谱面字体靠
 * GSUB 连字，字符集无法从 unicode-range 推出来）一律保留。典型结果从 613
 * 个请求降到十几个，线上导出恢复可用。
 *
 * 三个曾经踩过的坑（2026-11-26 第一版全部回退的原因），改这里前先看：
 *   1. `src` 里的相对 URL 要以**样式表自己的 href** 为基准解析，不能以页面为准；
 *   2. `format()` 必须按真实文件扩展名给，`.ttf` 标成 `woff2` 浏览器直接拒收；
 *   3. `font-family` 原样保留（含引号与大小写），自作聪明小写化会匹配不上。
 */

/** 单个字体文件的下载上限：超过就放弃这一片，让浏览器回退，别把导出拖死。 */
const FETCH_TIMEOUT_MS = 15_000;

/** 模块级缓存：同一次会话里反复导出不再重复下载（分片是带 hash 的静态资源）。 */
const dataUrlCache = new Map<string, Promise<string | null>>();

/** 从 CSSOM 或测试里摘出来的一条 `@font-face` 描述。 */
export interface FontFaceDescriptor {
  family: string;
  fontStyle: string;
  weight: string;
  display: string;
  /** 原始 `src` 值，可能含多个 `url(...)` */
  src: string;
  /** 原始 `unicode-range` 值；空串表示全字符集 */
  unicodeRange: string;
  /** 该规则所属样式表的地址，用来解析相对 URL */
  sheetHref: string | null;
}

export interface FontEmbedStats {
  /** 内联成功的 @font-face 数 */
  embedded: number;
  /** 因 unicode-range 与本次字符不交而跳过的分片数 */
  skipped: number;
  /** 命中但下载失败的 @font-face 数 */
  failed: number;
}

export interface FontEmbedResult {
  /** 可直接传给 html-to-image 的 `fontEmbedCSS`；无内容时为 null（走库默认） */
  css: string | null;
  stats: FontEmbedStats;
}

/** 解析 CSS `unicode-range` 描述符（`U+4E00`、`U+4E00-9FFF`、`U+30??` 三种写法）。 */
export function parseUnicodeRange(spec: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const raw of spec.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    const m = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(token);
    if (!m) continue;
    const startText = m[1];
    if (startText.includes("?")) {
      // 通配写法：问号按 0 / F 展开成区间
      const lo = parseInt(startText.replace(/\?/g, "0"), 16);
      const hi = parseInt(startText.replace(/\?/g, "f"), 16);
      ranges.push([lo, hi]);
      continue;
    }
    const lo = parseInt(startText, 16);
    const hi = m[2] ? parseInt(m[2], 16) : lo;
    if (Number.isFinite(lo) && Number.isFinite(hi)) ranges.push([lo, Math.max(lo, hi)]);
  }
  return ranges;
}

/** `spec` 是否覆盖 `codepoints` 中任意一个字符。空 spec 视为「全字符集」。 */
export function matchesUnicodeRange(spec: string, codepoints: Iterable<number>): boolean {
  if (!spec.trim()) return true;
  const ranges = parseUnicodeRange(spec);
  if (ranges.length === 0) return true; // 写法不认识就别省，宁可多下一次
  for (const cp of codepoints) {
    for (const [lo, hi] of ranges) {
      if (cp >= lo && cp <= hi) return true;
    }
  }
  return false;
}

/** 取节点里真正会被画出来的字符（含伪元素与输入框里的值）。 */
export function collectChars(node: HTMLElement): Set<number> {
  const codepoints = new Set<number>();
  const add = (text: string | null | undefined) => {
    if (!text) return;
    for (const ch of text) codepoints.add(ch.codePointAt(0) ?? 0);
  };
  add(node.textContent);
  node.querySelectorAll("input, textarea").forEach((el) => {
    add((el as HTMLInputElement).value);
    add(el.getAttribute("placeholder"));
  });
  // 伪元素常被用作分隔符（·）、引号；拿不到内容就补一份常见标点，
  // 免得页脚里的「·」在导出图里退回系统字体、字重明显变细。
  add("·—…《》（）「」、，。");
  return codepoints;
}

/** 按扩展名给 CSS `format()` 提示；`.ttf` 绝不能写成 `woff2`。 */
export function formatHintFor(url: string): string | null {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".woff2")) return "woff2";
  if (path.endsWith(".woff")) return "woff";
  if (path.endsWith(".ttf")) return "truetype";
  if (path.endsWith(".otf")) return "opentype";
  return null;
}

/** 只留 unicode-range 与本次字符有交集的规则。 */
export function selectFaces(
  faces: readonly FontFaceDescriptor[],
  codepoints: Iterable<number>,
): { kept: FontFaceDescriptor[]; skipped: number } {
  const set = codepoints instanceof Set ? codepoints : new Set(codepoints);
  const kept: FontFaceDescriptor[] = [];
  let skipped = 0;
  for (const face of faces) {
    if (matchesUnicodeRange(face.unicodeRange, set)) kept.push(face);
    else skipped += 1;
  }
  return { kept, skipped };
}

function resolveUrl(url: string, base: string | null): string {
  try {
    return new URL(url, base ?? undefined).href;
  } catch {
    return url;
  }
}

function toBase64(bytes: Uint8Array): string {
  // 不能 `String.fromCharCode(...bytes)`：谱面字体 1.2MB，展开成参数会爆栈
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  const cached = dataUrlCache.get(url);
  if (cached) return cached;
  const task = (async () => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!res.ok) return null;
      const buffer = await res.arrayBuffer();
      const mime =
        {
          truetype: "font/ttf",
          woff2: "font/woff2",
          woff: "font/woff",
          opentype: "font/otf",
        }[formatHintFor(url) ?? "woff2"] ?? "font/woff2";
      return `data:${mime};base64,${toBase64(new Uint8Array(buffer))}`;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  dataUrlCache.set(url, task);
  // 失败不缓存，下次导出还能重试
  task.then((v) => {
    if (!v) dataUrlCache.delete(url);
  });
  return task;
}

function urlsInSrc(src: string): string[] {
  const out: string[] = [];
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const value = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (value && !value.startsWith("data:")) out.push(value);
  }
  return out;
}

/** 把一个 `@font-face` 描述改成内联单源版本；任一 URL 下载成功即可。 */
export async function inlineFace(face: FontFaceDescriptor): Promise<string | null> {
  const candidates = urlsInSrc(face.src).map((u) => resolveUrl(u, face.sheetHref));
  for (const url of candidates) {
    const dataUrl = await fetchAsDataUrl(url);
    if (!dataUrl) continue;
    const format = formatHintFor(url);
    const parts = [
      `font-family:${face.family}`,
      `font-style:${face.fontStyle || "normal"}`,
      `font-weight:${face.weight || "normal"}`,
      face.display ? `font-display:${face.display}` : "",
      `src:url("${dataUrl}")${format ? ` format("${format}")` : ""}`,
      face.unicodeRange ? `unicode-range:${face.unicodeRange}` : "",
    ].filter(Boolean);
    return `@font-face{${parts.join(";")}}`;
  }
  return null;
}

function readFacesFromDocument(): FontFaceDescriptor[] {
  const faces: FontFaceDescriptor[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨域样式表读不到规则，跳过
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const style = rule.style;
      faces.push({
        family: style.getPropertyValue("font-family"),
        fontStyle: style.getPropertyValue("font-style"),
        weight: style.getPropertyValue("font-weight"),
        display: style.getPropertyValue("font-display"),
        src: style.getPropertyValue("src"),
        unicodeRange: style.getPropertyValue("unicode-range"),
        sheetHref: sheet.href,
      });
    }
  }
  return faces;
}

/**
 * 生成**只含本次字符**的 `fontEmbedCSS`。
 *
 * 返回 `css: null` 表示「没法自己算」（取不到样式表规则、或规则里一个可用字体
 * 都没取到）——调用方应退回 html-to-image 的默认行为，别把导出做成空白。
 */
export async function buildSubsetFontEmbedCss(node: HTMLElement): Promise<FontEmbedResult> {
  const faces = readFacesFromDocument();
  if (faces.length === 0) {
    return { css: null, stats: { embedded: 0, skipped: 0, failed: 0 } };
  }
  const { kept, skipped } = selectFaces(faces, collectChars(node));
  const blocks = (await Promise.all(kept.map((face) => inlineFace(face)))).filter(
    (v): v is string => Boolean(v),
  );
  const stats: FontEmbedStats = {
    embedded: blocks.length,
    skipped,
    failed: kept.length - blocks.length,
  };
  if (blocks.length === 0) return { css: null, stats };
  return { css: blocks.join("\n"), stats };
}
