/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { JianziBlock } from "../jianzi-block";
import { createEmptyState } from "@/lib/jianzi";
import type { JianziState } from "@/lib/types";

function make(overrides: Partial<JianziState> = {}): JianziState {
  return { ...createEmptyState(), ...overrides };
}

describe("JianziBlock", () => {
  it("renders text via GSUB font for 散音", () => {
    const s = make({ toneType: "散", rightAction: "勹", stringNumber: "五" });
    const { container } = render(<JianziBlock state={s} />);
    const span = container.querySelector("span");
    expect(span?.textContent).toBe("散勾五");
  });

  it("renders SVG for 泛音 (needsSvg)", () => {
    const s = make({ toneType: "泛", leftFinger: "大", hui: "十", rightAction: "勹", stringNumber: "三" });
    const { container } = render(<JianziBlock state={s} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders SVG for 打 (丁)", () => {
    const s = make({ toneType: "散", rightAction: "丁", stringNumber: "一" });
    const { container } = render(<JianziBlock state={s} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders SVG for 摘 (倽)", () => {
    const s = make({ toneType: "散", rightAction: "倽", stringNumber: "一" });
    const { container } = render(<JianziBlock state={s} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("compact mode hides toneType in GSUB branch", () => {
    const s = make({ toneType: "散", rightAction: "勹", stringNumber: "五" });
    const { container } = render(<JianziBlock state={s} compact />);
    expect(container.querySelector("span")?.textContent).toBe("勾五");
  });

  it("returns null for empty state", () => {
    const { container } = render(<JianziBlock state={createEmptyState()} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses SVG branch for 名 finger in 泛音", () => {
    const s = make({ toneType: "泛", leftFinger: "夕", hui: "九", rightAction: "勹", stringNumber: "四" });
    const { container } = render(<JianziBlock state={s} />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe("JianziBlock 走手音分支", () => {
  it("普通按音走字体，序列化里把绰排在分数之后", () => {
    const s = make({
      toneType: "按", leftFinger: "大", hui: "九", fen: "六分",
      slide: "绰", rightAction: "勹", stringNumber: "四",
    });
    const { container } = render(<JianziBlock state={s} />);
    expect(container.querySelector("span")?.textContent).toBe("大九六绰勾四");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("「抹」+ 走手音走 SVG（字体没有这个连字，实测会散成 1.5em）", () => {
    const s = make({
      toneType: "按", leftFinger: "大", hui: "九",
      slide: "绰", rightAction: "木", stringNumber: "四",
    });
    const { container } = render(<JianziBlock state={s} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("旧存档没有 slide 字段时，「抹」仍走字体（不能误降级）", () => {
    const legacy = make({
      toneType: "按", leftFinger: "名", hui: "九", rightAction: "木", stringNumber: "四",
    });
    // 模拟旧 JSON：字段整个不存在
    delete (legacy as unknown as Record<string, unknown>).slide;
    const { container } = render(<JianziBlock state={legacy} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("span")?.textContent).toBe("名九抹四");
  });
});

describe("JianziBlock 急（急弹记号）", () => {
  it("急 走字体，序列化排在分数之后", () => {
    const s = make({
      toneType: "按", leftFinger: "大", hui: "九", fen: "六分",
      slide: "急", rightAction: "勹", stringNumber: "四",
    });
    const { container } = render(<JianziBlock state={s} />);
    expect(container.querySelector("span")?.textContent).toBe("大九六急勾四");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("「抹」+ 急 也走 SVG（与绰/注 同一条降级规则，实测 1.5em）", () => {
    const s = make({
      toneType: "按", leftFinger: "大", hui: "九",
      slide: "急", rightAction: "木", stringNumber: "四",
    });
    const { container } = render(<JianziBlock state={s} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
