/**
 * @vitest-environment jsdom
 *
 * Karplus-Strong 拨弦合成 / 节拍点击声。
 *
 * 这两条链路以前只有「人工听」，因为 jsdom 没有 Web Audio。
 * 其实合成函数只依赖 BaseAudioContext 的三个能力（createBuffer /
 * createBufferSource / destination、sampleRate），用一个假上下文就能
 * 逐样本验证：缓冲长度、包络、衰减差异、确定性、起播时间。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { schedulePluck, scheduleClick, TONE_PROFILE } from "../audio-synth";

/** 最小可用的 AudioBuffer 替身。 */
class FakeBuffer {
  readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }
  getChannelData(c: number): Float32Array {
    return this.channels[c];
  }
}

class FakeSource {
  buffer: FakeBuffer | null = null;
  connectedTo: unknown = null;
  starts: number[] = [];
  connect(node: unknown): unknown {
    this.connectedTo = node;
    return node;
  }
  start(time: number): void {
    this.starts.push(time);
  }
}

class FakeContext {
  readonly destination = { id: "destination" };
  readonly buffers: FakeBuffer[] = [];
  readonly sources: FakeSource[] = [];

  constructor(readonly sampleRate = 44100) {}

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const buf = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(buf);
    return buf;
  }

  createBufferSource(): FakeSource {
    const src = new FakeSource();
    this.sources.push(src);
    return src;
  }
}

function makeCtx(sampleRate = 44100) {
  const ctx = new FakeContext(sampleRate);
  return ctx;
}

/** 把假上下文塞进签名要求的 BaseAudioContext。 */
function asBase(ctx: FakeContext): BaseAudioContext {
  return ctx as unknown as BaseAudioContext;
}

function peak(data: Float32Array, from = 0, to = data.length): number {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(data[i]));
  return m;
}

function rms(data: Float32Array, from = 0, to = data.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("schedulePluck · 缓冲与调度", () => {
  it("缓冲长度 = 采样率 ×（时值 + 该音色的尾长）", () => {
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 261.63, 0, 1, "散");

    expect(ctx.buffers).toHaveLength(1);
    expect(ctx.buffers[0].numberOfChannels).toBe(1);
    expect(ctx.buffers[0].sampleRate).toBe(44100);
    // 散音 tail 2.0s
    expect(ctx.buffers[0].length).toBe(Math.floor(44100 * (1 + 2)));
  });

  it("时值低于 0.2s 时按 0.2s 保底（短音也要听得到）", () => {
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 440, 0, 0.02, "泛");

    expect(ctx.buffers[0].length).toBe(Math.floor(44100 * (0.2 + 0.05)));
  });

  it("未指定音色时退回按音参数", () => {
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 440, 0, 0.1, null);

    expect(ctx.buffers[0].length).toBe(
      Math.floor(44100 * (0.2 + TONE_PROFILE["按"].tail)),
    );
  });

  it("接到 destination，并用给定时间起播", () => {
    const ctx = makeCtx();
    const src = schedulePluck(asBase(ctx), 440, 1.25, 0.5, "按");

    const fake = src as unknown as FakeSource;
    expect(fake.buffer).toBe(ctx.buffers[0]);
    expect(fake.connectedTo).toBe(ctx.destination);
    expect(fake.starts).toEqual([1.25]);
    // 只起播不 stop：缓冲播完自然结束
    expect("stop" in fake).toBe(false);
  });

  it("采样率跟着上下文走（22050 时长度减半）", () => {
    const ctx = makeCtx(22050);
    schedulePluck(asBase(ctx), 440, 0, 1, "泛");

    expect(ctx.buffers[0].sampleRate).toBe(22050);
    expect(ctx.buffers[0].length).toBe(Math.floor(22050 * (1 + 0.05)));
  });
});

