/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { isDownbeat, nextClick, advanceBeat } from "../metronome";

describe("isDownbeat", () => {
  it("marks beat 0 as downbeat", () => {
    expect(isDownbeat(0, 4)).toBe(true);
  });

  it("cycles per meter", () => {
    expect([0, 1, 2, 3, 4].map((i) => isDownbeat(i, 4))).toEqual([
      true, false, false, false, true,
    ]);
    expect([0, 1, 2, 3].map((i) => isDownbeat(i, 3))).toEqual([
      true, false, false, true,
    ]);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => isDownbeat(i, 6))).toEqual([
      true, false, false, false, false, false, true,
    ]);
  });
});

describe("nextClick", () => {
  it("returns click within horizon", () => {
    expect(nextClick(0.05, 0, 0.5, 4, 0.1)).toEqual({ time: 0.05, accent: true });
  });

  it("returns null beyond horizon", () => {
    expect(nextClick(0.55, 1, 0.5, 4, 0.1)).toBeNull();
  });
});

describe("advanceBeat", () => {
  it("advances time and index", () => {
    expect(advanceBeat(0.05, 0, 0.5)).toEqual([0.55, 1]);
  });
});
