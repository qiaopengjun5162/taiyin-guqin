/**
 * 单音试听 hook：AudioContext 生命周期 + 与合成器的接线。
 *
 * 这里刻意 mock 掉 `jianzi-pitch` / `audio-synth` / `jianzi`——本 hook 的职责是
 * 「推不出音高就拒绝、推得出就用同一个 AudioContext 调 schedulePluck」，
 * 音高推算和拨弦合成各有各的测试，不在这里重复。
 *
 * AudioContext 假对象沿用 use-score-player.test.ts 的打法：stub 类本体。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { jianziToFrequency, schedulePluck, pitchSlide } = vi.hoisted(() => ({
  jianziToFrequency: vi.fn(),
  schedulePluck: vi.fn(),
  pitchSlide: vi.fn(() => null),
}));

vi.mock("../jianzi-pitch", () => ({ jianziToFrequency }));
vi.mock("../audio-synth", () => ({ schedulePluck }));
vi.mock("../jianzi", () => ({ pitchSlide }));

import { useNotePreview } from "../use-note-preview";
import type { JianziState } from "../types";

/** 构造过的实例，用来断言「一个 hook 只建一个 AudioContext」。 */
const created: FakeAudioContext[] = [];

class FakeAudioContext {
  state: string = "running";
  currentTime = 1;
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  constructor() {
    created.push(this);
  }
}

const STUB = { toneType: "san", slide: null } as unknown as JianziState;

beforeEach(() => {
  vi.clearAllMocks();
  created.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useNotePreview", () => {
  it("推不出音高的谱字返回 false，且不碰音频上下文", () => {
    jianziToFrequency.mockReturnValue(null);
    const { result } = renderHook(() => useNotePreview());
    expect(result.current(STUB)).toBe(false);
    expect(created).toHaveLength(0);
    expect(schedulePluck).not.toHaveBeenCalled();
  });

  it("正常音：建上下文、调 schedulePluck，并且回收再用同一个上下文", () => {
    jianziToFrequency.mockReturnValue(440);
    const { result } = renderHook(() => useNotePreview());
    expect(result.current(STUB)).toBe(true);
    expect(result.current(STUB)).toBe(true);
    // 同一个 hook 实例只建一次 AudioContext
    expect(created).toHaveLength(1);
    expect(schedulePluck).toHaveBeenCalledTimes(2);
    // 起音留 0.02s 余量；音色与走手音按谱字传给合成器
    expect(schedulePluck.mock.calls[0][2]).toBeCloseTo(1.02, 6);
    expect(schedulePluck.mock.calls[0][4]).toBe("san");
    expect(pitchSlide).toHaveBeenCalledWith(STUB.slide);
  });

  it("宿主不给开音频（构造抛错）时返回 false，不炸", () => {
    jianziToFrequency.mockReturnValue(440);
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("not allowed");
        }
      },
    );
    const { result } = renderHook(() => useNotePreview());
    expect(result.current(STUB)).toBe(false);
    expect(schedulePluck).not.toHaveBeenCalled();
  });

  it("被挂起的上下文先 resume 再播", () => {
    jianziToFrequency.mockReturnValue(440);
    const { result } = renderHook(() => useNotePreview());
    // 建好后把状态改成挂起，再播一次
    expect(result.current(STUB)).toBe(true);
    created[0].state = "suspended";
    expect(result.current(STUB)).toBe(true);
    expect(created[0].resume).toHaveBeenCalledTimes(1);
  });

  it("卸载时关掉音频上下文，不留悬挂资源", () => {
    jianziToFrequency.mockReturnValue(440);
    const { result, unmount } = renderHook(() => useNotePreview());
    expect(result.current(STUB)).toBe(true);
    unmount();
    expect(created[0].close).toHaveBeenCalledTimes(1);
  });

  it("定弦或基准音变了会换新回调（重新计入依赖）", () => {
    jianziToFrequency.mockReturnValue(440);
    const { result, rerender } = renderHook(({ t, p }) => useNotePreview(t, p), {
      initialProps: { t: "zhengdiao" as const, p: 440 },
    });
    const first = result.current;
    rerender({ t: "zhengdiao", p: 440 });
    expect(result.current).toBe(first);
    rerender({ t: "ruibin", p: 442 });
    expect(result.current).not.toBe(first);
  });
});
