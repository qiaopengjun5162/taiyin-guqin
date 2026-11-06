/**
 * 时值拖动阶梯。
 *
 * 这里最容易错的是「阶梯顺序」：必须按实际拍数排，而不是按 Duration 的字面
 * 顺序。附点八分（0.75 拍）比四分（1 拍）短，排错了向右拖反而会变短，
 * 而且界面上完全看不出来哪里不对。
 */
import { describe, it, expect } from "vitest";
import {
  DURATION_LADDER,
  DRAG_STEP_PX,
  ladderIndex,
  stepDuration,
  dragDuration,
  durationLabel,
} from "../duration-drag";
import { durationToBeats } from "../jianzi";

describe("DURATION_LADDER", () => {
  it("按实际拍数严格递增", () => {
    const beats = DURATION_LADDER.map((v) => durationToBeats(v.duration, v.dotted));
    for (let i = 1; i < beats.length; i += 1) {
      expect(beats[i]).toBeGreaterThan(beats[i - 1]);
    }
  });

  it("首尾是最短与最长", () => {
    const first = DURATION_LADDER[0];
    const last = DURATION_LADDER[DURATION_LADDER.length - 1];
    expect(durationToBeats(first.duration, first.dotted)).toBe(0.25);
    expect(durationToBeats(last.duration, last.dotted)).toBe(4);
  });

  it("没有重复档位", () => {
    const keys = DURATION_LADDER.map((v) => `${v.duration}|${v.dotted}`);
    expect(new Set(keys).size).toBe(DURATION_LADDER.length);
  });
});

describe("ladderIndex", () => {
  it("认得出每个档位", () => {
    DURATION_LADDER.forEach((v, i) => {
      expect(ladderIndex(v)).toBe(i);
    });
  });

  it("不在阶梯上的组合落到最接近的一档，而不是从最短重来", () => {
    // 全音符附点 = 6 拍，阶梯上没有；最近的是全音符（4 拍），不是十六分
    const idx = ladderIndex({ duration: "全", dotted: true });
    expect(DURATION_LADDER[idx].duration).toBe("全");
    expect(DURATION_LADDER[idx].dotted).toBe(false);
  });
});

describe("stepDuration", () => {
  it("正数变长、负数变短", () => {
    const quarter = { duration: "四分" as const, dotted: false };
    expect(stepDuration(quarter, 1).duration).toBe("四分");
    expect(stepDuration(quarter, 1).dotted).toBe(true);
    expect(stepDuration(quarter, -1).duration).toBe("八分");
    expect(stepDuration(quarter, -1).dotted).toBe(true);
  });

  it("越界夹在两端，不会绕回另一端", () => {
    const longest = { duration: "全" as const, dotted: false };
    expect(stepDuration(longest, 99)).toEqual(longest);
    const shortest = { duration: "十六分" as const, dotted: false };
    expect(stepDuration(shortest, -99)).toEqual(shortest);
  });

  it("走 0 格等于原地不动", () => {
    const v = { duration: "八分" as const, dotted: true };
    expect(stepDuration(v, 0)).toEqual(v);
  });
});

describe("dragDuration", () => {
  const quarter = { duration: "四分" as const, dotted: false };

  it("按每格像素折算，向右变长", () => {
    expect(dragDuration(quarter, DRAG_STEP_PX).dotted).toBe(true);
    expect(dragDuration(quarter, DRAG_STEP_PX * 2).duration).toBe("二分");
  });

  it("四舍五入而不是向下取整：拖大半格也要动", () => {
    // 0.6 格 → 1 格。向下取整会让"差一点"的手势完全没反应
    expect(dragDuration(quarter, DRAG_STEP_PX * 0.6).dotted).toBe(true);
    // 0.4 格 → 0 格，仍在原位
    expect(dragDuration(quarter, DRAG_STEP_PX * 0.4)).toEqual(quarter);
  });

  it("向左拖变短", () => {
    const half = { duration: "二分" as const, dotted: false };
    expect(dragDuration(half, -DRAG_STEP_PX * 2).duration).toBe("四分");
  });

  it("步长非法时退回默认，不会除零", () => {
    expect(dragDuration(quarter, DRAG_STEP_PX, 0).dotted).toBe(true);
  });
});

describe("durationLabel", () => {
  it("附点要显式标出来", () => {
    expect(durationLabel({ duration: "四分", dotted: false })).toBe("四分");
    expect(durationLabel({ duration: "四分", dotted: true })).toBe("四分附点");
  });
});
