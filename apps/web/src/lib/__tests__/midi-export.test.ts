/**
 * @vitest-environment node
 */
/**
 * MIDI 导出的验证方式：**不**调用被测代码去解析自己的输出，
 * 而是在测试里独立写一个 SMF 读取器，逐字节解出事件表再断言。
 * 这样测的是「文件符合 SMF 规范」，而不是「写出来的东西能被自己读回来」。
 */
import { describe, it, expect } from "vitest";
import { scoreToMidi, TICKS_PER_QUARTER, GM_KOTO } from "../midi-export";
import { createEmptyState } from "../jianzi";
import type { NoteColumn, Duration, NoteType } from "../types";

interface ParsedEvent {
  tick: number;
  delta: number;
  status?: number;
  data?: number[];
  meta?: { type: number; payload: number[] };
}

interface ParsedSmf {
  format: number;
  ntrks: number;
  division: number;
  events: ParsedEvent[];
  trackBytes: number;
}

function parseSmf(bytes: Uint8Array): ParsedSmf {
  let i = 0;
  const u8 = () => bytes[i++];
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => (u8() * 0x1000000 + (bytes[i++] << 16) + (bytes[i++] << 8) + bytes[i++]) >>> 0;
  const str = (n: number) => {
    let s = "";
    for (let k = 0; k < n; k++) s += String.fromCharCode(u8());
    return s;
  };
  const vlq = () => {
    let v = 0;
    for (;;) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
  };

  expect(str(4)).toBe("MThd");
  const hlen = u32();
  const format = u16();
  const ntrks = u16();
  const division = u16();
  if (hlen > 6) i += hlen - 6;

  expect(str(4)).toBe("MTrk");
  const tlen = u32();
  const trackEnd = i + tlen;

  const events: ParsedEvent[] = [];
  let tick = 0;
  while (i < trackEnd) {
    const delta = vlq();
    tick += delta;
    const status = u8();
    if (status === 0xff) {
      const type = u8();
      const len = vlq();
      const payload = Array.from(bytes.slice(i, i + len));
      i += len;
      events.push({ tick, delta, meta: { type, payload } });
    } else {
      const hi = status & 0xf0;
      const n = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
      const data = Array.from(bytes.slice(i, i + n));
      i += n;
      events.push({ tick, delta, status, data });
    }
  }
  expect(i).toBe(trackEnd);

  return { format, ntrks, division, events, trackBytes: tlen };
}

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

function withTone(tone: NoteType): NoteColumn {
  const state = createEmptyState();
  state.toneType = tone;
  return makeNote({ jianzi: state });
}

const noteOns = (evs: ParsedEvent[]) =>
  evs.filter((e) => ((e.status ?? 0) & 0xf0) === 0x90 && e.data![1] > 0);
const noteOffs = (evs: ParsedEvent[]) => evs.filter((e) => ((e.status ?? 0) & 0xf0) === 0x80);

describe("scoreToMidi 文件结构", () => {
  it("写出合法的 SMF format 0 单轨文件", () => {
    const smf = parseSmf(scoreToMidi([makeNote()], { title: "测试" }));
    expect(smf.format).toBe(0);
    expect(smf.ntrks).toBe(1);
    expect(smf.division).toBe(TICKS_PER_QUARTER);
    expect(smf.division).toBe(480);
  });

  it("轨道以 End of Track 结束，且长度字段与实际字节一致", () => {
    const bytes = scoreToMidi([makeNote(), makeNote()]);
    const smf = parseSmf(bytes);
    const last = smf.events[smf.events.length - 1];
    expect(last.meta?.type).toBe(0x2f);
    // 头 14 字节 + MTrk(8) + 轨道体
    expect(bytes.length).toBe(14 + 8 + smf.trackBytes);
  });

  it("空谱也是合法文件（只有元事件）", () => {
    const smf = parseSmf(scoreToMidi([]));
    expect(smf.events.some((e) => e.meta?.type === 0x2f)).toBe(true);
    expect(noteOns(smf.events)).toHaveLength(0);
  });

  it("曲名按 UTF-8 写入轨道名事件", () => {
    const smf = parseSmf(scoreToMidi([makeNote()], { title: "阳关三叠" }));
    const name = smf.events.find((e) => e.meta?.type === 0x03)!;
    expect(new TextDecoder().decode(Uint8Array.from(name.meta!.payload))).toBe("阳关三叠");
  });
});

