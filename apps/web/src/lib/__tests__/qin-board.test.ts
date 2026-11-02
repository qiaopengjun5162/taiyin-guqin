/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  boardDotAt,
  boardDots,
  boardFrequency,
  freqToMidi,
  huiRatio,
  midiToNote,
  ratioToHuiLabel,
  sameNoteDots,
} from "../qin-board";

/** 正调，A4=440。 */
const ZD = "zhengdiao" as const;

describe("琴面音位 · 音高", () => {
  it("散音就是空弦：一弦 C2、三弦 F2", () => {
    const dots = boardDots("散", ZD);
    expect(dots).toHaveLength(7);
    expect(dots[0].noteName).toBe("C2");
    expect(dots[0].freq).toBeCloseTo(65.41, 1);
    expect(dots[2].noteName).toBe("F2");
    expect(dots[2].freq).toBeCloseTo(87.31, 1);
  });

  it("按音：三弦七徽是一半弦长，正好高八度 F3", () => {
    const freq = boardFrequency(2, huiRatio(7), 7, "按", ZD) as number;
    expect(freq).toBeCloseTo(174.61, 1);
    expect(midiToNote(freqToMidi(freq)).noteName).toBe("F3");
  });

  it("按音：三弦九徽 p=2/3，有效弦长 1/3，得三倍频 C4", () => {
    const freq = boardFrequency(2, huiRatio(9), 9, "按", ZD) as number;
    expect(freq).toBeCloseTo(261.92, 1);
    expect(midiToNote(freqToMidi(freq)).noteName).toBe("C4");
  });

  it("泛音取谐波次数，不是 open/p —— 九徽是 3 次而非 1.5 次", () => {
    const harmonic = boardFrequency(2, huiRatio(9), 9, "泛", ZD) as number;
    const wrong = (boardFrequency(2, huiRatio(9), 9, "按", ZD) as number) / 2;
    expect(harmonic).toBeCloseTo(261.92, 1);
    expect(harmonic).toBeGreaterThan(wrong * 1.9);
  });

  it("一徽泛音是第 8 谐波：三弦 F5", () => {
    const freq = boardFrequency(2, huiRatio(1), 1, "泛", ZD) as number;
    expect(freq).toBeCloseTo(698.46, 1);
    expect(midiToNote(freqToMidi(freq)).noteName).toBe("F5");
  });

  it("泛音落不到平均律的点上时，如实给出偏差音分", () => {
    // 五弦 A2 = 110Hz，三徽第 5 谐波 = 550Hz，比 C♯5（554.37）低约 14 音分
    const freq = boardFrequency(4, huiRatio(3), 3, "泛", ZD) as number;
    expect(freq).toBeCloseTo(550, 1);
    const note = midiToNote(freqToMidi(freq));
    expect(note.noteName).toBe("C♯5");
    expect(note.cents).toBeLessThanOrEqual(-13);
    expect(note.cents).toBeGreaterThanOrEqual(-15);
  });

  it("换定弦跟着换：慢角三弦 E2，蕤宾五弦 B♭2", () => {
    expect(boardDots("散", "manjiao")[2].noteName).toBe("E2");
    expect(boardDots("散", "ruibin")[4].noteName).toBe("B♭2");
  });

  it("按音 91 个、泛音 91 个、散音 7 个", () => {
    expect(boardDots("按", ZD)).toHaveLength(91);
    expect(boardDots("泛", ZD)).toHaveLength(91);
    expect(boardDots("散", ZD)).toHaveLength(7);
  });
});

describe("琴面音位 · 连续位置（走手音）", () => {
  it("拖动位置不吸附到整徽：0.51 与 0.50 频率不同", () => {
    const a = boardDotAt(2, 0.5, "按", ZD) as NonNullable<ReturnType<typeof boardDotAt>>;
    const b = boardDotAt(2, 0.51, "按", ZD) as NonNullable<ReturnType<typeof boardDotAt>>;
    expect(b.freq).toBeGreaterThan(a.freq);
    expect(b.midi - a.midi).toBeGreaterThan(0);
  });

  it("越靠龙龈频率越高（有效弦长变短）", () => {
    const near = boardDotAt(0, 0.2, "按", ZD) as NonNullable<ReturnType<typeof boardDotAt>>;
    const far = boardDotAt(0, 0.8, "按", ZD) as NonNullable<ReturnType<typeof boardDotAt>>;
    expect(far.freq).toBeGreaterThan(near.freq);
  });

  it("位置越界时夹在可弹范围内，不返回 NaN", () => {
    const low = boardDotAt(0, -5, "按", ZD) as NonNullable<ReturnType<typeof boardDotAt>>;
    const high = boardDotAt(0, 9, "按", ZD) as NonNullable<ReturnType<typeof boardDotAt>>;
    expect(Number.isFinite(low.freq)).toBe(true);
    expect(Number.isFinite(high.freq)).toBe(true);
    expect(high.ratio).toBeLessThanOrEqual(0.95);
  });
});

describe("徽分读法", () => {
  it("整徽不带分", () => {
    expect(ratioToHuiLabel(huiRatio(7))).toBe("七徽");
    expect(ratioToHuiLabel(huiRatio(10))).toBe("十徽");
  });

  it("两徽之间从靠近岳山的那一徽起算", () => {
    // 七徽与八徽之间 60% 处 → 七徽六
    expect(ratioToHuiLabel(huiRatio(7) + 0.6 * (huiRatio(8) - huiRatio(7)))).toBe("七徽六");
    expect(ratioToHuiLabel(huiRatio(4) + 0.6 * (huiRatio(5) - huiRatio(4)))).toBe("四徽六");
  });

  it("一徽以近算「岳山侧」，散音就是「散」", () => {
    expect(ratioToHuiLabel(0.05)).toBe("岳山侧");
    expect(ratioToHuiLabel(0)).toBe("散");
  });
});

describe("同一音名的所有落点", () => {
  it("三弦七徽的 F3 至少能在图上找到它自己", () => {
    const dots = boardDots("按", ZD);
    const f3 = dots.find((d) => d.key === "按-2-7");
    expect(f3?.noteName).toBe("F3");
    const same = sameNoteDots(dots, f3!.midi);
    expect(same.length).toBeGreaterThanOrEqual(1);
    expect(same.map((d) => d.key)).toContain("按-2-7");
  });

  it("散音里没有重复音名：七根空弦各是一音", () => {
    const dots = boardDots("散", ZD);
    const names = new Set(dots.map((d) => d.noteName));
    expect(names.size).toBe(7);
  });
});
