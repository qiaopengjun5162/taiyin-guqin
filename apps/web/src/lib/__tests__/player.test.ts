/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { jianpuToFrequency, buildSchedule, columnFrequency, columnMidi } from "../player";
import { createEmptyState } from "../jianzi";
import type { JianziState, NoteColumn } from "../types";

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
  it("1=F 记谱：未标记的「1」= F2（MIDI 41，正调三弦）≈ 87.31Hz", () => {
    expect(jianpuToFrequency("1", "")).toBeCloseTo(87.31, 1);
  });

  it("1=F 记谱：未标记的「5」= C3（六弦散音）≈ 130.81Hz", () => {
    expect(jianpuToFrequency("5", "")).toBeCloseTo(130.81, 1);
  });

  it("applies octave offsets", () => {
    expect(jianpuToFrequency("1", "·")).toBeCloseTo(174.61, 1); // F3
    expect(jianpuToFrequency("1", ",")).toBeCloseTo(43.65, 1); // F1
  });

  it("applies double-octave offsets (±2)", () => {
    expect(jianpuToFrequency("1", "··")).toBeCloseTo(349.23, 1); // F4
    expect(jianpuToFrequency("1", ",,")).toBeCloseTo(21.83, 1); // F0
  });

  it("returns null for rests and missing numbers", () => {
    expect(jianpuToFrequency("0", "")).toBeNull();
    expect(jianpuToFrequency(null, "")).toBeNull();
  });

  it("默认以 A4=440 为基准，1=F 下「6」= D3 ≈ 146.83Hz", () => {
    expect(jianpuToFrequency("6", "")).toBeCloseTo(146.83, 1);
  });

  it("改基准音时整谱等比平移，相对音程不变", () => {
    const at440 = jianpuToFrequency("1", "", 440) as number;
    const at415 = jianpuToFrequency("1", "", 415) as number;
    // 415/440 的比例作用到每个音上
    expect(at415 / at440).toBeCloseTo(415 / 440, 6);

    // 古琴常整床偏低：425Hz 时 F2 约低 60 音分（1200·log2(425/440) ≈ -59.6）
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

  /**
   * 同声（带合）是「左指带起的同时右弹空弦」，两声**同时**响。
   * 若按普通音符排，听感会变成"弹一下、再弹一下"——指法明明是同时的。
   */
  it("同声两声同时起，且不把后面的音推后", () => {
    const head = makeNote({ jianpuNumber: "5", duration: "四分" });
    const member = makeNote({ jianpuNumber: "5", duration: "四分" });
    const next = makeNote({ jianpuNumber: "6", duration: "四分" });
    const schedule = buildSchedule(
      [
        { ...head, lianmei: { kind: "同声", headId: head.id } },
        { ...member, lianmei: { kind: "同声", headId: head.id } },
        next,
      ],
      500,
    );
    expect(schedule[0].start).toBe(0);
    expect(schedule[1].start).toBe(0);
    // 成员不占时间轴：第三个音仍在第一音之后整整一拍
    expect(schedule[2].start).toBe(0.5);
  });

  it("分开/应合/放合 仍是先后发声（只有同声是同时）", () => {
    for (const kind of ["分开", "应合", "放合"] as const) {
      const head = makeNote({ jianpuNumber: "5", duration: "四分" });
      const member = makeNote({ jianpuNumber: "5", duration: "四分" });
      const schedule = buildSchedule(
        [
          { ...head, lianmei: { kind, headId: head.id } },
          { ...member, lianmei: { kind, headId: head.id } },
        ],
        500,
      );
      expect(schedule[0].start).toBe(0);
      expect(schedule[1].start).toBe(0.5);
    }
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
    const notes = [makeNote({ jianzi: playedJianzi("散", "五") }), makeNote({ jianzi: playedJianzi("散", "一") })];
    const at440 = buildSchedule(notes, 500);
    const at415 = buildSchedule(notes, 500, 415);

    expect(at440[0].freq).toBeCloseTo(110, 1); // 正调五弦 A2
    expect(at415[0].freq).toBeCloseTo(103.7, 1); // 整床偏低到 415Hz 等比平移
    // 时值不受基准音影响
    expect(at415.map((s) => s.start)).toEqual(at440.map((s) => s.start));
  });
});

