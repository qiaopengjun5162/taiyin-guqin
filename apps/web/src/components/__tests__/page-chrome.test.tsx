/**
 * @vitest-environment jsdom
 *
 * 页面框架里唯一带状态的一块（回到顶部）值得单独测：
 * 之前只靠真实浏览器手点验收，改动后容易静默退化。
 * 顺带把页内导航的锚点清单钉住，避免新增区块时漏配跳转。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BackToTop, SectionNav } from "@/components/page-chrome";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("回到顶部", () => {
  it("默认不出现，滚过约一屏后出现，点击平滑滚回顶部", () => {
    const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    render(<BackToTop />);
    expect(screen.queryByRole("button", { name: "回到顶部" })).not.toBeInTheDocument();

    Object.defineProperty(window, "scrollY", { value: 1000, configurable: true });
    fireEvent.scroll(window);
    const btn = screen.getByRole("button", { name: "回到顶部" });
    expect(btn).toBeInTheDocument();

    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    fireEvent.click(btn);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY);
    if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight);
  });
});

describe("页内导航", () => {
  it("八个区块锚点齐全且指向真实 id", () => {
    render(<SectionNav />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#score-area",
      "#keyboard-area",
      "#sec-console",
      "#sec-recognizer",
      "#sec-board",
      "#sec-tuner",
      "#sec-practice",
      "#sec-log",
    ]);
  });
});
