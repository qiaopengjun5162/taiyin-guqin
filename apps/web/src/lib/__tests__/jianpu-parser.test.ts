/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { parseJianpuString } from "../jianpu-parser";

describe("parseJianpuString", () => {
  it("parses plain numbers", () => {
    const result = parseJianpuString("5 6 1 2");
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ number: 5, octave: 0, raw: "5" });
    expect(result[1]).toEqual({ number: 6, octave: 0, raw: "6" });
    expect(result[2]).toEqual({ number: 1, octave: 0, raw: "1" });
    expect(result[3]).toEqual({ number: 2, octave: 0, raw: "2" });
  });

  it("parses octave markers", () => {
    const result = parseJianpuString("5· 6' 3,");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ number: 5, octave: 1, raw: "5·" });
    expect(result[1]).toEqual({ number: 6, octave: 1, raw: "6'" });
    expect(result[2]).toEqual({ number: 3, octave: -1, raw: "3," });
  });

  it("treats bar lines and spaces as separators", () => {
    const result = parseJianpuString("5 6 | 1 2 | 3 5");
    expect(result).toHaveLength(6);
    expect(result.map((n) => n?.number)).toEqual([5, 6, 1, 2, 3, 5]);
  });

  it("returns null for rests and holds", () => {
    const result = parseJianpuString("5 6 - 0 3");
    expect(result).toHaveLength(5);
    expect(result[0]?.number).toBe(5);
    expect(result[1]?.number).toBe(6);
    expect(result[2]).toBeNull();
    expect(result[3]).toBeNull();
    expect(result[4]?.number).toBe(3);
  });

  it("ignores invalid tokens", () => {
    const result = parseJianpuString("5 x 8 3");
    expect(result).toHaveLength(2);
    expect(result[0]?.number).toBe(5);
    expect(result[1]?.number).toBe(3);
  });

  it("returns empty array for empty input", () => {
    expect(parseJianpuString("")).toEqual([]);
    expect(parseJianpuString("   ")).toEqual([]);
  });
});
