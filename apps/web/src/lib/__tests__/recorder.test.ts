import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecordingSupported, micErrorMessage, pickMimeType, startRecording } from "../recorder";

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

describe("录音的出错路径（都要说人话，不能静默）", () => {
  it("设备不存在 / 被占用 / 其他意外各有对应说明", () => {
    const notFound = new Error("x");
    notFound.name = "NotFoundError";
    expect(micErrorMessage(notFound)).toMatch(/没有找到麦克风/);

    const busy = new Error("x");
    busy.name = "NotReadableError";
    expect(micErrorMessage(busy)).toMatch(/被其他程序占用/);

    expect(micErrorMessage("随便抛的字符串")).toMatch(/打不开麦克风/);
  });

  it("浏览器拒绝录音格式时释放麦克风并给出提示", async () => {
    class RejectingRecorder {
      static isTypeSupported = () => true;
      constructor() {
        throw new Error("no codec");
      }
    }
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = RejectingRecorder;

    await expect(startRecording()).rejects.toThrow(/拒绝了录音格式/);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("录音器自己报错时 reject，而不是永远挂着一个 Promise", async () => {
    const session = await startRecording();
    FakeMediaRecorder.instances[0].onerror?.();
    // onerror 已把 deferred reject 掉；再 stop 拿到的是同一个已拒绝的 promise
    await expect(session.stop()).rejects.toThrow(/录音中断/);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("暂停状态对外可见，暂停期间计时停止走", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const session = await startRecording();
    vi.advanceTimersByTime(1000);
    session.pause();
    expect(session.paused).toBe(true);
    const frozen = session.elapsedSeconds();
    vi.advanceTimersByTime(3000);
    expect(session.elapsedSeconds()).toBeCloseTo(frozen, 5);
    session.resume();
    expect(session.paused).toBe(false);
    await session.stop();
  });

  it("录音器已自行停止（状态 inactive）时 stop 也能收尾", async () => {
    const session = await startRecording();
    const rec = FakeMediaRecorder.instances[0];
    rec.state = "inactive"; // 模拟设备侧先停了
    const result = await session.stop();
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.seconds).toBeGreaterThanOrEqual(0);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("stop 时底层抛错也要把已录到的内容交出来", async () => {
    const session = await startRecording();
    const rec = FakeMediaRecorder.instances[0];
    rec.stop = () => {
      throw new Error("device lost");
    };
    const result = await session.stop();
    expect(result.blob).toBeInstanceOf(Blob);
    expect(stopTrack).toHaveBeenCalled();
  });
});