/** 造一个「已填完」的谱字状态。 */
function playedJianzi(
  toneType: JianziState["toneType"],
  stringNumber: string,
  hui: string | null = null,
): JianziState {
  return {
    ...createEmptyState(),
    toneType,
    leftFinger: toneType === "散" ? null : "大",
    hui,
    rightAction: "乚",
    stringNumber,
  };
}

describe("音高来源：谱字优先，简谱兜底", () => {
  it("散音谱字给出该弦的实际音高（正调五弦 A2 ≈ 110Hz），纯简谱兜底也按 1=F", () => {
    const note = makeNote({ jianpuNumber: "5", jianzi: playedJianzi("散", "五") });
    expect(columnFrequency(note)).toBeCloseTo(110, 0);
    // 纯简谱「5」按 1=F（宫=三弦F2）算 = C3 ≈ 130.8Hz，不再是用错的 1=C 的 G4=392
    expect(jianpuToFrequency("5", "")).toBeCloseTo(130.81, 0);
  });

  it("谱字残缺（只有音色没有弦序）时退回简谱（1=F 的 5 = C3）", () => {
    const note = makeNote({ jianpuNumber: "5", jianzi: { ...createEmptyState(), toneType: "散" } });
    expect(columnFrequency(note)).toBeCloseTo(130.81, 0);
  });

  it("纯减字谱（没有简谱）也能发声——以前整首是静音", () => {
    const note = makeNote({ jianpuNumber: null, jianzi: playedJianzi("散", "六") });
    const [s] = buildSchedule([note], 1000);
    expect(s.freq).toBeCloseTo(130.81, 0); // 正调六弦 C3
    expect(s.freq).not.toBeNull();
  });

  it("定弦透传：慢角调三弦 E2 比正调 F2 低半音", () => {
    const note = makeNote({ jianzi: playedJianzi("散", "三") });
    const zheng = buildSchedule([note], 1000)[0].freq as number;
    const man = buildSchedule([note], 1000, 440, "manjiao")[0].freq as number;
    expect(1200 * Math.log2(man / zheng)).toBeCloseTo(-100, 0);
  });

  it("MIDI 号同样谱字优先，且不随基准音变", () => {
    const note = makeNote({ jianpuNumber: "5", jianzi: playedJianzi("散", "五") });
    expect(columnMidi(note)).toBe(45);
    // 基准音只影响播放频率，不改 MIDI 的绝对音高号
    expect(columnMidi(note, "zhengdiao")).toBe(45);
  });

  it("按音按徽位算：正调三弦九徽 = 3 倍空弦（C4），七徽 = 2 倍（F3）", () => {
    const at9 = makeNote({ jianzi: playedJianzi("按", "三", "九") });
    const at7 = makeNote({ jianzi: playedJianzi("按", "三", "七") });
    expect(columnFrequency(at9)).toBeCloseTo(261.92, 0);
    expect(columnFrequency(at7)).toBeCloseTo(174.61, 0);
  });
});

describe("buildSchedule 走手音透传", () => {
  it("把减字上的绰/注带进调度表，播放才能滑音", () => {
    const plain = makeNote({ jianzi: { ...createEmptyState(), toneType: "按", slide: "绰" } });
    const [s] = buildSchedule([plain], 1000);
    expect(s.slide).toBe("绰");
  });

  it("没有走手音时为 null", () => {
    const [s] = buildSchedule([makeNote()], 1000);
    expect(s.slide).toBeNull();
  });

  it("旧存档缺 slide 字段不会炸（当没有走手音）", () => {
    const legacy = makeNote();
    // 模拟旧 JSON：整个字段不存在
    delete (legacy.jianzi as unknown as Record<string, unknown>).slide;
    const [s] = buildSchedule([legacy], 1000);
    expect(s.slide).toBeNull();
  });

  // 急 是急弹记号，音高不动：调度表里必须变成 null，
  // 否则会走进滑音分支、把急弹弹成注音。
  it("「急」不滑音，调度表里是 null", () => {
    const urgent = makeNote({ jianzi: { ...createEmptyState(), toneType: "按", slide: "急" } });
    const [s] = buildSchedule([urgent], 1000);
    expect(s.slide).toBeNull();
  });
});
