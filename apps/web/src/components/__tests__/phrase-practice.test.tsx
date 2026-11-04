/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhrasePractice } from "../phrase-practice";
import type { ScorePhrase } from "@/lib/score-phrases";

const PHRASES: ScorePhrase[] = [
  { start: 0, end: 3, noteCount: 4, beats: 4 },
  { start: 4, end: 9, noteCount: 6, beats: 8 },
];

function setup(overrides: Partial<Parameters<typeof PhrasePractice>[0]> = {}) {
  const props = {
    phrases: PHRASES,
    bpm: 120,
    tempo: 0.6,
    activeIndex: null as number | null,
    pass: null as number | null,
    repeat: 3,
    onTempoChange: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<PhrasePractice {...props} />) };
}

describe("PhrasePractice", () => {
  it("只有一句时不显示——整首播放按钮已经在上面", () => {
    const { container } = setup({ phrases: [PHRASES[0]] });
    expect(container.firstChild).toBeNull();
  });

  it("空谱也不显示", () => {
    const { container } = setup({ phrases: [] });
    expect(container.firstChild).toBeNull();
  });

  it("两句以上按句给按钮，点一句就慢练这一句", () => {
    const { props } = setup();

    expect(screen.getByLabelText("慢练第 1 句")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("慢练第 2 句"));
    expect(props.onStart).toHaveBeenCalledWith(1);
  });

  it("正在练的那一句再点一下就停", () => {
    const { props } = setup({ activeIndex: 1, pass: 1 });

    const button = screen.getByLabelText("停止慢练第 2 句");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(props.onStop).toHaveBeenCalled();
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it("练到第几遍要说出来，别让人猜循环还会不会继续", () => {
    setup({ activeIndex: 1, pass: 2 });
    expect(screen.getByText("第 2 句 · 6 个位置 · 第 2/3 遍")).toBeTruthy();
  });

  it("没在练时说清规则：几倍速、几遍、中间空的这一拍", () => {
    setup();
    expect(
      screen.getByText("点一句慢练：0.6× 连弹 3 遍，每遍之间空一拍"),
    ).toBeTruthy();
  });

  it("换倍速只换倍速，不打断正在练的那一句", () => {
    const { props } = setup({ activeIndex: 0, pass: 1 });

    fireEvent.click(screen.getByLabelText("慢练倍速 0.75×"));
    expect(props.onTempoChange).toHaveBeenCalledWith(0.75);
    expect(props.onStart).not.toHaveBeenCalled();
    expect(props.onStop).not.toHaveBeenCalled();
  });

  it("按钮上挂着这一句有多长（按当前倍速算）", () => {
    setup();
    // 第 2 句 8 拍，120 BPM、0.6× → 6.7 秒
    expect(screen.getByLabelText("慢练第 2 句").getAttribute("title")).toBe(
      "第 2 句 · 6 个位置 · 0.6× 约 6.7 秒",
    );
  });
});