describe("schedulePluck · 波形与包络", () => {
  it("起音渐入、尾部淡出，首尾几乎静音（防爆音）", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.75); // 固定噪声，输出可复现
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 261.63, 0, 0.5, "散");
    const data = ctx.buffers[0].getChannelData(0);

    expect(data[0]).toBe(0); // fadeIn 在 t=0 处为 0
    // 淡出到 t=1 时理论上为 0，但最后一帧是 (length-1)/length，留 1/0.03 个量级的残余
    expect(Math.abs(data[data.length - 1])).toBeLessThan(1e-3);
    // 中段是实音，不是静音
    expect(peak(data, 1000, 2000)).toBeGreaterThan(0.1);
  });

  it("样本永远不超出 [-1, 1]（不会削波）", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 440, 0, 0.5, "散");
    const data = ctx.buffers[0].getChannelData(0);
    expect(peak(data)).toBeLessThanOrEqual(1);
  });

  it("散音衰减比泛音慢：半秒后仍有能量", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9); // ring 全为 0.8，便于比较
    const sr = 44100;
    const half = Math.floor(sr * 0.5);

    const longCtx = makeCtx(sr);
    schedulePluck(asBase(longCtx), 220, 0, 1, "散");
    const longData = longCtx.buffers[0].getChannelData(0);

    const shortCtx = makeCtx(sr);
    schedulePluck(asBase(shortCtx), 220, 0, 1, "泛");
    const shortData = shortCtx.buffers[0].getChannelData(0);

    // 衰减是「每个周期一次」（不是每采样点一次）：0.5s ≈ 110 次迭代
    // 散 0.9975^110 ≈ 0.76，泛 0.99^110 ≈ 0.33 —— 散音明显更响
    expect(rms(longData, half - 500, half)).toBeGreaterThan(0.5);
    expect(rms(shortData, half - 500, half)).toBeLessThan(0.35);
    expect(rms(longData, half - 500, half)).toBeGreaterThan(
      rms(shortData, half - 500, half) * 1.8,
    );
  });

  it("极高频时周期下限为 2 个采样点，不炸也不出 NaN", () => {
    const ctx = makeCtx(44100);
    schedulePluck(asBase(ctx), 30000, 0, 0.2, "按"); // round(44100/30000) = 1 → clamp 到 2
    const data = ctx.buffers[0].getChannelData(0);

    expect(data.length).toBe(Math.floor(44100 * (0.2 + 0.5)));
    expect(data.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("只在初始化时取随机数（周期个），之后是确定性滤波", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const ctx = makeCtx();
    const freq = 441; // period = 100
    schedulePluck(asBase(ctx), freq, 0, 0.2, "按");

    const period = Math.round(44100 / freq);
    expect(random).toHaveBeenCalledTimes(period);
  });
});

describe("scheduleClick · 节拍点击声", () => {
  it("固定 40ms 短脉冲，接到 destination 并按时起播", () => {
    const ctx = makeCtx();
    const src = scheduleClick(asBase(ctx), 2.5, true);

    const fake = src as unknown as FakeSource;
    expect(ctx.buffers[0].length).toBe(Math.floor(44100 * 0.04));
    expect(fake.buffer).toBe(ctx.buffers[0]);
    expect(fake.connectedTo).toBe(ctx.destination);
    expect(fake.starts).toEqual([2.5]);
  });

  it("强拍比弱拍更响", () => {
    const accentCtx = makeCtx();
    scheduleClick(asBase(accentCtx), 0, true);
    const accentPeak = peak(accentCtx.buffers[0].getChannelData(0));

    const weakCtx = makeCtx();
    scheduleClick(asBase(weakCtx), 0, false);
    const weakPeak = peak(weakCtx.buffers[0].getChannelData(0));

    expect(accentPeak).toBeGreaterThan(weakPeak);
    expect(accentPeak).toBeLessThanOrEqual(1);
  });

  it("尾部迅速衰减到接近静音", () => {
    const ctx = makeCtx();
    scheduleClick(asBase(ctx), 0, false);
    const data = ctx.buffers[0].getChannelData(0);

    const head = rms(data, 0, 100);
    const tail = rms(data, data.length - 100);
    expect(head).toBeGreaterThan(tail * 100);
  });

  it("弱拍衰减更快：同一时刻尾部比强拍更静", () => {
    // 过零率在这里不可靠——噪声(±0.4)在起音段会制造大量假过零，
    // 所以改测更稳的包络差异：decay 34 的弱拍衰减明显快于 decay 26 的强拍。
    const tailRms = (accent: boolean) => {
      const ctx = makeCtx();
      scheduleClick(asBase(ctx), 0, accent);
      const data = ctx.buffers[0].getChannelData(0);
      const mid = Math.floor(data.length / 2);
      return rms(data, mid, data.length);
    };

    expect(tailRms(true)).toBeGreaterThan(tailRms(false));
  });

  it("同一参数两次生成完全一致（点击声用固定种子，不用 Math.random）", () => {
    const random = vi.spyOn(Math, "random");

    const a = makeCtx();
    scheduleClick(asBase(a), 0, true);
    const b = makeCtx();
    scheduleClick(asBase(b), 0, true);

    expect(Array.from(a.buffers[0].getChannelData(0))).toEqual(
      Array.from(b.buffers[0].getChannelData(0)),
    );
    expect(random).not.toHaveBeenCalled();
  });
});

