/**
 * @vitest-environment jsdom
 *
 * 音频导出：离线渲染 → WAV 编码 → 触发下载。
 *
 * 这里刻意不碰真实 Web Audio（jsdom 没有实现），而是
 * ① 假 OfflineAudioContext 记录渲染参数；
 * ② mock 掉合成函数，只校验"谁在什么时刻被调度"；
 * ③ WAV 编码是纯函数，用真实字节头 + 采样点逐字节断言。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NoteColumn } from "../types";
import {
  renderScoreToBuffer,
  audioBufferToWav,
  downloadWav,
} from "../audio-export";
import { schedulePluck, scheduleClick } from "../audio-synth";

vi.mock("../audio-synth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audio-synth")>();
  return { ...actual, schedulePluck: vi.fn(), scheduleClick: vi.fn() };
});

const pluck = vi.mocked(schedulePluck);
const click = vi.mocked(scheduleClick);

/** 记录最近一次构造参数的假离线上下文。 */
class FakeOfflineAudioContext {
  static last: { channels: number; length: number; sampleRate: number } | null =
    null;
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {
    FakeOfflineAudioContext.last = { channels, length, sampleRate };
  }
  startRendering(): Promise<AudioBuffer> {
    return Promise.resolve(
      fakeBuffer([new Float32Array(this.length)], this.sampleRate),
    );
  }
}

function fakeBuffer(channels: Float32Array[], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData: (c: number) => channels[c],
  } as unknown as AudioBuffer;
}

function note(overrides: Partial<NoteColumn> = {}): NoteColumn {
  return {
    id: "n",
    jianpuNumber: "1",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: {
      toneType: "散",
      rhythmMode: null,
      leftFinger: null,
      hui: null,
      fen: null,
      rightAction: "勹",
      stringNumber: "五",
    },
    ...overrides,
  };
}

const REST: NoteColumn = note({
  jianpuNumber: "0",
  jianzi: {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    rightAction: null,
    stringNumber: null,
  },
});

