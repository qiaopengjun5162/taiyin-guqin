/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TUNINGS,
  DEFAULT_TUNING,
  getTuningById,
  openStringMidi,
  openStringFrequency,
  centsFrom,
  nearestString,
  getTuning,
  setTuning,
  subscribeTuning,
  resetTuningCache,
} from "../tuning";
import { jianziToFrequency, jianziToJianpu } from "../jianzi-pitch";
import { createEmptyState } from "../jianzi";
import type { JianziState } from "../types";

const state = (o: Partial<JianziState> = {}): JianziState => ({ ...createEmptyState(), ...o });

beforeEach(() => {
  window.localStorage.clear();
  resetTuningCache();
});

describe("定弦表", () => {
  it("三张定弦都是七根弦，MIDI 号递增（一弦最低）", () => {
    for (const t of TUNINGS) {
      expect(t.openMidi).toHaveLength(7);
      expect(t.noteNames).toHaveLength(7);
      for (let i = 1; i < t.openMidi.length; i++) {
        expect(t.openMidi[i]).toBeGreaterThan(t.openMidi[i - 1]);
      }
    }
  });

  it("正调就是文章给的 C2 D2 F2 G2 A2 C3 D3", () => {
    const t = getTuningById("zhengdiao");
    expect(t.noteNames).toEqual(["C2", "D2", "F2", "G2", "A2", "C3", "D3"]);
    expect(t.openMidi).toEqual([36, 38, 41, 43, 45, 48, 50]);
  });

  it("蕤宾调只紧五弦半音，其余六弦与正调一致", () => {
    const zheng = getTuningById("zhengdiao");
    const rui = getTuningById("ruibin");
    rui.openMidi.forEach((m, i) => {
      if (i === 4) expect(m - zheng.openMidi[i]).toBe(1);
      else expect(m).toBe(zheng.openMidi[i]);
    });
    expect(rui.noteNames[4]).toBe("B♭2");
  });

  it("慢角调只慢三弦半音，其余六弦与正调一致", () => {
    const zheng = getTuningById("zhengdiao");
    const man = getTuningById("manjiao");
    man.openMidi.forEach((m, i) => {
      if (i === 2) expect(zheng.openMidi[i] - m).toBe(1);
      else expect(m).toBe(zheng.openMidi[i]);
    });
    expect(man.noteNames[2]).toBe("E2");
  });

  it("弦序非法时返回 null", () => {
    expect(openStringMidi(null, "zhengdiao")).toBeNull();
    expect(openStringMidi("八", "zhengdiao")).toBeNull();
  });

  it("空弦频率 = 基准音 × 2^((midi−69)/12)", () => {
    expect(openStringFrequency("五", "zhengdiao", 440)).toBeCloseTo(110, 1);
    expect(openStringFrequency("五", "zhengdiao", 432)).toBeCloseTo(108, 1);
  });
});

describe("最近空弦匹配", () => {
  it("准音匹配到本弦，偏差接近 0", () => {
    const m = nearestString(65.41, "zhengdiao")!;
    expect(m.stringNumber).toBe("一");
    expect(Math.abs(m.cents)).toBeLessThan(1);
  });

  it("偏高 30 音分仍认作同一根弦（不会跳到隔壁）", () => {
    const m = nearestString(65.41 * Math.pow(2, 30 / 1200), "zhengdiao")!;
    expect(m.stringNumber).toBe("一");
    expect(m.cents).toBeCloseTo(30, 0);
  });

  it("慢角调读到 E2 时匹配三弦；换成正调则显示三弦偏低约一百音分", () => {
    const man = nearestString(82.41, "manjiao")!;
    expect(man.stringNumber).toBe("三");
    expect(Math.abs(man.cents)).toBeLessThan(1);

    const asZheng = nearestString(82.41, "zhengdiao")!;
    expect(asZheng.stringNumber).toBe("三");
    expect(asZheng.cents).toBeCloseTo(-100, -1);
  });

  it("基准音改变时目标跟着平移", () => {
    const at440 = nearestString(110, "zhengdiao", 440)!;
    const at415 = nearestString(110, "zhengdiao", 415)!;
    expect(at440.cents).toBeCloseTo(0, 0);
    expect(at415.cents).toBeGreaterThan(80); // 相对 415 的琴，110Hz 已偏高约 100 音分
  });

  it("非法频率返回 null", () => {
    expect(nearestString(0, "zhengdiao")).toBeNull();
  });
});

