import { describe, it, expect } from "vitest";
import {
  JUDGE_DEFAULTS,
  centsBetween,
  expectedFromSchedule,
  judgeTake,
  segmentNotes,
  type DetectedNote,
  type ExpectedNote,
  type PitchSample,
} from "../play-along";
import type { ScheduledNote } from "../player";

/** 每 80ms 一帧，跟调音器/判定面板的真实采样率一致。 */
const STEP = 0.08;

interface SynthNote {
  start: number;
  freq: number;
  dur: number;
}

/**
 * 合成一段「拨弦」采样流。
 *
 * 衰减常数 0.35 秒是照真实拨弦挑的：起音后第一个 0.4 秒掉到三成，
 * 这样下一个音起来时音量台阶有明显 3 倍，符合「按台阶切音」要判的情形。
 * 若衰减再慢，两个音的电平几乎一样，台阶就不存在了——那是合成器的问题，
 * 不是古琴。
 */
function synth(notes: SynthNote[], total: number, level = 0.25): PitchSample[] {
  const out: PitchSample[] = [];
  for (let t = 0; t <= total + 1e-9; t += STEP) {
    const active = notes.filter((n) => t >= n.start && t < n.start + n.dur).at(-1);
    if (!active) {
      out.push({ t, freq: null, clarity: 0, rms: 0 });
      continue;
    }
    const age = t - active.start;
    out.push({
      t,
      freq: active.freq,
      clarity: 0.9,
      rms: level * Math.exp(-age / 0.35),
    });
  }
  return out;
}

function expected(list: { start: number; freq: number; duration?: number; index?: number; slide?: boolean }[]): ExpectedNote[] {
  return list.map((e, i) => ({
    index: e.index ?? i,
    start: e.start,
    duration: e.duration ?? 0.5,
    freq: e.freq,
    slide: e.slide ?? false,
  }));
}

function detected(list: { start: number; freq: number; duration?: number }[]): DetectedNote[] {
  return list.map((d) => ({ start: d.start, freq: d.freq, duration: d.duration ?? 0.5 }));
}

const A4 = 440;
const C5 = 523.2511;
const D5 = 587.3295;

describe("centsBetween", () => {
  it("同频为零", () => {
    expect(centsBetween(440, 440)).toBeCloseTo(0, 6);
  });

  it("高八度是 +1200", () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 6);
  });

  it("半个半音约 50 音分", () => {
    expect(centsBetween(440 * Math.pow(2, 0.5 / 12), 440)).toBeCloseTo(50, 6);
  });

  it("非法频率不给 NaN", () => {
    expect(centsBetween(0, 440)).toBe(0);
    expect(centsBetween(440, -1)).toBe(0);
  });
});

describe("segmentNotes", () => {
  it("音与音之间有静音时切得开", () => {
    const samples = synth(
      [
        { start: 0.1, freq: A4, dur: 0.5 },
        { start: 1.0, freq: C5, dur: 0.5 },
      ],
      2,
    );
    const notes = segmentNotes(samples);
    expect(notes).toHaveLength(2);
    expect(notes[0].freq).toBeCloseTo(A4, 0);
    expect(notes[1].freq).toBeCloseTo(C5, 0);
    expect(notes[1].start).toBeCloseTo(1.0, 1);
  });

  /**
   * 这是整条链路最关键的一条：古琴散音能响三五秒，下一个音起来时上一个还在响，
   * 中间**没有静音**。按静音切会把三个音认成一个长音。
   */
  it("没有静音、只有音量台阶时也能切（古琴余音重叠）", () => {
    const samples = synth(
      [
        { start: 0.0, freq: A4, dur: 0.8 },
        { start: 0.5, freq: C5, dur: 0.8 },
        { start: 1.0, freq: D5, dur: 0.8 },
      ],
      1.8,
    );
    // 确认这段确实没有静音帧：全是有效采样
    expect(samples.every((s) => s.freq !== null)).toBe(true);

    const notes = segmentNotes(samples);
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => Math.round(n.freq))).toEqual([
      Math.round(A4),
      Math.round(C5),
      Math.round(D5),
    ]);
  });

  it("音量小幅抖动不会被切成碎音", () => {
    const samples = synth([{ start: 0, freq: A4, dur: 1.2 }], 1.3);
    // 在中间人为加一点起伏（+8%），远不够 1.6 倍也不够 onsetDelta
    const jittered = samples.map((s, i) =>
      s.freq === null ? s : { ...s, rms: s.rms * (i % 3 === 0 ? 1.08 : 1) },
    );
    expect(segmentNotes(jittered)).toHaveLength(1);
  });

  it("太短的毛刺被丢掉", () => {
    const samples: PitchSample[] = [
      { t: 0, freq: 800, clarity: 0.9, rms: 0.2 },
      { t: 0.02, freq: 800, clarity: 0.9, rms: 0.2 },
    ];
    expect(segmentNotes(samples)).toHaveLength(0);
  });

  it("可信度不够的帧当噪声", () => {
    const samples: PitchSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * STEP,
      freq: 440,
      clarity: 0.3,
      rms: 0.2,
    }));
    expect(segmentNotes(samples)).toHaveLength(0);
  });

  it("一个音内部取中位音高，不被起手的滑动带偏", () => {
    // 起手一帧被读成高了 300 音分，随后稳定在 A4
    const samples: PitchSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * STEP,
      freq: i === 0 ? 480 : A4,
      clarity: 0.9,
      rms: 0.2 * Math.exp(-i * 0.1),
    }));
    const notes = segmentNotes(samples);
    expect(notes).toHaveLength(1);
    expect(notes[0].freq).toBeCloseTo(A4, 0);
  });
});

