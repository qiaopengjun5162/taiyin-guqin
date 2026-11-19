/**
 * @vitest-environment jsdom
 *
 * `usePhrasePractice` —— 逐句慢练一簇的状态机。
 *
 * 这里要守的是三条**不会报错、只会悄悄错**的规则（都写在 hook 的文档注释里）：
 *
 * 1. 记账用「实际走的那一档」（`practicePlay.tempo`），不是手边拨到的档。
 *    档位播放中可拨且不打断这一遍，两者走完之后可能已经不同。
 * 2. 合练的档取两句里更慢的那句，且**不写回** `practiceTempo`。
 * 3. 「只升不降」：判定一遍低档不能把已练到的高档打回去。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { usePhrasePractice } from "../use-phrase-practice";
import type { NoteColumn } from "../types";
import { createEmptyState } from "../jianzi";

/**
 * 句界由 Rust 切（`split_phrases_to_json`），且 `useScorePhrases` 是**异步**的
 * （效果里等 WASM）。所以这一套用例必须装载真实产物，否则永远只有一句空结果。
 */
beforeAll(async () => {
  const bytes = readFileSync(
    resolve(__dirname, "../../../wasm/taiyin_core_bg.wasm"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("taiyin_core_bg.wasm")) {
        return new Response(bytes, {
          status: 200,
          headers: { "Content-Type": "application/wasm" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const { initWasmSync } = await import("../taiyin-wasm");
  await initWasmSync();
});

function makeNote(id: string): NoteColumn {
  return {
    id,
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: {
      ...createEmptyState(),
      toneType: "散",
      rightAction: "勹",
      stringNumber: "五",
    },
  };
}

/**
 * 造一段有两句的谱：`useScorePhrases` 按「留足两拍即气口」切句，
 * 所以二分音符之后即是句界。
 */
function twoPhraseScore(): NoteColumn[] {
  return [
    makeNote("a1"),
    makeNote("a2"),
    { ...makeNote("b1"), duration: "二分" },
    makeNote("b2"),
    makeNote("b3"),
  ];
}

function baseOptions(score: NoteColumn[], overrides: Record<string, unknown> = {}) {
  return {
    score,
    currentScoreId: null,
    scoreTitle: "测试曲",
    play: vi.fn(),
    stopPlayback: vi.fn(),
    metronomeRunning: false,
    stopMetronome: vi.fn(),
    isPlaying: false,
    practicePass: null,
    ...overrides,
  };
}

beforeEach(() => {
  // 进度存在 localStorage 里，用例之间必须清干净，否则「只升不降」会被上一条用例污染
  window.localStorage.clear();
});

describe("usePhrasePractice · 慢练起播", () => {
  it("点某一句时停播放器、停节拍器，并把区间与遍数交给播放器", async () => {
    const opts = baseOptions(twoPhraseScore(), { metronomeRunning: true });
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    // 句界是异步切的，先等它落地
    await waitFor(() => expect(result.current.scorePhrases.length).toBeGreaterThan(0));

    act(() => {
      result.current.practicePhrase(0, 0.6);
    });

    expect(opts.stopPlayback).toHaveBeenCalled();
    expect(opts.stopMetronome).toHaveBeenCalled();
    expect(opts.play).toHaveBeenCalledTimes(1);
    const [start, range] = (opts.play as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof start).toBe("number");
    expect(range.tempo).toBe(0.6);
    expect(result.current.practiceIndex).toBe(0);
    expect(result.current.practiceTempo).toBe(0.6);
  });

  it("句界越界时什么都不做（不硬凑一句）", () => {
    const opts = baseOptions(twoPhraseScore());
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    act(() => {
      result.current.practicePhrase(99, 0.6);
    });

    expect(opts.play).not.toHaveBeenCalled();
    expect(result.current.practiceIndex).toBeNull();
  });
});

describe("usePhrasePractice · 记账用实际走的档", () => {
  it("播放中把档位拨到 1×，走完仍按 0.6 记（不是手边那一档）", async () => {
    const opts = baseOptions(twoPhraseScore());
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    await waitFor(() => expect(result.current.scorePhrases.length).toBeGreaterThan(0));

    // 以 0.6 起这一遍
    act(() => {
      result.current.practicePhrase(0, 0.6);
    });
    // 播放中把面板档位拨到 1×（不打断这一遍）
    act(() => {
      result.current.setPracticeTempo(1);
    });
    // 这一遍走完
    act(() => {
      result.current.handlePracticeEnd();
    });

    const values = Object.values(result.current.phraseProgress);
    expect(values.length).toBeGreaterThan(0);
    // 记的是「实际走的 0.6」——若错记成手边的 1×，这里会是 1
    expect(values.every((v) => v <= 0.6 + 1e-9)).toBe(true);
  });

  it("没选句子时走完不回记账", () => {
    const opts = baseOptions(twoPhraseScore());
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    act(() => {
      result.current.handlePracticeEnd();
    });

    expect(Object.keys(result.current.phraseProgress)).toHaveLength(0);
  });
});

describe("usePhrasePractice · 合练", () => {
  it("合练不改动手选的档位", () => {
    const opts = baseOptions(twoPhraseScore());
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    act(() => {
      result.current.practicePhrase(0, 0.8);
    });
    const before = result.current.practiceTempo;

    act(() => {
      result.current.practiceJoin();
    });

    // 合练档是两句算出来的，不该写回手选档
    expect(result.current.practiceTempo).toBe(before);
  });

  it("没有可选句子时合练什么都不做", () => {
    const opts = baseOptions(twoPhraseScore());
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    act(() => {
      result.current.practiceJoin();
    });

    expect(opts.play).not.toHaveBeenCalled();
  });
});

describe("usePhrasePractice · 只升不降", () => {
  it("判定一遍低档不会把已练到的高档打回去", () => {
    const opts = baseOptions(twoPhraseScore());
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    act(() => {
      result.current.practicePhrase(0, 0.9);
    });
    act(() => {
      result.current.handlePracticeEnd();
    });
    const afterHigh = { ...result.current.phraseProgress };

    // 判定通过，但只报了 0.6
    act(() => {
      result.current.handleFollowPass(0.6);
    });

    expect(result.current.phraseProgress).toEqual(afterHigh);
  });
});

describe("usePhrasePractice · 停止", () => {
  it("停止练习会清掉当前句与播放区间", () => {
    const opts = baseOptions(twoPhraseScore());
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    act(() => {
      result.current.practicePhrase(0, 0.6);
    });
    act(() => {
      result.current.stopPractice();
    });

    expect(result.current.practiceIndex).toBeNull();
    expect(opts.stopPlayback).toHaveBeenCalled();
  });
});

describe("usePhrasePractice · 高亮只在慢练时", () => {
  it("整首播放（practicePass 为 null）不给慢练高亮", () => {
    const opts = baseOptions(twoPhraseScore(), { isPlaying: true, practicePass: null });
    const { result } = renderHook(() => usePhrasePractice(opts as never));

    act(() => {
      result.current.practicePhrase(0, 0.6);
    });

    expect(result.current.activePracticeIndex).toBeNull();
  });
});