describe("scoreToMidi 速度与拍号", () => {
  it("bpm 编码为 tempo 微秒数", () => {
    const at = (bpm: number) => {
      const e = parseSmf(scoreToMidi([makeNote()], { bpm })).events.find(
        (x) => x.meta?.type === 0x51,
      )!;
      const p = e.meta!.payload;
      return (p[0] << 16) | (p[1] << 8) | p[2];
    };
    expect(at(60)).toBe(1_000_000);
    expect(at(120)).toBe(500_000);
    expect(at(72)).toBe(833_333);
  });

  it("拍号写成 nn dd cc bb，分母 4 → dd=2", () => {
    const e = parseSmf(scoreToMidi([makeNote()], { beatsPerBar: 3 })).events.find(
      (x) => x.meta?.type === 0x58,
    )!;
    expect(e.meta!.payload).toEqual([3, 2, 24, 8]);
  });

  it("默认音色为 GM Koto", () => {
    const e = parseSmf(scoreToMidi([makeNote()])).events.find((x) => x.status === 0xc0)!;
    expect(e.data).toEqual([GM_KOTO]);
  });
});

describe("scoreToMidi 音高与节奏", () => {
  it("简谱 1=F：未标记「1」= F2(41)，「5」= C3(48)", () => {
    const [c] = noteOns(parseSmf(scoreToMidi([makeNote({ jianpuNumber: "1" })])).events);
    const [g] = noteOns(parseSmf(scoreToMidi([makeNote({ jianpuNumber: "5" })])).events);
    expect(c.data![0]).toBe(41);
    expect(g.data![0]).toBe(48);
  });

  // 谱字写了「几弦几徽」，音高就该是那个位置的实际音高，而不是简谱那一列的相对音高：
  // 否则导出的 MIDI 与谱面是两个调，拿去伴奏一定对不上。
  it("有谱字时以谱字音高为准（散挑五 = 正调五弦 A2 = 45）", () => {
    const state = createEmptyState();
    state.toneType = "散";
    state.rightAction = "乚";
    state.stringNumber = "五";
    // 简谱故意写 5（会算出 G4=67），谱字应覆盖它
    const [e] = noteOns(parseSmf(scoreToMidi([makeNote({ jianpuNumber: "5", jianzi: state })])).events);
    expect(e.data![0]).toBe(45);
  });

  it("只有谱字、没有简谱的音也发声", () => {
    const state = createEmptyState();
    state.toneType = "散";
    state.rightAction = "乚";
    state.stringNumber = "六";
    const [e] = noteOns(
      parseSmf(scoreToMidi([makeNote({ jianpuNumber: null, jianzi: state })])).events,
    );
    // 正调六弦 C3 = 48
    expect(e.data![0]).toBe(48);
  });

  it("定弦换到慢角调，同一谱字音高跟着变（三弦 E2 = 40）", () => {
    const state = createEmptyState();
    state.toneType = "散";
    state.rightAction = "乚";
    state.stringNumber = "三";
    const zheng = noteOns(parseSmf(scoreToMidi([makeNote({ jianzi: state })])).events)[0];
    const man = noteOns(
      parseSmf(scoreToMidi([makeNote({ jianzi: state })], { tuning: "manjiao" })).events,
    )[0];
    expect(zheng.data![0]).toBe(41); // F2
    expect(man.data![0]).toBe(40); // E2
  });

  it("八度记号 ±1 / ±2 各自平移 12 / 24（基准 1=F 的 F2=41）", () => {
    const pitch = (octave: NoteColumn["jianpuOctave"]) =>
      noteOns(parseSmf(scoreToMidi([makeNote({ jianpuNumber: "1", jianpuOctave: octave })])).events)[0]
        .data![0];
    expect(pitch("")).toBe(41);
    expect(pitch("·")).toBe(53);
    expect(pitch("··")).toBe(65);
    expect(pitch(",")).toBe(29);
    expect(pitch(",,")).toBe(17);
  });

  it("时值按四分音符 480 ticks 换算", () => {
    const cases: [Duration, boolean, number][] = [
      ["全", false, 1920],
      ["二分", false, 960],
      ["四分", false, 480],
      ["八分", false, 240],
      ["十六分", false, 120],
      ["四分", true, 720],
    ];
    for (const [duration, dot, ticks] of cases) {
      // gate=1：本用例只想验证「时值换算」，发音留缝另有单独用例
      const evs = parseSmf(scoreToMidi([makeNote({ duration, jianpuDot: dot })], { gate: 1 })).events;
      expect(noteOns(evs)[0].tick).toBe(0);
      expect(noteOffs(evs)[0].tick).toBe(ticks);
    }
  });

  it("多音累加不丢 tick（三连音式分数时值也不漂移）", () => {
    const notes = Array.from({ length: 7 }, () => makeNote({ duration: "八分" as Duration }));
    const evs = parseSmf(scoreToMidi(notes, { gate: 1 })).events;
    const ons = noteOns(evs).map((e) => e.tick);
    expect(ons).toEqual([0, 240, 480, 720, 960, 1200, 1440]);
    expect(noteOffs(evs)[6].tick).toBe(1680);
  });

  it("休止与无简谱的音只推进时间、不发声", () => {
    const evs = parseSmf(
      scoreToMidi([
        makeNote({ jianpuNumber: null, duration: "四分" }),
        makeNote({ jianpuNumber: "0", duration: "八分" }),
        makeNote({ jianpuNumber: "6", duration: "四分" }),
      ]),
    ).events;
    const ons = noteOns(evs);
    expect(ons).toHaveLength(1);
    expect(ons[0].tick).toBe(720);
    expect(ons[0].data![0]).toBe(50); // 纯简谱「6」= 1=F 的 D3 (MIDI 50)
  });

  it("发音留缝：默认 gate 0.9，四分音符响 432 ticks", () => {
    const evs = parseSmf(scoreToMidi([makeNote()])).events;
    expect(noteOffs(evs)[0].tick).toBe(432);
  });

  it("gate 可调，且不会把极短音符压成 0", () => {
    const short = parseSmf(scoreToMidi([makeNote({ duration: "十六分" })], { gate: 0.01 })).events;
    expect(noteOffs(short)[0].tick).toBe(1);
  });

  it("力度按音色区分：散 > 按 > 泛", () => {
    const vel = (t: NoteType) => noteOns(parseSmf(scoreToMidi([withTone(t)])).events)[0].data![1];
    expect(vel("散")).toBeGreaterThan(vel("按"));
    expect(vel("按")).toBeGreaterThan(vel("泛"));
    expect(vel("泛")).toBe(76);
  });
});

