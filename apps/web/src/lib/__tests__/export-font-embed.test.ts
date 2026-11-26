/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildSubsetFontEmbedCss,
  collectChars,
  formatHintFor,
  inlineFace,
  matchesUnicodeRange,
  parseUnicodeRange,
  selectFaces,
  type FontFaceDescriptor,
} from "../export-font-embed";

describe("parseUnicodeRange", () => {
  it("解析单值、区间与通配三种写法", () => {
    expect(parseUnicodeRange("U+4E00")).toEqual([[0x4e00, 0x4e00]]);
    expect(parseUnicodeRange("U+4E00-9FFF")).toEqual([[0x4e00, 0x9fff]]);
    expect(parseUnicodeRange("U+30??")).toEqual([[0x3000, 0x30ff]]);
  });

  it("解析逗号分隔的多个区间，忽略不认识的 token", () => {
    expect(parseUnicodeRange("U+0020-007F, U+4E00, nonsense")).toEqual([
      [0x20, 0x7f],
      [0x4e00, 0x4e00],
    ]);
  });
});

describe("matchesUnicodeRange", () => {
  const cps = (s: string) => Array.from(s, (c) => c.codePointAt(0)!);

  it("空 spec 视为全字符集（谱面字体靠连字，不能省）", () => {
    expect(matchesUnicodeRange("", cps("花"))).toBe(true);
  });

  it("命中任一区间即为真，全不命中才跳过", () => {
    expect(matchesUnicodeRange("U+4E00-9FFF", cps("花非花"))).toBe(true);
    expect(matchesUnicodeRange("U+4E00-9FFF", cps("abc"))).toBe(false);
    expect(matchesUnicodeRange("U+0020-007F, U+4E00-9FFF", cps("a花"))).toBe(true);
  });

  it("区间边界包含在内", () => {
    expect(matchesUnicodeRange("U+4E00-4E01", [0x4e00])).toBe(true);
    expect(matchesUnicodeRange("U+4E00-4E01", [0x4e01])).toBe(true);
    expect(matchesUnicodeRange("U+4E00-4E01", [0x4e02])).toBe(false);
  });
});

describe("collectChars", () => {
  it("收正文、输入框的值与占位符，并补上页脚常用的分隔符", () => {
    const node = document.createElement("div");
    node.innerHTML = `<span>花非花</span><textarea placeholder="输入简谱"></textarea>`;
    (node.querySelector("textarea") as HTMLTextAreaElement).value = "5612";
    const cps = collectChars(node);
    const has = (ch: string) => cps.has(ch.codePointAt(0)!);
    expect(has("花")).toBe(true);
    expect(has("输")).toBe(true);
    expect(has("5")).toBe(true);
    expect(has("·")).toBe(true);
  });
});

describe("formatHintFor", () => {
  it("按扩展名给 format 提示，.ttf 不能写成 woff2", () => {
    expect(formatHintFor("/fonts/a.ttf")).toBe("truetype");
    expect(formatHintFor("/a.woff2?v=1")).toBe("woff2");
    expect(formatHintFor("/a.woff")).toBe("woff");
    expect(formatHintFor("/a.otf")).toBe("opentype");
    expect(formatHintFor("/a.txt")).toBeNull();
  });
});

describe("selectFaces", () => {
  const face = (over: Partial<FontFaceDescriptor>): FontFaceDescriptor => ({
    family: '"Noto Serif SC"',
    fontStyle: "normal",
    weight: "400",
    display: "swap",
    src: 'url("/a.woff2") format("woff2")',
    unicodeRange: "",
    sheetHref: "https://example.com/_next/static/css/x.css",
    ...over,
  });

  it("只留与本次字符相交的分片，没有 unicode-range 的一律保留", () => {
    const faces = [
      face({ unicodeRange: "U+4E00-9FFF" }), // 命中「花」
      face({ unicodeRange: "U+0020-007F" }), // 拉丁，本图没有
      face({ family: '"WangJiJianZiPuKaiTi"', src: 'url("/fonts/a.ttf") format("truetype")' }),
    ];
    const { kept, skipped } = selectFaces(faces, Array.from("花非花", (c) => c.codePointAt(0)!));
    expect(kept).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(kept[1].family).toBe('"WangJiJianZiPuKaiTi"');
  });
});

describe("inlineFace", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("按样式表基准解析相对 src，TTF 标 truetype 而不是 woff2", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array([104, 105]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const css = await inlineFace({
      family: '"WangJiJianZiPuKaiTi"',
      fontStyle: "normal",
      weight: "normal",
      display: "swap",
      src: 'url("../fonts/WangJiJianZiPuKaiTi.ttf") format("truetype")',
      unicodeRange: "",
      sheetHref: "https://example.com/_next/static/css/app.css",
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://example.com/_next/static/fonts/WangJiJianZiPuKaiTi.ttf",
    );
    expect(css).toContain('format("truetype")');
    expect(css).toContain("data:font/ttf;base64,");
    expect(css).toContain('font-family:"WangJiJianZiPuKaiTi"');
  });

  it("下载失败返回 null，让调用方统计成 failed 而不是抛错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const css = await inlineFace({
      family: "X",
      fontStyle: "",
      weight: "",
      display: "",
      src: 'url("/missing.woff2")',
      unicodeRange: "",
      sheetHref: null,
    });
    expect(css).toBeNull();
  });
});

describe("buildSubsetFontEmbedCss", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    document.head.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("文档里没有 @font-face 时返回 null，让调用方走库默认行为", async () => {
    const node = document.createElement("div");
    node.textContent = "花非花";
    const result = await buildSubsetFontEmbedCss(node);
    expect(result.css).toBeNull();
    expect(result.stats.embedded).toBe(0);
  });
});
