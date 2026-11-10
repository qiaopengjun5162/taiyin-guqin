/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TunerPanel } from "../tuner-panel";
import { resetTuningCache } from "@/lib/tuning";
import { resetConcertPitchCache } from "@/lib/concert-pitch";

beforeEach(() => {
  window.localStorage.clear();
  resetTuningCache();
  resetConcertPitchCache();
});

describe("TunerPanel", () => {
  it("列出六种定弦，默认正调，七弦标注 C2…D3", () => {
    render(<TunerPanel />);
    const select = screen.getByLabelText("定弦（调式）") as HTMLSelectElement;
    expect(select.value).toBe("zhengdiao");
    expect(select.options).toHaveLength(6);

    const strings = screen.getByTestId("tuner-strings");
    expect(strings.textContent).toContain("C2");
    expect(strings.textContent).toContain("F2");
    expect(strings.textContent).toContain("A2");
    expect(strings.textContent).toContain("D3");
  });

  it("清商调二弦显示 D♯2（紧二五七弦各自升半音）", () => {
    render(<TunerPanel />);
    fireEvent.change(screen.getByLabelText("定弦（调式）"), { target: { value: "qingshang" } });
    const strings = screen.getByTestId("tuner-strings");
    expect(strings.textContent).toContain("D♯2");
    expect(strings.textContent).toContain("A♯2");
    expect(strings.textContent).toContain("D♯3");
  });

  it("切到慢角调后三弦由 F2 变 E2，说明同步更新", () => {
    render(<TunerPanel />);
    const select = screen.getByLabelText("定弦（调式）") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "manjiao" } });

    const strings = screen.getByTestId("tuner-strings");
    expect(strings.textContent).toContain("E2");
    expect(strings.textContent).not.toContain("F2");
    expect(screen.getByText(/只把三弦慢半音/)).toBeInTheDocument();
    expect(window.localStorage.getItem("taiyin.tuning.v1")).toBe("manjiao");
  });

  it("蕤宾调五弦显示 B♭2", () => {
    render(<TunerPanel />);
    fireEvent.change(screen.getByLabelText("定弦（调式）"), { target: { value: "ruibin" } });
    expect(screen.getByTestId("tuner-strings").textContent).toContain("B♭2");
  });

  it("没有麦克风 API 时给出明确提示，而不是静默失败", async () => {
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    render(<TunerPanel />);
    fireEvent.click(screen.getByLabelText("开始调音"));

    expect(await screen.findByText(/不支持麦克风采集/)).toBeInTheDocument();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: original });
  });

  it("授权被拒时提示去开权限", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<TunerPanel />);
    fireEvent.click(screen.getByLabelText("开始调音"));

    expect(await screen.findByText(/麦克风权限被拒绝/)).toBeInTheDocument();
  });
});

/**
 * 从「点开始」到「读出音高」这条主路径。
 *
 * 之前只测了各类失败提示，成功路径（建 AudioContext、每 80ms 取一帧、
 * 取中位数、匹配最近弦）一行没跑过——而这正是用户 99% 的使用场景。
 */
const pitch = vi.hoisted(() => ({ detectPitch: vi.fn() }));
vi.mock("@/lib/pitch-detect", () => ({ detectPitch: pitch.detectPitch }));

class FakeAnalyser {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  context = { sampleRate: 44100 };
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(0.1);
  }
}
class FakeCtx {
  state = "running";
  sampleRate = 44100;
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  close() {
    return Promise.resolve();
  }
}

describe("TunerPanel · 听音主路径", () => {
  let rafCallback: (() => void) | null = null;
  let ticks = 0;
  const stopTrack = vi.fn();

  beforeEach(() => {
    rafCallback = null;
    ticks = 0;
    stopTrack.mockClear();
    pitch.detectPitch.mockReset();
    pitch.detectPitch.mockReturnValue({ freq: 110, clarity: 0.92 });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })),
      },
    });
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCallback = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    // 每次读时钟前进 100ms，刚好越过「80ms 才算一次」的门槛
    vi.spyOn(performance, "now").mockImplementation(() => (ticks += 100));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("读出 110Hz：认作五弦 A2 并报「准了」", async () => {
    render(<TunerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "开始调音" }));

    await screen.findByTestId("tuner-readout");
    // 拉起 raf 的第一帧
    await act(async () => {
      rafCallback?.();
    });

    expect(await screen.findByText("110.0 Hz")).toBeInTheDocument();
    expect(screen.getByTestId("tuner-status")).toHaveTextContent(/准了/);
    expect(screen.getByText(/目标 五弦 A2/)).toBeInTheDocument();
  });

  it("偏高时告诉用户往哪边拧", async () => {
    pitch.detectPitch.mockReturnValue({ freq: 113, clarity: 0.9 });
    render(<TunerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "开始调音" }));

    await screen.findByTestId("tuner-readout");
    await act(async () => {
      rafCallback?.();
    });

    const status = await screen.findByTestId("tuner-status");
    expect(status).toHaveTextContent(/偏高/);
    expect(status).toHaveTextContent(/逆时针放松五弦/);
  });

  it("点停止后读数收起并释放麦克风", async () => {
    render(<TunerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "开始调音" }));
    await screen.findByTestId("tuner-readout");

    fireEvent.click(screen.getByRole("button", { name: "停止调音" }));
    expect(screen.queryByTestId("tuner-readout")).not.toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("没有 Web Audio 时提示「不支持」，并关掉已拿到的麦克风", async () => {
    (window as unknown as { AudioContext?: unknown }).AudioContext = undefined;
    render(<TunerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "开始调音" }));

    expect(await screen.findByText(/不支持 Web Audio/)).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });
});
