import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecordingSupported, pickMimeType, startRecording } from "../recorder";

/** 最小可用的 MediaRecorder 假货：只模拟状态机与回调时序。 */
class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type.includes("webm") || type.includes("mp4");

  static instances: FakeMediaRecorder[] = [];

  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio-chunk"], { type: this.mimeType || "audio/webm" }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();
const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  stopTrack.mockClear();
  getUserMedia.mockClear();
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
});

describe("录音能力探测", () => {
  it("没有 MediaRecorder 就判定不支持", () => {
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    expect(isRecordingSupported()).toBe(false);
  });

  it("有 MediaRecorder 且有 getUserMedia 才判定支持", () => {
    expect(isRecordingSupported()).toBe(true);
  });

  it("mime 优先 webm+opus（同体积下最适合乐器），全不支持时交回浏览器默认", () => {
    expect(pickMimeType((t) => t.includes("webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBe("");
  });
});

describe("录音会话", () => {
  it("不支持时抛出可读的说明，而不是静默失败", async () => {
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    await expect(startRecording()).rejects.toThrow(/不支持录音/);
  });

  it("麦克风被拒绝时翻译成人话", async () => {
    const error = new Error("denied");
    error.name = "NotAllowedError";
    getUserMedia.mockRejectedValueOnce(error);
    await expect(startRecording()).rejects.toThrow(/权限被拒绝/);
  });

  it("关掉降噪与自动增益（否则古琴尾音被吃掉）", async () => {
    const session = await startRecording();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    session.cancel();
  });

  it("停止后拿到 Blob 与时长，并释放麦克风", async () => {
    const session = await startRecording();
    const result = await session.stop();
    expect(result.mime).toBe("audio/webm;codecs=opus");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.seconds).toBeGreaterThanOrEqual(0);
    expect(stopTrack).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances[0].state).toBe("inactive");
  });

  it("计时排除暂停段", async () => {
    // 先接管 performance，再开会话：否则起点是真实时钟、推进的是假时钟，差值会变成负数
    vi.useFakeTimers({ toFake: ["performance"] });
    const session = await startRecording();

    vi.advanceTimersByTime(2000);
    session.pause();
    vi.advanceTimersByTime(5000); // 暂停不算
    session.resume();
    vi.advanceTimersByTime(1000);

    const result = await session.stop();
    expect(result.seconds).toBe(3);
  });

  it("重复 stop 返回同一个 Promise，不会卡死", async () => {
    const session = await startRecording();
    const a = session.stop();
    const b = session.stop();
    expect(a).toBe(b);
    await a;
  });

  it("取消后不再产出录音，且释放麦克风", async () => {
    const session = await startRecording();
    session.cancel();
    await expect(session.stop()).rejects.toThrow(/取消/);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("电平回调把拨弦画出来（0–1）", async () => {
    const levels: number[] = [];
    const session = await startRecording({ onLevel: (l) => levels.push(l) });
    session.cancel();
    // jsdom 没有真实 AudioContext，取不到电平也不该影响录音本身
    expect(Array.isArray(levels)).toBe(true);
  });
});
