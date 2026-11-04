/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhrasePractice } from "../phrase-practice";
import type { ScorePhrase } from "@/lib/score-phrases";
import { TEMPO_LADDER } from "@/lib/practice-progress";

const PHRASES: ScorePhrase[] = [
  { start: 0, end: 3, noteCount: 4, beats: 4 },
  { start: 4, end: 9, noteCount: 6, beats: 8 },
];

/** 第 1 句的进度键（与 `phraseKey` 同构，写死是为了让测试能独立发现问题）。 */
const KEY_0 = "0-3-4";
const KEY_1 = "4-9-6";

function setup(overrides: Partial<Parameters<typeof PhrasePractice>[0]> = {}) {
  const props = {
    phrases: PHRASES,
    bpm: 120,
    tempo: 0.6,
    activeIndex: null as number | null,
    selectedIndex: null as number | null,
    pass: null as number | null,
    repeat: 3,
    progress: {},
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

  it("两句以上按句给按钮，点一句就按当前档位慢练这一句", () => {
    const { props } = setup();

    expect(screen.getByLabelText("慢练第 1 句")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("慢练第 2 句"));
    // 档位跟着一起给：同一次事件里读 state 会读到旧值
    expect(props.onStart).toHaveBeenCalledWith(1, 0.6);
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

  it("没在练时说清规则：几倍速、几遍、起手前那两拍", () => {
    setup();
    expect(
      screen.getByText("点一句慢练：0.6× 连弹 3 遍，起手前空两拍"),
    ).toBeTruthy();
  });

  it("档位等距 0.1：再快一档才不会有时是 +0.1、有时是 +0.15", () => {
    setup();
    for (const t of TEMPO_LADDER) {
      expect(screen.getByLabelText(`慢练倍速 ${t}×`)).toBeTruthy();
    }
    expect(TEMPO_LADDER).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it("换倍速只换倍速，不打断正在练的那一句", () => {
    const { props } = setup({ activeIndex: 0, pass: 1 });

    fireEvent.click(screen.getByLabelText("慢练倍速 0.8×"));
    expect(props.onTempoChange).toHaveBeenCalledWith(0.8);
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

  it("过了原速的句子自己带标记，右边给总账", () => {
    setup({ progress: { [KEY_0]: 1 } });
    expect(screen.getByLabelText("慢练第 1 句 · 已过原速")).toBeTruthy();
    expect(screen.getByText("已过 1/2")).toBeTruthy();
  });

  it("练到 0.8× 时直说成绩与下一档，按一下就从 0.9× 重来", () => {
    const { props } = setup({
      selectedIndex: 1,
      progress: { [KEY_1]: 0.8 },
    });

    expect(screen.getByText("第 2 句练到 0.8×，再快一档 0.9×")).toBeTruthy();
    fireEvent.click(screen.getByText("再快一档"));
    expect(props.onStart).toHaveBeenCalledWith(1, 0.9);
  });

  it("「再快一档」从记下的成绩往上加，不跟着手滑拨低的档位退回去", () => {
    const { props } = setup({
      tempo: 0.6,
      selectedIndex: 0,
      progress: { [KEY_0]: 0.8 },
    });

    fireEvent.click(screen.getByText("再快一档"));
    expect(props.onStart).toHaveBeenCalledWith(0, 0.9);
  });

  it("到了原速就换下一句，从最慢的 0.6× 起——生地方不能用熟速度试", () => {
    const { props } = setup({
      selectedIndex: 0,
      tempo: 1,
      progress: { [KEY_0]: 1 },
    });

    expect(screen.getByText("第 1 句已到原速")).toBeTruthy();
    fireEvent.click(screen.getByText("接着练第 2 句"));
    expect(props.onStart).toHaveBeenCalledWith(1, 0.6);
  });

  it("全曲都过了就直说，不再给一个没处去的按钮", () => {
    setup({
      selectedIndex: 1,
      progress: { [KEY_0]: 1, [KEY_1]: 1 },
    });

    expect(screen.getByText("第 2 句已到原速 · 全曲都过了")).toBeTruthy();
    expect(screen.queryByText(/接着练第/)).toBeNull();
    expect(screen.queryByText("再快一档")).toBeNull();
  });

  it("点开就停（一遍都没走完）不冒成绩，只提醒再点一次", () => {
    setup({ selectedIndex: 1, progress: {} });
    expect(
      screen.getByText("第 2 句还没走完一遍——再点一次它"),
    ).toBeTruthy();
    expect(screen.queryByText("再快一档")).toBeNull();
  });
});
