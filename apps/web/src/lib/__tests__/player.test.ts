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

  it("applies double-octave offsets (±2)", () => {
    expect(jianpuToFrequency("1", "··")).toBeCloseTo(1046.5, 1);
    expect(jianpuToFrequency("1", ",,")).toBeCloseTo(65.41, 1);
  });

  it("returns null for rests and missing numbers", () => {
    expect(jianpuToFrequency("0", "")).toBeNull();
    expect(jianpuToFrequency(null, "")).toBeNull();
  });

  it("默认以 A4=440 为基准", () => {
    // 简谱 5 之上的 6（A4 本身）= 440
    expect(jianpuToFrequency("6", "")).toBeCloseTo(440, 1);
  });

  it("改基准音时整谱等比平移，相对音程不变", () => {
    const at440 = jianpuToFrequency("1", "", 440) as number;
    const at415 = jianpuToFrequency("1", "", 415) as number;
    // 415/440 的比例作用到每个音上
    expect(at415 / at440).toBeCloseTo(415 / 440, 6);

    // 古琴常整床偏低：425Hz 时中央 C 约低 60 音分（1200·log2(425/440) ≈ -59.6）
    const at425 = jianpuToFrequency("1", "", 425) as number;
    const cents = 1200 * Math.log2(at425 / at440);
    expect(cents).toBeCloseTo(-59.6, 0);
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

  it("基准音透传到每个音，且不改变排程时值", () => {
    const notes = [makeNote({ jianpuNumber: "6" }), makeNote({ jianpuNumber: "5" })];
    const at440 = buildSchedule(notes, 500);
    const at415 = buildSchedule(notes, 500, 415);

    expect(at440[0].freq).toBeCloseTo(440, 1);
    expect(at415[0].freq).toBeCloseTo(415, 1);
    // 时值不受基准音影响
    expect(at415.map((s) => s.start)).toEqual(at440.map((s) => s.start));
  });
});
