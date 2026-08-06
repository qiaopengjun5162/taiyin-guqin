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