describe("音分换算", () => {
  it("同音为 0，高半音约 100，高八度 1200", () => {
    expect(centsFrom(440, 440)).toBeCloseTo(0, 6);
    expect(centsFrom(466.16, 440)).toBeCloseTo(100, 1);
    expect(centsFrom(880, 440)).toBeCloseTo(1200, 6);
  });

  it("非法输入不炸（返回 0）", () => {
    expect(centsFrom(0, 440)).toBe(0);
    expect(centsFrom(440, 0)).toBe(0);
  });
});

describe("减字音高跟着定弦走", () => {
  it("三弦散音：正调是 F2，慢角调是 E2", () => {
    const s = state({ toneType: "散", stringNumber: "三" });
    expect(jianziToFrequency(s, { tuning: "zhengdiao" })).toBeCloseTo(87.31, 1);
    expect(jianziToFrequency(s, { tuning: "manjiao" })).toBeCloseTo(82.41, 1);
  });

  it("五弦散音：正调是 A2，蕤宾调是 B♭2", () => {
    const s = state({ toneType: "散", stringNumber: "五" });
    expect(jianziToFrequency(s, { tuning: "zhengdiao" })).toBeCloseTo(110, 1);
    expect(jianziToFrequency(s, { tuning: "ruibin" })).toBeCloseTo(116.54, 1);
  });

  it("同一根弦的按音音程不变，只是整体平移", () => {
    const s = state({ toneType: "按", stringNumber: "三", hui: "七" });
    const zheng = jianziToFrequency(s, { tuning: "zhengdiao" })!;
    const man = jianziToFrequency(s, { tuning: "manjiao" })!;
    expect(zheng / man).toBeCloseTo(Math.pow(2, 1 / 12), 6);
  });

  it("慢角调三弦散音反推出的是 7,（E2，比 F2 低半音），不是别的", () => {
    const s = state({ toneType: "散", stringNumber: "三" });
    // 正调三弦 = F2（宫，1=F2）→ 1；慢角调三弦慢半音变 E2 → 7,
    expect(jianziToJianpu(s, { tuning: "zhengdiao" })).toEqual({ number: "1", octave: "" });
    expect(jianziToJianpu(s, { tuning: "manjiao" })).toEqual({ number: "7", octave: "," });
  });

  it("基准音一起参与：415Hz 下一弦散音 = 61.7Hz", () => {
    const s = state({ toneType: "散", stringNumber: "一" });
    expect(jianziToFrequency(s, { concertPitch: 415 })).toBeCloseTo(61.69, 1);
    // 反推唱名不受影响（整床平移，音级不变）：散一弦 C2 → 5,
    expect(jianziToJianpu(s, { concertPitch: 415 })).toEqual({ number: "5", octave: "," });
  });
});

describe("定弦存储", () => {
  it("默认正调，切换后能读回", () => {
    expect(getTuning()).toBe(DEFAULT_TUNING);
    setTuning("ruibin");
    expect(getTuning()).toBe("ruibin");
    resetTuningCache();
    expect(getTuning()).toBe("ruibin");
  });

  it("非法值回落到正调", () => {
    window.localStorage.setItem("taiyin.tuning.v1", "bogus");
    resetTuningCache();
    expect(getTuning()).toBe(DEFAULT_TUNING);
  });

  it("切换会通知订阅者", () => {
    let hits = 0;
    const off = subscribeTuning(() => hits++);
    setTuning("manjiao");
    expect(hits).toBe(1);
    off();
    setTuning("zhengdiao");
    expect(hits).toBe(1);
  });
});
