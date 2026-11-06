/**
 * 小节切分的行为钉子。
 *
 * 这套规则是从 `ScoreView` 原有的渲染循环里搬出来的，所以每条用例都对应
 * 一处"搬错就会静默错位"的边界。小节线错位不会报错，只会让整张谱看起来
 * 每小节少一拍/多一拍——只能靠这些用例挡住。
 */
import { describe, it, expect } from "vitest";
import {
  groupIntoBars,
  equalBarWidth,
  beatsPerBarFromLabel,
  NOTE_COLUMN_WIDTH,
  NOTE_COLUMN_GAP,
} from "../score-bars";
import { createEmptyState } from "../jianzi";
import type { NoteColumn, Duration } from "../types";

function makeNote(duration: Duration = "四分", dotted = false): NoteColumn {
  return {
    id: crypto.randomUUID(),
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: dotted,
    duration,
    jianzi: {
      ...createEmptyState(),
      toneType: "散",
      rightAction: "勹",
      stringNumber: "五",
    },
  };
}

function bars(...shapes: number[]): NoteColumn[][] {
  return shapes.map((n) => Array.from({ length: n }, () => makeNote()));
}

describe("groupIntoBars", () => {
  it("4/4 下八个四分音符切成两节", () => {
    const result = groupIntoBars(bars(8).flat(), 4);
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.notes.length)).toEqual([4, 4]);
    expect(result.map((b) => b.startIndex)).toEqual([0, 4]);
  });

  it("不足一节也要收口（不能丢音）", () => {
    const result = groupIntoBars(bars(3).flat(), 4);
    expect(result).toHaveLength(1);
    expect(result[0].notes).toHaveLength(3);
  });

  it("正好填满时收口于本音之后，不把音推到下一节", () => {
    // 二分(2拍) + 二分(2拍) 在 4/4 下正好满一节
    const notes = [makeNote("二分"), makeNote("二分"), makeNote("四分")];
    const result = groupIntoBars(notes, 4);
    expect(result.map((b) => b.notes.length)).toEqual([2, 1]);
    expect(result[1].startIndex).toBe(2);
  });

  it("会越界时先收口，本音另起一节", () => {
    // 四分+四分+二分 = 4 拍满；再一个二分只能另起
    const notes = [
      makeNote("四分"),
      makeNote("四分"),
      makeNote("二分"),
      makeNote("二分"),
    ];
    const result = groupIntoBars(notes, 4);
    expect(result.map((b) => b.notes.length)).toEqual([3, 1]);
  });

  it("单音比一节还长时独占一节，不会被后续音塞满", () => {
    // 3/4 里放一个全音符（4 拍）：它已经超了，后一个四分必须另起
    const notes = [makeNote("全"), makeNote("四分")];
    const result = groupIntoBars(notes, 3);
    expect(result).toHaveLength(2);
    expect(result[0].notes).toHaveLength(1);
    expect(result[1].notes).toHaveLength(1);
  });

  it("附点音按 1.5 倍拍数参与切分", () => {
    // 附点四分 = 1.5 拍；4/4 下：1.5*2=3，再加 1.5 会到 4.5 → 越界，切
    const notes = [makeNote("四分", true), makeNote("四分", true), makeNote("四分", true)];
    const result = groupIntoBars(notes, 4);
    expect(result.map((b) => b.notes.length)).toEqual([2, 1]);
  });

  it("空谱返回空数组", () => {
    expect(groupIntoBars([], 4)).toEqual([]);
  });

  it("拍号非法时退回 4/4，而不是每个音各成一节", () => {
    const notes = bars(4).flat();
    expect(groupIntoBars(notes, 0).map((b) => b.notes.length)).toEqual([4]);
    expect(groupIntoBars(notes, Number.NaN).map((b) => b.notes.length)).toEqual([4]);
    expect(groupIntoBars(notes, -2).map((b) => b.notes.length)).toEqual([4]);
  });

  it("startIndex 是全谱下标，不是小节内下标", () => {
    const result = groupIntoBars(bars(10).flat(), 4);
    expect(result.map((b) => b.startIndex)).toEqual([0, 4, 8]);
  });
});

describe("equalBarWidth", () => {
  it("按最长的一节定宽，保证右边缘对齐", () => {
    const result = groupIntoBars(
      [...bars(4).flat(), ...Array.from({ length: 2 }, () => makeNote())],
      4,
    );
    // 两节：4 音 + 2 音 → 取 4
    expect(equalBarWidth(result)).toBe(
      4 * NOTE_COLUMN_WIDTH + 3 * NOTE_COLUMN_GAP,
    );
  });

  it("间距跟着密度走", () => {
    const result = groupIntoBars(bars(4).flat(), 4);
    expect(equalBarWidth(result, 6)).toBe(4 * NOTE_COLUMN_WIDTH + 3 * 6);
  });

  it("空谱返回 0，调用方据此退回自适应", () => {
    expect(equalBarWidth([])).toBe(0);
  });

  it("负间距被夹到 0，不会算出比音符还窄的小节", () => {
    const result = groupIntoBars(bars(2).flat(), 2);
    expect(equalBarWidth(result, -50)).toBe(2 * NOTE_COLUMN_WIDTH);
  });
});

describe("beatsPerBarFromLabel", () => {
  it("取斜杠前的数", () => {
    expect(beatsPerBarFromLabel("3/4")).toBe(3);
    expect(beatsPerBarFromLabel("4/4")).toBe(4);
    expect(beatsPerBarFromLabel("6/8")).toBe(6);
  });

  it("认不出时退回 4", () => {
    expect(beatsPerBarFromLabel("")).toBe(4);
    expect(beatsPerBarFromLabel("x/4")).toBe(4);
  });
});
