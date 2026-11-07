/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExportImage } from "../use-export-image";
import * as htmlToImage from "html-to-image";

// 自动 mock 整个模块（无工厂，避免引用 hoist 前的外部变量）；
// 用 vi.mocked 取得带 mock 方法的强类型引用
vi.mock("html-to-image");
const toPng = vi.mocked(htmlToImage.toPng);
const toSvg = vi.mocked(htmlToImage.toSvg);

function setupContainer() {
  // 容器内放一个真实 DOM 节点作为截图目标
  const container = document.createElement("div");
  document.body.appendChild(container);
  // export-footer 平时 hidden，导出时应被移除 hidden 再恢复
  const footer = document.createElement("div");
  footer.id = "export-footer";
  footer.className = "hidden";
  document.body.appendChild(footer);
  return { container, footer };
}

describe("useExportImage", () => {
  let capturedLink: HTMLAnchorElement | null = null;

  beforeEach(() => {
    toPng.mockReset();
    toSvg.mockReset();
    toPng.mockResolvedValue("data:image/png;base64,AAAA");
    toSvg.mockResolvedValue("data:image/svg+xml;base64,AAAA");
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:url"),
      revokeObjectURL: vi.fn(),
    });
    HTMLAnchorElement.prototype.click = vi.fn();
    // 默认让「等字体」空转（jsdom 没有真字体）；时序测试自己注入可控 Promise
    Object.defineProperty(document, "fonts", { configurable: true, value: undefined });

    // 生产代码不把 <a> 挂到 DOM，故通过 createElement spy 捕获以断言
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tag: string, opts?: unknown) => {
        const el = orig(tag, opts as never);
        if (tag === "a") capturedLink = el as HTMLAnchorElement;
        return el;
      }) as typeof document.createElement,
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    capturedLink = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exports PNG and triggers download with .png filename", async () => {
    const { container } = setupContainer();
    const ref = { current: container } as React.RefObject<HTMLElement | null>;
    const { result } = renderHook(() =>
      useExportImage({ containerRef: ref, title: "花非花" }),
    );

    await act(async () => {
      await result.current.exportPng();
    });

    expect(toPng).toHaveBeenCalledTimes(1);
    expect(toSvg).not.toHaveBeenCalled();
    expect(capturedLink).not.toBeNull();
    expect(capturedLink!.download).toMatch(/\.png$/);
    expect(capturedLink!.href).toBe("data:image/png;base64,AAAA");
    expect(capturedLink!.click).toHaveBeenCalled();
  });

  it("exports SVG and triggers download with .svg filename", async () => {
    const { container } = setupContainer();
    const ref = { current: container } as React.RefObject<HTMLElement | null>;
    const { result } = renderHook(() =>
      useExportImage({ containerRef: ref, title: "花非花" }),
    );

    await act(async () => {
      await result.current.exportSvg();
    });

    expect(toSvg).toHaveBeenCalledTimes(1);
    expect(toPng).not.toHaveBeenCalled();
    expect(capturedLink!.download).toMatch(/\.svg$/);
    expect(capturedLink!.href).toBe("data:image/svg+xml;base64,AAAA");
  });

  it("toggles export-footer visibility around rendering", async () => {
    const { container, footer } = setupContainer();
    const removeSpy = vi.spyOn(footer.classList, "remove");
    const addSpy = vi.spyOn(footer.classList, "add");
    const ref = { current: container } as React.RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useExportImage({ containerRef: ref }));

    await act(async () => {
      await result.current.exportPng();
    });

    // 渲染前显示页脚入画，finally 中恢复隐藏
    expect(removeSpy).toHaveBeenCalledWith("hidden");
    expect(addSpy).toHaveBeenCalledWith("hidden");
  });

  it("does nothing when container ref is null", async () => {
    const ref = { current: null } as React.RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useExportImage({ containerRef: ref }));

    await act(async () => {
      await result.current.exportPng();
    });

    expect(toPng).not.toHaveBeenCalled();
  });

  it("字体没加载完绝不开画：否则减字会静默变成普通汉字", async () => {
    const { container } = setupContainer();
    let resolveFonts!: () => void;
    const fontsReady = new Promise<void>((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: fontsReady },
    });

    const ref = { current: container } as React.RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useExportImage({ containerRef: ref }));

    let exportDone!: Promise<void>;
    await act(async () => {
      exportDone = result.current.exportPng();
      // 让 exportImage 的同步部分跑完，停在 await document.fonts.ready
      await Promise.resolve();
    });

    expect(toPng).not.toHaveBeenCalled();
    expect(toSvg).not.toHaveBeenCalled();
    expect(capturedLink).toBeNull();

    resolveFonts();
    await act(async () => {
      await exportDone;
    });

    expect(toPng).toHaveBeenCalledTimes(1);
    expect(capturedLink).not.toBeNull();
  });

  it("SVG 导出同样等字体（两条路径口径一致）", async () => {
    const { container } = setupContainer();
    let resolveFonts!: () => void;
    const fontsReady = new Promise<void>((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: fontsReady },
    });

    const ref = { current: container } as React.RefObject<HTMLElement | null>;
    const { result } = renderHook(() => useExportImage({ containerRef: ref }));

    let exportDone!: Promise<void>;
    await act(async () => {
      exportDone = result.current.exportSvg();
      await Promise.resolve();
    });

    expect(toSvg).not.toHaveBeenCalled();

    resolveFonts();
    await act(async () => {
      await exportDone;
    });
    expect(toSvg).toHaveBeenCalledTimes(1);
  });
});
