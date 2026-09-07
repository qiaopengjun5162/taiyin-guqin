/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScorePlayer } from "../use-score-player";
import { createEmptyState } from "@/lib/jianzi";
import type { NoteColumn } from "../types";

function makeNote(overrides: Partial<NoteColumn> = {}): NoteColumn {
  return {
    id: crypto.randomUUID(),
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: createEmptyState(),
    ...overrides,
  };
}

const startMock = vi.fn();
const stopMock = vi.fn();

class FakeAudioContext {
  sampleRate = 44100;
  currentTime = 0;
  state: AudioContextState = "running";
  destination = {};
  createBuffer(_ch: number, len: number, _sampleRate: number) {
    void _sampleRate;
    return { getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer;
  }
  createBufferSource() {
    return {
      buffer: null,
      connect: vi.fn(),
      start: startMock,
      stop: stopMock,
    } as unknown as AudioBufferSourceNode;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

describe("useScorePlayer", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    startMock.mockClear();
    stopMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays audible notes and skips rests, then stops", async () => {
    const notes = [
      makeNote({ jianpuNumber: "5" }),
      makeNote({ jianpuNumber: "0" }), // 休止符不发声
      makeNote({ jianpuNumber: "6" }),
    ];
    const { result } = renderHook(() => useScorePlayer(notes));

    await act(async () => {
      await result.current.play();
    });

    expect(result.current.isPlaying).toBe(true);
    // 两个有声音符各触发一次 pluck
    expect(startMock).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.stop();
    });
    expect(result.current.isPlaying).toBe(false);
    expect(stopMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing with empty score", async () => {
    const { result } = renderHook(() => useScorePlayer([]));
    await act(async () => {
      await result.current.play();
    });
    expect(result.current.isPlaying).toBe(false);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("advances playingIndex per note and resets on stop", async () => {
    vi.useFakeTimers();
    try {
      const notes = [
        makeNote({ jianpuNumber: "5" }),
        makeNote({ jianpuNumber: "6", duration: "八分" }),
      ];
      const { result } = renderHook(() => useScorePlayer(notes));

      await act(async () => {
        await result.current.play();
      });
      expect(result.current.playingIndex).toBeNull();

      // 第一音在 t0+0.05s 亮起
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(result.current.playingIndex).toBe(0);

      // 第二音（四分=0.5s 后）
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(result.current.playingIndex).toBe(1);

      // 整首结束（音符时值 0.5+0.25s + 按音音色尾长 0.5s + 余量）后自动复位
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(result.current.playingIndex).toBeNull();
      expect(result.current.isPlaying).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops playback when notes change", async () => {
    const notes = [makeNote({ jianpuNumber: "5" })];
    const { result, rerender } = renderHook(
      ({ notes }: { notes: NoteColumn[] }) => useScorePlayer(notes),
      { initialProps: { notes } },
    );

    await act(async () => {
      await result.current.play();
    });
    expect(result.current.isPlaying).toBe(true);

    rerender({ notes: [makeNote({ jianpuNumber: "6" })] });
    expect(result.current.isPlaying).toBe(false);
  });

  it("starts playback from a given startIndex", async () => {
    vi.useFakeTimers();
    try {
      const notes = [
        makeNote({ jianpuNumber: "5", duration: "四分" }),
        makeNote({ jianpuNumber: "6", duration: "四分" }),
        makeNote({ jianpuNumber: "1", duration: "四分" }),
      ];
      const { result } = renderHook(() => useScorePlayer(notes));

      await act(async () => {
        await result.current.play(1);
      });
      expect(result.current.isPlaying).toBe(true);
      // 从索引 1 起播，应跳过第一个有声音符，仅排程后两个
      expect(startMock).toHaveBeenCalledTimes(2);

      // 高亮应从索引 1 开始，而非 0
      act(() => {
        vi.advanceTimersByTime(60);
      });
      expect(result.current.playingIndex).toBe(1);

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(result.current.playingIndex).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
