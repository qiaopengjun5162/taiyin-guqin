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
  createOscillator() {
    return { type: "triangle", frequency: new FakeParam(), connect() {}, start() {}, stop() {} };
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
