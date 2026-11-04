/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { NoteColumn } from "../types";
import { createEmptyState } from "../jianzi";
import {
  noteUnits,
  describeRanges,
  splitScorePhrases,
  useScorePhrases,
  phraseSeconds,
  describePhrase,
  joinRange,
  JOIN_REPEATS,
  PRACTICE_REPEATS,
  type ScorePhrase,
} from "../score-phrases";
import { splitPhrases } from "../taiyin-wasm";

// 真 WASM 由 CI 的 verify-wasm.mjs 与 Rust 单测守；这里只验前端接线。
vi.mock("@/lib/taiyin-wasm", () => ({
  splitPhrases: vi.fn(),
}));

const splitMock = vi.mocked(splitPhrases);

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

/** 四个四分音 + 一个二分音 + 两个四分音：二分之后应当切出第二句。 */
function twoPhraseScore(): NoteColumn[] {
  return [
    makeNote(),
    makeNote(),
    makeNote(),
    makeNote(),
    makeNote({ duration: "二分" }),
    makeNote(),
    makeNote(),
  ];
}

beforeEach(() => {
  splitMock.mockReset();
});

describe("noteUnits", () => {
  it("把时值换成 1/8 拍，附点算 1.5 倍", () => {
    expect(noteUnits(makeNote({ duration: "全" }))).toBe(32);
    expect(noteUnits(makeNote({ duration: "二分" }))).toBe(16);
    expect(noteUnits(makeNote({ duration: "四分" }))).toBe(8);
    expect(noteUnits(makeNote({ duration: "八分" }))).toBe(4);
    expect(noteUnits(makeNote({ duration: "十六分" }))).toBe(2);
    expect(noteUnits(makeNote({ duration: "四分", jianpuDot: true }))).toBe(12);
  });
});

describe("describeRanges", () => {
  it("按区间累加拍数，位置数含休止符", () => {
    const notes = [
      makeNote({ duration: "四分" }),
      makeNote({ jianpuNumber: "0", duration: "二分" }),
      makeNote({ duration: "八分", jianpuDot: true }),
    ];
    expect(describeRanges(notes, [{ start: 0, end: 2 }])).toEqual([
      { start: 0, end: 2, noteCount: 3, beats: 1 + 2 + 0.75 },
    ]);
    // 区间越界不抛错：老存档缺字段时宁可少算一拍，也别让整页崩掉
    expect(describeRanges(notes, [{ start: 2, end: 5 }])[0].beats).toBeCloseTo(0.75);
  });
});

describe("splitScorePhrases", () => {
  it("空谱不发请求，直接给空", async () => {
    await expect(splitScorePhrases([])).resolves.toEqual([]);
    expect(splitMock).not.toHaveBeenCalled();
  });

  it("把每个音的时值交给 Rust，再把句界补成带拍数的一句", async () => {
    splitMock.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ]);
    const notes = twoPhraseScore();
    const phrases = await splitScorePhrases(notes);

    expect(splitMock).toHaveBeenCalledWith([8, 8, 8, 8, 16, 8, 8]);
    expect(phrases).toEqual([
      { start: 0, end: 3, noteCount: 4, beats: 4 },
      { start: 4, end: 6, noteCount: 3, beats: 4 },
    ]);
  });
});

describe("useScorePhrases", () => {
  it("切句回来后给出结果", async () => {
    splitMock.mockResolvedValue([{ start: 0, end: 1 }]);
    const notes = twoPhraseScore();
    const { result } = renderHook(() => useScorePhrases(notes));

    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toHaveLength(1));
  });

  it("谱面一变就不再用旧句界——哪怕新的还没算完", async () => {
    splitMock.mockResolvedValue([{ start: 0, end: 3 }]);
    const before = twoPhraseScore();
    const { result, rerender } = renderHook(
      ({ notes }: { notes: NoteColumn[] }) => useScorePhrases(notes),
      { initialProps: { notes: before } },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));

    // 新谱的切句挂起：这一瞬间既不能留着旧句界（会指向别的音），也不能猜
    let release: (v: { start: number; end: number }[]) => void = () => {};
    splitMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const after = [makeNote(), makeNote()];
    rerender({ notes: after });
    expect(result.current).toEqual([]);

    release([{ start: 0, end: 1 }]);
    await waitFor(() => expect(result.current).toEqual([
      expect.objectContaining({ start: 0, end: 1, noteCount: 2 }),
    ]));
  });

  it("切句失败时安静地不显示，不让整页挂掉", async () => {
    splitMock.mockRejectedValue(new Error("wasm 未就绪"));
    const notes = twoPhraseScore();
    const { result } = renderHook(() => useScorePhrases(notes));
    // 等到 promise 落地后再断言，避免「其实还没跑完」的假通过
    await waitFor(() => expect(splitMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toEqual([]));
  });
});

describe("时长口径", () => {
  const phrase: ScorePhrase = { start: 0, end: 5, noteCount: 6, beats: 8 };

  it("按拍数算秒，慢练倍率直接放大时值", () => {
    expect(phraseSeconds(phrase, 120)).toBeCloseTo(4);
    expect(phraseSeconds(phrase, 120, 0.5)).toBeCloseTo(8);
    // 非法输入给 0 而不是 NaN/Infinity——界面上出现 NaN 秒比不显示更糟
    expect(phraseSeconds(phrase, 0)).toBe(0);
    expect(phraseSeconds(phrase, 120, 0)).toBe(0);
  });

  it("一句话说清这一句多长", () => {
    expect(describePhrase(phrase, 2, 120, 0.6)).toBe(
      "第 3 句 · 6 个位置 · 0.6× 约 6.7 秒",
    );
    // 超过十秒取整：练琴的人不需要 12.7 秒这种精度
    expect(describePhrase(phrase, 0, 60, 0.6)).toBe("第 1 句 · 6 个位置 · 0.6× 约 13 秒");
  });

  it("连弹遍数是 3：一遍听、两遍跟、三遍记", () => {
    expect(PRACTICE_REPEATS).toBe(3);
  });
});

describe("合练区间", () => {
  const three: ScorePhrase[] = [
    { start: 0, end: 3, noteCount: 4, beats: 4 },
    { start: 4, end: 9, noteCount: 6, beats: 8 },
    { start: 10, end: 12, noteCount: 3, beats: 4 },
  ];

  it("往后接：跨过这一句和下一句之间的那个气口", () => {
    expect(joinRange(three, 0)).toEqual({ from: 0, to: 1, start: 0, end: 9 });
    expect(joinRange(three, 1)).toEqual({ from: 1, to: 2, start: 4, end: 12 });
  });

  it("末句没有下一句，就往前接上一句", () => {
    expect(joinRange(three, 2)).toEqual({ from: 1, to: 2, start: 4, end: 12 });
  });

  it("只有一句、空谱、下标越界都返回 null，不猜一个区间出来", () => {
    expect(joinRange([three[0]], 0)).toBeNull();
    expect(joinRange([], 0)).toBeNull();
    expect(joinRange(three, 3)).toBeNull();
    expect(joinRange(three, -1)).toBeNull();
  });

  it("合练走两遍：一遍跨气口、一遍确认不是碰巧", () => {
    expect(JOIN_REPEATS).toBe(2);
    expect(JOIN_REPEATS).toBeLessThan(PRACTICE_REPEATS);
  });
});