/**
 * 走手音（绰/注）：不是画个偏旁就完事，得真的听见音高滑过来。
 *
 * 这里直接对渲染出的缓冲做自相关测音高——它不是「调没调用某个参数」的
 * 形式化断言，而是从波形反推音高。绰应该起低后高，注起高后低。
 */
describe("schedulePluck 走手音滑音", () => {
  /** 在 [startSec, startSec+winSec] 窗内用自相关测基频。 */
  function pitchAt(
    data: Float32Array,
    sr: number,
    startSec: number,
    winSec = 0.06,
    minF = 250,
    maxF = 700,
  ): number {
    const start = Math.floor(startSec * sr);
    const n = Math.min(Math.floor(winSec * sr), data.length - start);
    const minLag = Math.floor(sr / maxF);
    const maxLag = Math.min(Math.floor(sr / minF), n - 1);
    let best = -1;
    let bestLag = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let dot = 0;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i < n - lag; i++) {
        dot += data[start + i] * data[start + i + lag];
        e1 += data[start + i] * data[start + i];
        e2 += data[start + i + lag] * data[start + i + lag];
      }
      const r = dot / Math.sqrt(e1 * e2 + 1e-12);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    return sr / bestLag;
  }

  it("绰：起音在本位下方，滑到本位后停住", () => {
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 440, 0, 1.0, "按", "绰");
    const data = ctx.buffers[0].getChannelData(0);
    const head = pitchAt(data, 44100, 0.02, 0.05);
    const settled = pitchAt(data, 44100, 0.4, 0.06);
    // 200 音分下起音 → 440 × 2^(-200/1200) ≈ 392Hz
    expect(head).toBeGreaterThan(350);
    expect(head).toBeLessThan(412);
    expect(settled).toBeGreaterThan(425);
    expect(settled).toBeLessThan(455);
    expect(head).toBeLessThan(settled - 15);
  });

  it("注：起音在本位上方，向下滑到本位", () => {
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 440, 0, 1.0, "按", "注");
    const data = ctx.buffers[0].getChannelData(0);
    const head = pitchAt(data, 44100, 0.02, 0.05);
    const settled = pitchAt(data, 44100, 0.4, 0.06);
    expect(head).toBeGreaterThan(470);
    expect(head).toBeLessThan(520);
    expect(settled).toBeGreaterThan(425);
    expect(settled).toBeLessThan(455);
    expect(head).toBeGreaterThan(settled + 15);
  });

  it("不给走手音时音高全程平稳（不走分数延迟分支）", () => {
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 440, 0, 1.0, "按", null);
    const data = ctx.buffers[0].getChannelData(0);
    const a = pitchAt(data, 44100, 0.02, 0.06);
    const b = pitchAt(data, 44100, 0.4, 0.06);
    expect(Math.abs(a - 440)).toBeLessThan(12);
    expect(Math.abs(b - 440)).toBeLessThan(12);
  });

  it("滑音缓冲仍有声音，不是空轨", () => {
    const ctx = makeCtx();
    schedulePluck(asBase(ctx), 440, 0, 1.0, "按", "绰");
    const data = ctx.buffers[0].getChannelData(0);
    expect(rms(data, 0, Math.floor(0.3 * 44100))).toBeGreaterThan(0.01);
  });
});
