/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMetronome } from "../use-metronome";

const startedFreqs: number[] = [];
let now = 0;

class FakeAudioContext {
  sampleRate = 44100;
  state: AudioContextState = "running";
  destination = {};
  get currentTime() {
    return now;
  }
  createOscillator() {
    const osc = {
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(() => startedFreqs.push(osc.frequency.value)),
      stop: vi.fn(),
    };
    return osc as unknown as OscillatorNode;
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    } as unknown as GainNode;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

describe("useMetronome", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.useFakeTimers();
    startedFreqs.length = 0;
    now = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("schedules accented downbeat then normal beats, stops cleanly", async () => {
    const { result } = renderHook(() => useMetronome(4));

    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    expect(result.current.isRunning).toBe(true);

    // 第一次 tick：调度第 1 拍（强拍 2000Hz）
    act(() => {
      vi.advanceTimersByTime(25);
    });
    expect(startedFreqs).toEqual([2000]);

    // 第 2 拍（弱拍 1200Hz）
    act(() => {
      now = 0.5;
      vi.advanceTimersByTime(25);
    });
    expect(startedFreqs).toEqual([2000, 1200]);

    // 第 3、4 拍（弱拍）
    act(() => {
      now = 1.5;
      vi.advanceTimersByTime(25);
    });
    expect(startedFreqs).toEqual([2000, 1200, 1200, 1200]);

    // 第 5 拍 = 下一小节强拍
    act(() => {
      now = 2.0;
      vi.advanceTimersByTime(25);
    });
    expect(startedFreqs.at(-1)).toBe(2000);

    // 停止后不再调度
    const count = startedFreqs.length;
    act(() => {
      result.current.stop();
      now = 3.0;
      vi.advanceTimersByTime(100);
    });
    expect(result.current.isRunning).toBe(false);
    expect(startedFreqs.length).toBe(count);
  });

  it("toggle switches between start and stop", async () => {
    const { result } = renderHook(() => useMetronome(4));

    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    expect(result.current.isRunning).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isRunning).toBe(false);
  });
});
