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

describe("frequencyToJianpu", () => {
  it("maps open 六弦 C3 to 1,", () => {
    expect(frequencyToJianpu(130.81)).toEqual({ number: "1", octave: "," });
  });
  it("maps open 七弦 D3 to 2,", () => {
    expect(frequencyToJianpu(146.83)).toEqual({ number: "2", octave: "," });
  });
  it("maps C4 to 1 (无八度)", () => {
    expect(frequencyToJianpu(261.63)).toEqual({ number: "1", octave: "" });
  });
  it("maps G4 to 5 (无八度)", () => {
    expect(frequencyToJianpu(392.0)).toEqual({ number: "5", octave: "" });
  });
  it("maps C5 to 1· 与 C6 到 1·· (高两个八度范围)", () => {
    expect(frequencyToJianpu(523.25)).toEqual({ number: "1", octave: "·" });
    expect(frequencyToJianpu(1046.5)).toEqual({ number: "1", octave: "··" });
  });
  it("maps 一弦空弦 C2 到 1,, (低两个八度，不再上移)", () => {
    expect(frequencyToJianpu(65.41)).toEqual({ number: "1", octave: ",," });
  });
  it("returns null for non-positive frequency", () => {
    expect(frequencyToJianpu(0)).toBeNull();
    expect(frequencyToJianpu(-1)).toBeNull();
  });
});

describe("jianziToJianpu", () => {
  it("derives 简谱 for open string", () => {
    expect(jianziToJianpu(state({ toneType: "散", stringNumber: "六" }))).toEqual({
      number: "1",
      octave: ",",
    });
  });
  it("derives 低二八度 for 一弦空弦 C2", () => {
    // 一弦空弦为 C2，应落于低两个八度（",,"），验证不再被上移八度
    expect(jianziToJianpu(state({ toneType: "散", stringNumber: "一" }))).toEqual({
      number: "1",
      octave: ",,"
    });
    expect(jianziToFrequency(state({ toneType: "散", stringNumber: "一" }))).toBeCloseTo(
      65.41,
      1,
    );
  });
  it("derives 简谱 for 七徽按音 (C4)", () => {
    expect(
      jianziToJianpu(state({ toneType: "按", stringNumber: "六", hui: "七" })),
    ).toEqual({ number: "1", octave: "" });
  });
  it("derives 简谱 for 九徽按音 (G4)", () => {
    expect(
      jianziToJianpu(state({ toneType: "按", stringNumber: "六", hui: "九" })),
    ).toEqual({ number: "5", octave: "" });
  });
  it("returns null when pitch cannot be derived", () => {
    expect(
      jianziToJianpu(state({ toneType: "按", stringNumber: "六" })),
    ).toBeNull();
  });
});
