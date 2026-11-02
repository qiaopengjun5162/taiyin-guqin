import { describe, it, expect } from "vitest";
import {
  chineseNumToHui,
  huiFraction,
  jianziToFrequency,
  frequencyToJianpu,
  jianziToJianpu,
} from "../jianzi-pitch";
import type { JianziState } from "../types";

function state(partial: Partial<JianziState>): JianziState {
  return {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: null,
    stringNumber: null,
    ...partial,
  };
}

describe("chineseNumToHui", () => {
  it("parses single-digit hui", () => {
    expect(chineseNumToHui("三")).toBe(3);
    expect(chineseNumToHui("九")).toBe(9);
  });
  it("parses 十 and 十一/十二/十三", () => {
    expect(chineseNumToHui("十")).toBe(10);
    expect(chineseNumToHui("十一")).toBe(11);
    expect(chineseNumToHui("十三")).toBe(13);
  });
  it("returns null for invalid input", () => {
    expect(chineseNumToHui("X")).toBeNull();
    expect(chineseNumToHui("")).toBeNull();
    expect(chineseNumToHui(null)).toBeNull();
  });
});

describe("huiFraction", () => {
  it("returns exact hui fraction without fen", () => {
    expect(huiFraction(7, null)).toBeCloseTo(0.5, 6);
    expect(huiFraction(9, null)).toBeCloseTo(2 / 3, 6);
  });
  it("interpolates fen between adjacent hui", () => {
    // 九徽八分：2/3 + 0.8*(3/4 - 2/3)
    expect(huiFraction(9, "八分")).toBeCloseTo(2 / 3 + 0.8 * (3 / 4 - 2 / 3), 6);
  });
});

describe("jianziToFrequency", () => {
  it("open string for 散音", () => {
    expect(jianziToFrequency(state({ toneType: "散", stringNumber: "六" }))).toBeCloseTo(
      130.81,
      1,
    );
    expect(jianziToFrequency(state({ toneType: "散", stringNumber: "一" }))).toBeCloseTo(
      65.41,
      1,
    );
  });
  it("七徽按音 = 空弦高八度", () => {
    expect(
      jianziToFrequency(state({ toneType: "按", stringNumber: "六", hui: "七" })),
    ).toBeCloseTo(261.63, 1);
  });
  it("九徽按音 = 空弦高十二度 (×3)", () => {
    expect(
      jianziToFrequency(state({ toneType: "按", stringNumber: "六", hui: "九" })),
    ).toBeCloseTo(392.43, 1);
  });
  it("七徽泛音 = 空弦高八度 (2 次谐波)", () => {
    expect(
      jianziToFrequency(state({ toneType: "泛", stringNumber: "六", hui: "七" })),
    ).toBeCloseTo(261.63, 1);
  });
  it("九徽泛音 = 空弦 ×3 (3 次谐波，非 open/p)", () => {
    expect(
      jianziToFrequency(state({ toneType: "泛", stringNumber: "六", hui: "九" })),
    ).toBeCloseTo(392.43, 1);
  });
  it("returns null when 按/泛音 lacks hui", () => {
    expect(
      jianziToFrequency(state({ toneType: "按", stringNumber: "六" })),
    ).toBeNull();
    expect(
      jianziToFrequency(state({ toneType: "泛", stringNumber: "六" })),
    ).toBeNull();
  });
  it("returns null without string number", () => {
    expect(jianziToFrequency(state({ toneType: "散" }))).toBeNull();
  });
});

describe("frequencyToJianpu（1=F2，三弦为宫）", () => {
  it("F1 → 1,（低八度）", () => {
    expect(frequencyToJianpu(43.65)).toEqual({ number: "1", octave: "," });
  });
  it("F2 → 1（未标记八度）", () => {
    expect(frequencyToJianpu(87.31)).toEqual({ number: "1", octave: "" });
  });
  it("F3 → 1·", () => {
    expect(frequencyToJianpu(174.61)).toEqual({ number: "1", octave: "·" });
  });
  it("C2（散一弦）→ 5,", () => {
    expect(frequencyToJianpu(65.41)).toEqual({ number: "5", octave: "," });
  });
  it("C3（散六弦）→ 5", () => {
    expect(frequencyToJianpu(130.81)).toEqual({ number: "5", octave: "" });
  });
  it("C4 → 5·", () => {
    expect(frequencyToJianpu(261.63)).toEqual({ number: "5", octave: "·" });
  });
  it("零或负值返回 null", () => {
    expect(frequencyToJianpu(0)).toBeNull();
    expect(frequencyToJianpu(-1)).toBeNull();
  });
});

describe("jianziToJianpu", () => {
  it("derives 简谱 for open string 六弦 (C3 → 5)", () => {
    expect(jianziToJianpu(state({ toneType: "散", stringNumber: "六" }))).toEqual({
      number: "5",
      octave: "",
    });
  });
  it("derives 5, for 一弦空弦 C2（比三弦低一个八度）", () => {
    expect(jianziToJianpu(state({ toneType: "散", stringNumber: "一" }))).toEqual({
      number: "5",
      octave: ",",
    });
    expect(jianziToFrequency(state({ toneType: "散", stringNumber: "一" }))).toBeCloseTo(
      65.41,
      1,
    );
  });
  it("derives 5· for 六弦七徽按音 (C4)", () => {
    expect(
      jianziToJianpu(state({ toneType: "按", stringNumber: "六", hui: "七" })),
    ).toEqual({ number: "5", octave: "·" });
  });
  it("derives 1· for 三弦七徽按音 (F3)", () => {
    expect(
      jianziToJianpu(state({ toneType: "按", stringNumber: "三", hui: "七" })),
    ).toEqual({ number: "1", octave: "·" });
  });
  it("returns null when pitch cannot be derived", () => {
    expect(
      jianziToJianpu(state({ toneType: "按", stringNumber: "六" })),
    ).toBeNull();
  });
});
