/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { detectPitch, toneBuffer } from "../pitch-detect";

const SR = 44100;
const N = 2048;

/** 音分误差，判断「读得准不准」比 Hz 更贴近调音场景。 */
const cents = (a: number, b: number) => Math.abs(1200 * Math.log2(a / b));

describe("detectPitch 纯音", () => {
  it("认得出古琴最低的空弦（正调一弦 C2 65.41Hz）", () => {
    const r = detectPitch(toneBuffer(65.41, SR, N), SR);
    expect(r.freq).not.toBeNull();
    expect(cents(r.freq!, 65.41)).toBeLessThan(5);
    expect(r.clarity).toBeGreaterThan(0.9);
  });

  it("五弦 110Hz、七弦 146.83Hz 都读得准", () => {
    for (const f of [110, 146.83]) {
      const r = detectPitch(toneBuffer(f, SR, N), SR);
      expect(cents(r.freq!, f)).toBeLessThan(5);
    }
  });

  it("高音区（三徽泛音量级 1000Hz）仍在搜索范围内", () => {
    const r = detectPitch(toneBuffer(1000, SR, N), SR);
    expect(cents(r.freq!, 1000)).toBeLessThan(10);
  });

  it("低于静音阈值时不出读数", () => {
    const r = detectPitch(new Float32Array(N), SR);
    expect(r.freq).toBeNull();
    expect(r.rms).toBe(0);
  });

  it("直流偏置不影响结果（麦克风常见）", () => {
    const buf = toneBuffer(110, SR, N);
    for (let i = 0; i < buf.length; i++) buf[i] += 0.3;
    const r = detectPitch(buf, SR);
    expect(cents(r.freq!, 110)).toBeLessThan(5);
  });
});

describe("detectPitch 抗谐波与抗噪", () => {
  it("谐波丰富时仍报基频，不会跳到八度", () => {
    const r = detectPitch(toneBuffer(65.41, SR, N, [1, 0.8, 0.6, 0.4]), SR);
    expect(cents(r.freq!, 65.41)).toBeLessThan(10);
  });

  it("基频比二次谐波还弱时，仍取基频（取最强峰就会报高八度）", () => {
    const r = detectPitch(toneBuffer(73.42, SR, N, [0.25, 1, 0.7]), SR);
    expect(r.freq).not.toBeNull();
    expect(cents(r.freq!, 73.42)).toBeLessThan(15);
  });

  it("白噪声判为不可信", () => {
    const buf = new Float32Array(N);
    let seed = 12345;
    for (let i = 0; i < N; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      buf[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    const r = detectPitch(buf, SR);
    expect(r.freq).toBeNull();
  });

  it("音量大小不影响读数（归一化生效）", () => {
    const loud = detectPitch(toneBuffer(98, SR, N, [1]), SR);
    const softBuf = toneBuffer(98, SR, N, [1]).map((v) => v * 0.02);
    const soft = detectPitch(new Float32Array(softBuf), SR);
    expect(soft.freq).not.toBeNull();
    expect(cents(soft.freq!, 98)).toBeLessThan(10);
    expect(cents(loud.freq!, 98)).toBeLessThan(5);
  });
});
