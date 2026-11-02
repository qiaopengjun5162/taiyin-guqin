/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/** 拨弦合成用假的记录器，只关心「按没按、按的是哪个频率」。 */
const pluck = vi.fn();
vi.mock("@/lib/audio-synth", () => ({
  schedulePluck: (...args: unknown[]) => pluck(...args),
}));

class FakeParam {
  value = 0;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}

class FakeNode {
  connect() {}
}

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = new FakeNode();
  static oscCount = 0;
  static stopCount = 0;
  createOscillator() {
    FakeAudioContext.oscCount += 1;
    return {
      type: "triangle",
      frequency: new FakeParam(),
      connect() {},
      start() {},
      stop() {
        FakeAudioContext.stopCount += 1;
      },
    };
  }
  createBiquadFilter() {
    return { type: "lowpass", frequency: new FakeParam(), Q: new FakeParam(), connect() {} };
  }
  createGain() {
    return { gain: new FakeParam(), connect() {} };
  }
  resume() {}
  close() {}
}

beforeEach(() => {
  pluck.mockClear();
  window.localStorage.clear();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

async function renderBoard() {
  const { QinBoard } = await import("@/components/qin-board");
  return render(<QinBoard />);
}

describe("琴面音位全览", () => {
  it("按音模式：91 个音位 + 七根空弦都在图上", async () => {
    await renderBoard();
    expect(screen.getAllByTestId("qin-board-dot")).toHaveLength(98);
    expect(screen.getByText(/按音 91 个位置/)).toBeInTheDocument();
  });

  it("点三弦七徽：响 F3，并把落点说清楚", async () => {
    await renderBoard();
    fireEvent.click(screen.getByLabelText("三弦七徽 F3"));

    expect(pluck).toHaveBeenCalledTimes(1);
    // schedulePluck(ctx, freq, when, duration, toneType)
    expect(pluck.mock.calls[0][1]).toBeCloseTo(174.61, 1);
    expect(pluck.mock.calls[0][4]).toBe("按");
    expect(screen.getByText(/三弦 · 七徽 · 按音/)).toBeInTheDocument();
    expect(screen.getByText(/174\.6 Hz/)).toBeInTheDocument();
  });

  it("点散音就是空弦，不按徽位算", async () => {
    await renderBoard();
    fireEvent.click(screen.getByLabelText("一弦散音 C2"));
    expect(pluck.mock.calls[0][1]).toBeCloseTo(65.41, 1);
    expect(pluck.mock.calls[0][4]).toBe("散");
  });

  it("切到泛音：三弦一徽是第 8 谐波 F5", async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "泛音" }));
    expect(screen.getByRole("button", { name: "泛音" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByLabelText("三弦一徽 F5"));
    expect(pluck.mock.calls[0][1]).toBeCloseTo(698.46, 1);
    expect(pluck.mock.calls[0][4]).toBe("泛");
  });

  it("点一个音，会说出同一音名在琴上还有几个位置", async () => {
    await renderBoard();
    fireEvent.click(screen.getByLabelText("三弦七徽 F3"));
    expect(screen.getByText(/F3 在这张琴上/)).toBeInTheDocument();
  });

  it("切到散音只剩七根空弦", async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "散音" }));
    expect(screen.getAllByTestId("qin-board-dot")).toHaveLength(7);
    expect(screen.getByText(/散音就是空弦/)).toBeInTheDocument();
  });

  it("没有音频设备时不报错，界面照常", async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        throw new Error("no audio");
      }
    };
    await renderBoard();
    expect(() => fireEvent.click(screen.getByLabelText("三弦七徽 F3"))).not.toThrow();
    expect(screen.getByText(/三弦 · 七徽 · 按音/)).toBeInTheDocument();
  });
});

/**
 * 走手音：按住左右拖，声音要跟着手指走。
 *
 * jsdom 里 getBoundingClientRect 恒为 0，组件会直接放弃坐标换算，
 * 所以这里先把 svg 的矩形按 viewBox 尺寸铺满，再模拟指针事件。
 */
describe("琴面 · 走手音", () => {
  const VIEW_W = 720;
  const VIEW_H = 320;
  const STRING_Y0 = 84;
  const STRING_GAP = 24;
  const STRING_X0 = 64;
  const STRING_X1 = 656;

  /** viewBox 坐标 → 屏幕坐标（rect 与 viewBox 等比，直接相等）。 */
  function at(stringIndex: number, ratio: number) {
    return {
      clientX: STRING_X0 + (STRING_X1 - STRING_X0) * ratio,
      clientY: STRING_Y0 + stringIndex * STRING_GAP,
    };
  }

  function boardSvg(container: HTMLElement): SVGSVGElement {
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("没找到琴面 svg");
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: VIEW_W, height: VIEW_H, right: VIEW_W, bottom: VIEW_H, x: 0, y: 0, toJSON() {} }),
    });
    return svg as SVGSVGElement;
  }

  beforeEach(() => {
    FakeAudioContext.oscCount = 0;
    FakeAudioContext.stopCount = 0;
  });

  it("按住拖过 6px 才开始走手音，松手收声", async () => {
    const { container } = await renderBoard();
    const svg = boardSvg(container);

    // 点下不动：不该起持续音（否则单击就没声了）
    fireEvent.pointerDown(svg, { ...at(2, 0.5), pointerId: 1 });
    expect(FakeAudioContext.oscCount).toBe(0);

    fireEvent.pointerMove(svg, { ...at(2, 0.55), pointerId: 1 });
    expect(FakeAudioContext.oscCount).toBe(1);

    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(FakeAudioContext.stopCount).toBe(1);
  });

  it("拖动时界面跟着报出当前落点", async () => {
    const { container } = await renderBoard();
    const svg = boardSvg(container);

    fireEvent.pointerDown(svg, { ...at(2, 0.42), pointerId: 2 });
    fireEvent.pointerMove(svg, { ...at(2, 0.5), pointerId: 2 });

    // 底部信息条从「点图上任意一点」换成具体弦位
    expect(screen.getByText(/三弦/)).toBeInTheDocument();
    expect(screen.queryByText(/点图上任意一点/)).not.toBeInTheDocument();
  });

  it("散音模式拖动不发声：空弦本来就没有走手", async () => {
    const { container } = await renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "散音" }));
    const svg = boardSvg(container);

    fireEvent.pointerDown(svg, { ...at(1, 0.4), pointerId: 3 });
    fireEvent.pointerMove(svg, { ...at(1, 0.8), pointerId: 3 });
    expect(FakeAudioContext.oscCount).toBe(0);
  });
});