beforeEach(() => {
  vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
  pluck.mockClear();
  click.mockClear();
  FakeOfflineAudioContext.last = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("renderScoreToBuffer", () => {
  it("按排期拨弦，跳过休止符", async () => {
    await renderScoreToBuffer([note(), REST], 60);

    expect(pluck).toHaveBeenCalledTimes(1);
    const [ctx, freq, time, duration, toneType] = pluck.mock.calls[0];
    expect(ctx).toBeInstanceOf(FakeOfflineAudioContext);
    expect(freq).toBeCloseTo(261.63, 1); // 简谱 1 = C4
    expect(time).toBe(0);
    expect(duration).toBe(1); // bpm 60 → 四分音符 1 秒
    expect(toneType).toBe("散");
  });

  it("渲染长度 = 末音结束 + 音色尾长 + 0.3s 余量", async () => {
    // 第一个散音：0–1s + tail 2.0；休止符：1–2s + 默认按音 tail 0.5
    await renderScoreToBuffer([note(), REST], 60);

    expect(FakeOfflineAudioContext.last).toEqual({
      channels: 1,
      length: Math.ceil((3 + 0.3) * 44100),
      sampleRate: 44100,
    });
  });

  it("空谱也能渲染出极短静音轨", async () => {
    await renderScoreToBuffer([], 60);

    expect(pluck).not.toHaveBeenCalled();
    expect(FakeOfflineAudioContext.last?.length).toBe(Math.ceil(0.3 * 44100));
  });

  it("预备拍把旋律整体推迟，并只在该区间打拍", async () => {
    // bpm 60、4/4、1 小节预备拍 = 4 秒前导
    await renderScoreToBuffer([note(), REST], 60, {
      leadInBars: 1,
      beatsPerBar: 4,
      withMetronome: true,
    });

    expect(pluck).toHaveBeenCalledTimes(1);
    expect(pluck.mock.calls[0][2]).toBe(4);

    // 音轨 7.3s（前导 4s + 旋律 3s + 0.3s 余量）→ 0–8 拍共 9 个拍点，
    // 但第 9 个拍点 t=8.05s 已超出音轨，被裁掉，只剩 8 个
    expect(click).toHaveBeenCalledTimes(8);
    expect(click.mock.calls[0][1]).toBeCloseTo(0.05, 5);
    expect(click.mock.calls.map((c) => c[2])).toEqual([
      true, false, false, false,
      true, false, false, false,
    ]);
  });

  it("不开节拍器就不排点击声", async () => {
    await renderScoreToBuffer([note()], 60, { leadInBars: 2 });

    expect(click).not.toHaveBeenCalled();
    expect(pluck.mock.calls[0][2]).toBe(8); // 2 小节 × 4 拍 × 1 秒
  });

  it("单拍小节（beatsPerBar=0）视为无效，不排点击声", async () => {
    await renderScoreToBuffer([note()], 60, {
      withMetronome: true,
      beatsPerBar: 0,
    });

    expect(click).not.toHaveBeenCalled();
  });

  it("自定义采样率与拍号都会生效", async () => {
    await renderScoreToBuffer([note()], 120, {
      sampleRate: 22050,
      withMetronome: true,
      beatsPerBar: 3,
    });

    expect(FakeOfflineAudioContext.last?.sampleRate).toBe(22050);
    // bpm 120 → 每拍 0.5s，3 拍一小节 → 每 3 个拍点为重音
    expect(click.mock.calls[0][2]).toBe(true);
    expect(click.mock.calls[3][2]).toBe(true);
    expect(click.mock.calls[1][2]).toBe(false);
  });
});

describe("audioBufferToWav", () => {
  function ascii(view: DataView, off: number, len: number): string {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
    return s;
  }

  it("写出标准 44 字节 WAV 头", () => {
    const frames = 4;
    const ab = audioBufferToWav(fakeBuffer([new Float32Array(frames)], 22050));
    const view = new DataView(ab);

    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + frames * 2);
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // 单声道
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint32(28, true)).toBe(22050 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(frames * 2);
    expect(ab.byteLength).toBe(44 + frames * 2);
  });

  it("采样点压到 int16 并截断越界值", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
    const view = new DataView(audioBufferToWav(fakeBuffer([samples])));
    const read = (i: number) => view.getInt16(44 + i * 2, true);

    expect(read(0)).toBe(0);
    expect(read(1)).toBe(16383);
    expect(read(2)).toBe(-16384);
    expect(read(3)).toBe(32767);
    expect(read(4)).toBe(-32768);
    expect(read(5)).toBe(32767); // 2 被截到 1
    expect(read(6)).toBe(-32768); // -2 被截到 -1
  });

  it("多声道按帧交错写入", () => {
    const left = new Float32Array([0.25, 0.5]);
    const right = new Float32Array([-0.25, -0.5]);
    const view = new DataView(audioBufferToWav(fakeBuffer([left, right], 48000)));

    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(32, true)).toBe(4); // 2 声道 × 16bit
    expect(view.getUint32(40, true)).toBe(8); // 2 帧 × 2 声道 × 2 字节

    expect(view.getInt16(44, true)).toBe(8191); // L0
    expect(view.getInt16(46, true)).toBe(-8192); // R0
    expect(view.getInt16(48, true)).toBe(16383); // L1
    expect(view.getInt16(50, true)).toBe(-16384); // R1
  });
});

describe("downloadWav", () => {
  it("生成 wav 文件名并触发下载后清理 DOM", async () => {
    let createdBlob: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      createdBlob = blob;
      return "blob:fake";
    });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });

    let clickedName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clickedName = this.download;
      },
    );

    downloadWav(fakeBuffer([new Float32Array(2)]), "花非花");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createdBlob as unknown as Blob;
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 2 * 2);
    expect(clickedName).toBe("花非花.wav");
    // 临时 <a> 必须清理掉，否则反复导出会在 body 里堆积
    expect(document.querySelectorAll("a").length).toBe(0);

    await new Promise((r) => setTimeout(r, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("文件名已有 .wav 后缀时不重复追加", () => {
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:x"),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    let clickedName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clickedName = this.download;
      },
    );

    downloadWav(fakeBuffer([new Float32Array(1)]), "out.wav");

    expect(clickedName).toBe("out.wav");
  });
});