describe("scoreToMidi 歌词与注释", () => {
  it("带歌词的音在开音之前写 lyric 事件", () => {
    const evs = parseSmf(
      scoreToMidi([makeNote({ lyric: "关" }), makeNote({ lyric: "山" })]),
    ).events;
    const lyrics = evs.filter((e) => e.meta?.type === 0x05);
    expect(lyrics).toHaveLength(2);
    expect(new TextDecoder().decode(Uint8Array.from(lyrics[0].meta!.payload))).toBe("关");
    expect(lyrics[0].tick).toBe(0);
    expect(lyrics[1].tick).toBe(480);

    // 同 tick 上 lyric 必须先于 note-on
    const firstOn = evs.findIndex((e) => ((e.status ?? 0) & 0xf0) === 0x90);
    const firstLyric = evs.findIndex((e) => e.meta?.type === 0x05);
    expect(firstLyric).toBeLessThan(firstOn);
  });

  it("注释里写明推定音高与基准音不影响文件", () => {
    const smf = parseSmf(scoreToMidi([makeNote()], { concertPitch: 415 }));
    const text = smf.events.find((e) => e.meta?.type === 0x01)!;
    const s = new TextDecoder().decode(Uint8Array.from(text.meta!.payload));
    expect(s).toContain("A4=440");
    expect(s).toContain("415");
    expect(s).toContain("fingering");
  });
});
