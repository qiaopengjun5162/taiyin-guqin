/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// html-to-image 在 jsdom 里跑不动（要真实排版与字体），整体替身，只验证接线与时序。
const toPng = vi.hoisted(() => vi.fn());
const toSvg = vi.hoisted(() => vi.fn());
vi.mock("html-to-image", () => ({ toPng, toSvg }));

import { downloadJianziImage, jianziImageFilename } from "@/lib/jianzi-image";

interface ClickedLink {
  download: string;
  href: string;
}

let clicks: ClickedLink[];
let clickSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toPng.mockReset().mockResolvedValue("data:image/png;base64,AAAA");
  toSvg.mockReset().mockResolvedValue("data:image/svg+xml;charset=utf-8,<svg/>");
  clicks = [];
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // 造一个可控的 fonts.ready，用来验证「必须等字体」这道时序保护。
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});

afterEach(() => {
  clickSpy.mockRestore();
  errorSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("jianziImageFilename", () => {
  it("保留中文可读名，按格式给扩展名", () => {
    expect(jianziImageFilename("大九勾四", "png")).toBe("太音_大九勾四.png");
    expect(jianziImageFilename("散勾三", "svg")).toBe("太音_散勾三.svg");
  });

  it("把路径分隔符和 Windows 非法字符清掉，别让浏览器截断文件名", () => {
    const name = jianziImageFilename('大/九:勾*四?"<>|\\', "png");
    expect(name.startsWith("太音_")).toBe(true);
    expect(name.endsWith(".png")).toBe(true);
    for (const bad of ["/", "\\", ":", "*", "?", '"', "<", ">", "|"]) {
      expect(name).not.toContain(bad);
    }
  });

  it("空标签 / 纯空白有兜底，不会导出成『太音_.png』", () => {
    expect(jianziImageFilename("", "png")).toBe("太音_减字.png");
    expect(jianziImageFilename("   ", "svg")).toBe("太音_减字.svg");
  });

  it("旧存档缺 label 时（运行时 undefined）也不炸", () => {
    expect(jianziImageFilename(undefined as unknown as string, "png")).toBe("太音_减字.png");
  });

  it("超长自定义名截断到 40 字，避免文件名过长", () => {
    const name = jianziImageFilename("勾".repeat(60), "png");
    expect(name).toBe(`太音_${"勾".repeat(40)}.png`);
  });
});

describe("downloadJianziImage", () => {
  it("节点不存在时明确返回 false，且不调用截图", async () => {
    expect(await downloadJianziImage(null, "大九勾四")).toBe(false);
    expect(toPng).not.toHaveBeenCalled();
  });

  it("PNG：截真实节点、宣纸底、4 倍像素，并按名字下载", async () => {
    const node = document.createElement("span");
    expect(await downloadJianziImage(node, "大九勾四", "png")).toBe(true);

    expect(toPng).toHaveBeenCalledTimes(1);
    const [target, options] = toPng.mock.calls[0];
    expect(target).toBe(node);
    expect(options).toMatchObject({
      backgroundColor: "#f8f3eb",
      pixelRatio: 4,
      cacheBust: true,
    });
    expect(clicks).toEqual([
      { download: "太音_大九勾四.png", href: "data:image/png;base64,AAAA" },
    ]);
  });

  it("SVG 走 toSvg，扩展名也跟着变", async () => {
    await downloadJianziImage(document.createElement("span"), "散勾三", "svg");
    expect(toPng).not.toHaveBeenCalled();
    expect(toSvg).toHaveBeenCalledTimes(1);
    expect(clicks[0].download).toBe("太音_散勾三.svg");
  });

  it("⚠️ 字体没 ready 之前不许截图——不等会静默导出四个普通汉字", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: gate },
    });

    const pending = downloadJianziImage(document.createElement("span"), "大九勾四");
    await Promise.resolve();
    expect(toPng).not.toHaveBeenCalled();

    release();
    expect(await pending).toBe(true);
    expect(toPng).toHaveBeenCalledTimes(1);
  });

  it("没有 fonts API 的老环境仍能导出（可选链兜住）", async () => {
    Object.defineProperty(document, "fonts", { configurable: true, value: undefined });
    expect(await downloadJianziImage(document.createElement("span"), "大九勾四")).toBe(true);
    expect(toPng).toHaveBeenCalledTimes(1);
  });

  it("截图抛错时返回 false 并说明理由，不能静默", async () => {
    toPng.mockRejectedValueOnce(new Error("canvas tainted"));
    expect(await downloadJianziImage(document.createElement("span"), "大九勾四")).toBe(false);
    expect(clicks).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });
});
