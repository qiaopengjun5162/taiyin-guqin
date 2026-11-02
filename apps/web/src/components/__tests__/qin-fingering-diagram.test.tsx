/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { QinFingeringDiagram } from "../qin-fingering-diagram";
import { createEmptyState } from "@/lib/jianzi";
import type { JianziState } from "@/lib/types";

function make(overrides: Partial<JianziState> = {}): JianziState {
  return { ...createEmptyState(), ...overrides };
}

const anYin = make({
  toneType: "按",
  leftFinger: "大",
  hui: "九",
  fen: "六分",
  rightAction: "勹",
  stringNumber: "四",
});

describe("QinFingeringDiagram", () => {
  it("按音：画出琴面、七弦与本位，按点比例透出到 DOM 供核对", () => {
    const { container } = render(<QinFingeringDiagram state={anYin} />);
    const svg = container.querySelector('[data-testid="qin-fingering-diagram"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("data-string")).toBe("4");
    expect(Number(svg?.getAttribute("data-press-ratio"))).toBeCloseTo(0.7167, 3);

    // 七根弦各一条线（另有十三徽刻度线、岳山龙龈等，故只数带 key 的弦组）
    const stringGroups = svg!.querySelectorAll("g");
    expect(stringGroups.length).toBeGreaterThanOrEqual(7);
  });

  it("按音画实心点、泛音画空心菱形——虚按与按实不能长一个样", () => {
    const pressed = render(<QinFingeringDiagram state={anYin} />).container;
    expect(pressed.querySelectorAll("circle").length).toBeGreaterThan(0);
    expect(pressed.querySelectorAll("rect[transform]").length).toBe(0);

    const harmonic = render(
      <QinFingeringDiagram state={{ ...anYin, toneType: "泛", leftFinger: "中" }} />,
    ).container;
    expect(harmonic.querySelectorAll("rect[transform]").length).toBe(1);
  });

  it("散音：整根弦亮着，标「散」，没有按点", () => {
    const { container } = render(
      <QinFingeringDiagram state={make({ toneType: "散", rightAction: "勹", stringNumber: "五" })} />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("data-press-ratio")).toBe("");
    expect(svg.textContent).toContain("散");
    expect(svg.querySelectorAll("circle").length).toBe(0);
  });

  it("缺弦时整块不渲染，不留一张空图", () => {
    const { container } = render(<QinFingeringDiagram state={make({ toneType: "按", hui: "九" })} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("读屏拿到的是一句能听的描述", () => {
    const { container } = render(<QinFingeringDiagram state={anYin} />);
    const label = container.querySelector("svg")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("四弦");
    expect(label).toContain("大指");
    expect(label).toContain("中指");
  });
});
