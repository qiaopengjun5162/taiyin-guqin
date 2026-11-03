/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { parseJianpuString, noteUnits } from "../jianpu-parser";

describe("parseJianpuString", () => {
  it("parses plain numbers as quarter notes", () => {
    const result = parseJianpuString("5 6 1 2");
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ kind: "note", number: 5, octave: 0, duration: "四分", dotted: false, raw: "5" });
    expect(result[1]).toEqual({ kind: "note", number: 6, octave: 0, duration: "四分", dotted: false, raw: "6" });
    expect(result[2]).toEqual({ kind: "note", number: 1, octave: 0, duration: "四分", dotted: false, raw: "1" });
    expect(result[3]).toEqual({ kind: "note", number: 2, octave: 0, duration: "四分", dotted: false, raw: "2" });
  });

  it("parses octave markers", () => {
    const result = parseJianpuString("5· 6' 3,");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: "note", number: 5, octave: 1, duration: "四分", dotted: false, raw: "5·" });
    expect(result[1]).toEqual({ kind: "note", number: 6, octave: 1, duration: "四分", dotted: false, raw: "6'" });
    expect(result[2]).toEqual({ kind: "note", number: 3, octave: -1, duration: "四分", dotted: false, raw: "3," });
  });

  it("parses double-octave markers (±2)", () => {
    const result = parseJianpuString("1·· 2,,");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "note", number: 1, octave: 2, duration: "四分", dotted: false, raw: "1··" });
    expect(result[1]).toEqual({ kind: "note", number: 2, octave: -2, duration: "四分", dotted: false, raw: "2,," });
  });

  it("treats bar lines and spaces as separators", () => {
    const result = parseJianpuString("5 6 | 1 2 | 3 5");
    expect(result).toHaveLength(6);
    expect(result.map((n) => (n.kind === "note" ? n.number : null))).toEqual([5, 6, 1, 2, 3, 5]);
  });

  it("parses rests as rest items", () => {
    const result = parseJianpuString("5 0 3");
    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe("note");
    expect(result[1]).toEqual({ kind: "rest", duration: "四分", dotted: false, raw: "0" });
    expect(result[2].kind).toBe("note");
  });

  it("parses rest durations", () => {
    const result = parseJianpuString("0 - 0_ 0.");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: "rest", duration: "二分", dotted: false, raw: "0-" });
    expect(result[1]).toEqual({ kind: "rest", duration: "八分", dotted: false, raw: "0_" });
    expect(result[2]).toEqual({ kind: "rest", duration: "四分", dotted: true, raw: "0." });
  });

  it("ignores invalid tokens", () => {
    const result = parseJianpuString("5 x 8 3");
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("note");
    expect(result[0]).toMatchObject({ number: 5 });
    expect(result[1]).toMatchObject({ number: 3 });
  });

  it("returns empty array for empty input", () => {
    expect(parseJianpuString("")).toEqual([]);
    expect(parseJianpuString("   ")).toEqual([]);
  });

  it("merges dashes into the previous note duration", () => {
    const result = parseJianpuString("5 - 6 - - -");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "note", number: 5, octave: 0, duration: "二分", dotted: false, raw: "5-" });
    expect(result[1]).toEqual({ kind: "note", number: 6, octave: 0, duration: "全", dotted: false, raw: "6---" });
  });

  it("maps three beats to dotted half note", () => {
    const result = parseJianpuString("5 - -");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "note", number: 5, octave: 0, duration: "二分", dotted: true, raw: "5--" });
  });

  it("extends across bar lines", () => {
    const result = parseJianpuString("5 | -");
    expect(result).toHaveLength(1);
    expect(result[0].duration).toBe("二分");
  });

  it("extends a rest across bar lines", () => {
    const result = parseJianpuString("0 | -");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "rest", duration: "二分", dotted: false, raw: "0-" });
  });

  it("ignores dashes that exceed whole note", () => {
    const result = parseJianpuString("5 - - - -");
    expect(result).toHaveLength(1);
    expect(result[0].duration).toBe("全");
    expect(result[0].raw).toBe("5---");
  });

  it("ignores dashes with no preceding item", () => {
    const result = parseJianpuString("- 5");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("note");
  });

  it("parses reduction lines for eighth and sixteenth notes", () => {
    const result = parseJianpuString("5_ 6__");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "note", number: 5, octave: 0, duration: "八分", dotted: false, raw: "5_" });
    expect(result[1]).toEqual({ kind: "note", number: 6, octave: 0, duration: "十六分", dotted: false, raw: "6__" });
  });

  it("parses dotted notes", () => {
    const result = parseJianpuString("5. 6_.");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "note", number: 5, octave: 0, duration: "四分", dotted: true, raw: "5." });
    expect(result[1]).toEqual({ kind: "note", number: 6, octave: 0, duration: "八分", dotted: true, raw: "6_." });
  });

  it("combines octave, reduction lines and dot in one token", () => {
    const result = parseJianpuString("5·_.");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "note", number: 5, octave: 1, duration: "八分", dotted: true, raw: "5·_." });
  });

  it("rejects tokens with three reduction lines", () => {
    const result = parseJianpuString("5___ 3");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ number: 3 });
  });

  it("keeps the note when a dash would make duration unmappable", () => {
    const result = parseJianpuString("5. -");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "note", number: 5, octave: 0, duration: "四分", dotted: true, raw: "5." });
  });
});

describe("noteUnits（给指法编排用的时值）", () => {
  /** 取第一个音的时值。不是音符（比如解析器把整段丢掉了）就直接失败。 */
  function unitsOf(input: string): number {
    const [item] = parseJianpuString(input);
    if (!item || item.kind !== "note") throw new Error(`不是一个音：${input}`);
    return noteUnits(item);
  }

  // 单位是 1/8 拍：四分 = 8。Rust 端用它判断「手有没有时间换把」，
  // 换算错一个音，编排就会在快句里排出根本来不及的落点。
  it("按八度音符换算成 1/8 拍", () => {
    expect(unitsOf("5 - - -")).toBe(32);
    expect(unitsOf("5 -")).toBe(16);
    expect(unitsOf("5")).toBe(8);
  });

  it("减时线与附点各按一半 / 1.5 倍计", () => {
    expect(unitsOf("5_")).toBe(4);
    expect(unitsOf("5__")).toBe(2);
    expect(unitsOf("5.")).toBe(12);
  });

  it("延音线把时值真的拉长（- 不是装饰，它决定手有没有时间）", () => {
    expect(unitsOf("5 -")).toBeGreaterThan(unitsOf("5"));
  });
});