describe("expectedFromSchedule", () => {
  const schedule: ScheduledNote[] = [
    { start: 1.0, duration: 0.5, freq: null, toneType: null, slide: null },
    { start: 1.5, duration: 0.5, freq: A4, toneType: "散", slide: null },
    { start: 2.0, duration: 0.5, freq: C5, toneType: "按", slide: "绰" },
    { start: 2.5, duration: 0.5, freq: D5, toneType: "散", slide: null },
  ];

  it("静默音不参与判定（否则休止符会被算成漏弹）", () => {
    const out = expectedFromSchedule(schedule, 0, 3);
    expect(out).toHaveLength(3);
    expect(out.map((n) => n.index)).toEqual([1, 2, 3]);
  });

  it("时间相对句首归零", () => {
    const out = expectedFromSchedule(schedule, 1, 3);
    expect(out[0].start).toBeCloseTo(0, 6);
    expect(out[1].start).toBeCloseTo(0.5, 6);
  });

  it("带绰/注的音被标出来", () => {
    const out = expectedFromSchedule(schedule, 1, 3);
    expect(out.map((n) => n.slide)).toEqual([false, true, false]);
  });
});

describe("judgeTake", () => {
  const exp = expected([
    { start: 0.0, freq: A4 },
    { start: 0.5, freq: C5 },
    { start: 1.0, freq: D5 },
    { start: 1.5, freq: A4 },
  ]);

  it("全弹对就通过", () => {
    const result = judgeTake(
      exp,
      detected([
        { start: 0.0, freq: A4 },
        { start: 0.5, freq: C5 },
        { start: 1.0, freq: D5 },
        { start: 1.5, freq: A4 },
      ]),
    );
    expect(result.passed).toBe(true);
    expect(result.pitchOkRatio).toBe(1);
    expect(result.missed).toBe(0);
    expect(result.summary).toContain("过了");
  });

  it("整体晚 0.2 秒仍判准，但会把偏移说出来", () => {
    const late = detected([
      { start: 0.2, freq: A4 },
      { start: 0.7, freq: C5 },
      { start: 1.2, freq: D5 },
      { start: 1.7, freq: A4 },
    ]);
    const result = judgeTake(exp, late);
    expect(result.passed).toBe(true);
    expect(result.offset).toBeCloseTo(0.2, 2);
    // 校正后起音偏差应该接近零，而不是把 0.2 秒记到每个音头上
    expect(Math.abs(result.notes[0].onsetOffset ?? 1)).toBeLessThan(0.06);
  });

  it("偏 60 音分判 flat，但不至于整句不及格", () => {
    const result = judgeTake(
      exp,
      detected([
        { start: 0.0, freq: A4 },
        { start: 0.5, freq: C5 * Math.pow(2, -60 / 1200) },
        { start: 1.0, freq: D5 },
        { start: 1.5, freq: A4 },
      ]),
    );
    expect(result.notes[1].verdict).toBe("flat");
    expect(result.notes[1].cents).toBeCloseTo(-60, 0);
    // 4 个音里 3 个准 = 0.75 < 0.8，这一句应该没过
    expect(result.pitchOkRatio).toBeCloseTo(0.75, 2);
    expect(result.passed).toBe(false);
  });

  it("差一个八度算按错位置，不算没调准", () => {
    const result = judgeTake(
      exp,
      detected([
        { start: 0.0, freq: A4 },
        { start: 0.5, freq: C5 },
        { start: 1.0, freq: D5 * 2 },
        { start: 1.5, freq: A4 },
      ]),
    );
    expect(result.notes[2].verdict).toBe("wrong");
    expect(result.summary).toContain("按错位置");
  });

  it("漏音会被数出来，且不拖累其它音的判定", () => {
    const result = judgeTake(
      exp,
      detected([
        { start: 0.0, freq: A4 },
        { start: 1.0, freq: D5 },
        { start: 1.5, freq: A4 },
      ]),
    );
    expect(result.missed).toBe(1);
    expect(result.notes[1].verdict).toBe("missed");
    expect(result.notes[2].verdict).toBe("ok");
  });

  it("带绰/注的音放宽容差：滑音本来就偏，不该判错", () => {
    const slideExp = expected([{ start: 0, freq: A4, slide: true }]);
    const result = judgeTake(slideExp, detected([{ start: 0, freq: A4 * Math.pow(2, 150 / 1200) }]));
    expect(result.notes[0].verdict).toBe("ok");
  });

  it("不带走手音的同偏差就该判出来", () => {
    const plain = expected([{ start: 0, freq: A4 }]);
    const result = judgeTake(plain, detected([{ start: 0, freq: A4 * Math.pow(2, 150 / 1200) }]));
    expect(result.notes[0].verdict).toBe("sharp");
  });

  it("多弹的音记成 extra，不改变通过与否", () => {
    const result = judgeTake(
      exp,
      detected([
        { start: 0.0, freq: A4 },
        { start: 0.25, freq: A4 },
        { start: 0.5, freq: C5 },
        { start: 1.0, freq: D5 },
        { start: 1.5, freq: A4 },
      ]),
    );
    expect(result.extra).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("一个音都没听到时，提示去查麦克风而不是报不及格", () => {
    const result = judgeTake(exp, []);
    expect(result.matched).toBe(0);
    expect(result.missed).toBe(4);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("麦克风");
  });

  it("偏心超过上限就不校正了（那不是晚，是弹错）", () => {
    // 长音的配对窗口能到 0.6 秒，所以 0.55 秒的偏差还配得上；
    // 但它超过 maxOffsetSeconds(0.5)，不该被当成「整体晚了」一笔抹平。
    const long = expected([
      { start: 0, freq: A4, duration: 1.2 },
      { start: 1.2, freq: C5, duration: 1.2 },
    ]);
    const result = judgeTake(
      long,
      detected([
        { start: 0.55, freq: A4, duration: 1.2 },
        { start: 1.75, freq: C5, duration: 1.2 },
      ]),
      { maxOffsetSeconds: 0.5 },
    );
    expect(result.matched).toBe(2);
    expect(result.offset).toBe(0);
  });

  it("通过线按全部期望音算，漏掉的算没弹对", () => {
    const long = expected(
      Array.from({ length: 10 }, (_, i) => ({ start: i * 0.5, freq: A4 })),
    );
    const onlyEight = detected(Array.from({ length: 8 }, (_, i) => ({ start: i * 0.5, freq: A4 })));
    const result = judgeTake(long, onlyEight);
    expect(result.pitchOkRatio).toBeCloseTo(0.8, 2);
    // 漏 2 个刚好在容限内，比例也刚好到线
    expect(result.passed).toBe(true);

    const onlySeven = detected(Array.from({ length: 7 }, (_, i) => ({ start: i * 0.5, freq: A4 })));
    expect(judgeTake(long, onlySeven).passed).toBe(false);
  });

  it("默认通过线是 0.8、容 2 个漏音", () => {
    expect(JUDGE_DEFAULTS.passRatio).toBe(0.8);
    expect(JUDGE_DEFAULTS.maxMissed).toBe(2);
  });
});
