/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { jianpuToFrequency, buildSchedule } from "../player";
import { createEmptyState } from "../jianzi";
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

describe("jianpuToFrequency", () => {
  it("maps 1 (central) to middle C", () => {
    expect(jianpuToFrequency("1", "")).toBeCloseTo(261.63, 1);
  });

  it("maps 5 to G above middle C", () => {
    expect(jianpuToFrequency("5", "")).toBeCloseTo(392.0, 1);
  });

  it("applies octave offsets", () => {
    expect(jianpuToFrequency("1", "·")).toBeCloseTo(523.25, 1);
    expect(jianpuToFrequency("1", ",")).toBeCloseTo(130.81, 1);
  });

  it("returns null for rests and missing numbers", () => {
    expect(jianpuToFrequency("0", "")).toBeNull();
    expect(jianpuToFrequency(null, "")).toBeNull();
  });
});

describe("buildSchedule", () => {
  it("schedules notes sequentially by duration", () => {
    const notes = [
      makeNote({ jianpuNumber: "5", duration: "四分" }),
      makeNote({ jianpuNumber: "6", duration: "二分" }),
      makeNote({ jianpuNumber: "1", duration: "八分" }),
    ];
    const schedule = buildSchedule(notes, 500);
    expect(schedule.map((s) => s.start)).toEqual([0, 0.5, 1.5]);
    expect(schedule.map((s) => s.duration)).toEqual([0.5, 1, 0.25]);
  });

  it("dotted notes last 1.5x", () => {
    const schedule = buildSchedule([makeNote({ jianpuDot: true })], 500);
    expect(schedule[0].duration).toBe(0.75);
  });

  it("rests are silent but occupy time", () => {
    const notes = [
      makeNote({ jianpuNumber: "5" }),
      makeNote({ jianpuNumber: "0" }),
      makeNote({ jianpuNumber: "6" }),
    ];
    const schedule = buildSchedule(notes, 500);
    expect(schedule[1].freq).toBeNull();
    expect(schedule[2].start).toBe(1);
    expect(schedule[2].freq).not.toBeNull();
  });

  it("notes without jianpu number are silent", () => {
    const schedule = buildSchedule([makeNote({ jianpuNumber: null })], 500);
    expect(schedule[0].freq).toBeNull();
  });
});
