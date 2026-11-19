import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { loadRealWasm } from "../../lib/__tests__/load-wasm";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// 主页面会用到后端（保存/加载/翻译/识别）。这里整体替身，测试只关心
// 「页面能不能正常挂载、初始状态对不对、交互有没有接上线」。
vi.mock("@/lib/api", () => ({
  listScores: vi.fn().mockResolvedValue([]),
  createScore: vi.fn(),
  getScore: vi.fn(),
  updateScore: vi.fn(),
  deleteScore: vi.fn(),
  selectCandidates: vi.fn(),
  recognizeJianzi: vi.fn(),
  recognizeJianziSheet: vi.fn(),
  scoreStorageMode: () => "server",
  ApiError: class ApiError extends Error {},
}));

// 音频合成涉及 AudioContext，jsdom 没有实现；替身掉，避免挂载即崩。
vi.mock("@/lib/audio-export", () => ({
  renderScoreToBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  downloadWav: vi.fn(),
}));

// WASM 胶水由 CI 在测试前构建；本地裸跑时不存在。这条冒烟测的是 React 接线，
// 不是 WASM 逻辑，所以整体替身掉（真 WASM 由 verify-wasm.mjs 与集成测试守）。
/*
 * 用 `importOriginal` 保留真实模块：`loadRealWasm` 要调 `initWasmSync`，
 * 整个替身掉会让它变成 undefined（音高推算一迁进 Rust，这条链就断了）。
 * 只覆盖本文件真正需要替身的那几个导出。
 */
vi.mock("@/lib/taiyin-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/taiyin-wasm")>();
  return {
    ...actual,
  getWasmLoadState: () => "ready",
  getWasmLoadError: () => null,
  initWasm: vi.fn().mockResolvedValue(undefined),
  useWasmInit: () => ({ state: "ready", error: null }),
  translateJianpuToJianzi: vi.fn(),
  translateJianpuSequenceToJianzi: vi.fn(),
  splitPhrases: vi.fn().mockResolvedValue([]),
  };
});

import Home from "@/app/page";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 音高推算已迁进 Rust，薄壳在引擎未就绪时返回 null——必须装载真实产物。 */
beforeAll(loadRealWasm);

describe("Home（主页面冒烟）", () => {
  it("mounts and renders the brand, subtitle and core controls", () => {
    render(<Home />);

    expect(screen.getByText("太音")).toBeTruthy();
    expect(screen.getByText("太音 · 古琴打谱")).toBeTruthy();
    expect(screen.getByText("把看不懂的老谱，变成能弹的曲子")).toBeTruthy();
    // 核心控件是「能用」的最小证据：没有播放/节拍器/BPM，页面就只是张图。
    expect(screen.getByLabelText("播放")).toBeTruthy();
    expect(screen.getByLabelText("启动节拍器")).toBeTruthy();
    expect(screen.getByLabelText("播放速度（BPM）")).toBeTruthy();
  });

  it("starts empty, then renders note columns after loading an example", async () => {
    const { container } = render(<Home />);

    // 冷启动是空谱：这是当前的真实行为（不是 bug），先把它钉住。
    expect(container.querySelectorAll("[data-note-column]").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "沧海一声笑" }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-note-column]").length).toBeGreaterThan(0);
    });
  });

  it("reveals the export options only when the score has notes, and they toggle", async () => {
    render(<Home />);

    // 空谱时导出选项隐藏（避免导出空文件）
    expect(screen.queryByLabelText("导出音频时包含 2 小节预备拍")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "沧海一声笑" }));

    const prepend = await waitFor(() => {
      const el = screen.getByLabelText("导出音频时包含 2 小节预备拍") as HTMLInputElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(prepend.checked).toBe(true);
    fireEvent.click(prepend);
    expect(prepend.checked).toBe(false);
  });

  it("keeps the play button in the idle state on mount", () => {
    render(<Home />);

    expect(screen.getByLabelText("播放")).toBeTruthy();
    expect(screen.queryByLabelText("停止播放")).toBeNull();
  });

  it("空谱给出「一句话 + 两个按钮」的入口，载入示例后收起", async () => {
    /*
     * 2026-11-18 按「一句话原则」重写首屏后，这里断言的东西变了：
     * 旧版铺了「太音是什么」+ 三类入口 + 407 个字，新手找不到该点哪。
     * 现在只有一句定位 + 两个动作，其余折进 details。
     */
    const { container } = render(<Home />);

    expect(container.querySelector('section[aria-label="开始使用"]')).not.toBeNull();
    expect(screen.getByText("把看不懂的古琴老谱，变成能弹、能听的曲子。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "先听一首" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始打谱" })).toBeTruthy();
    // 深入说明折起来，不占首屏
    expect(screen.getByText("第一次用？看这三行")).toBeTruthy();

    // 「先听一首」载入示例并自动出声；载入后入口区收起，不挡打谱
    fireEvent.click(screen.getByRole("button", { name: "先听一首" }));
    await waitFor(() => {
      expect(container.querySelector('section[aria-label="开始使用"]')).toBeNull();
      expect(container.querySelectorAll("[data-note-column]").length).toBeGreaterThan(0);
    });
  });

  it("「先听一首」真的起播，不是只把谱摆出来", async () => {
    // 走查抓到的断点：按钮叫「先听一首」，点完却只有谱面、播放键还停在「播放」。
    // 这里给个假音频设备，断言点一次就进入播放态并真的排程了声音。
    const start = vi.fn();
    class FakeAudioContext {
      sampleRate = 44100;
      currentTime = 0;
      state: AudioContextState = "running";
      destination = {};
      createBuffer(_ch: number, len: number) {
        return { getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer;
      }
      createBufferSource() {
        return {
          buffer: null,
          connect: vi.fn(),
          start,
          stop: vi.fn(),
        } as unknown as AudioBufferSourceNode;
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "先听一首" }));
    await waitFor(() => expect(screen.getByLabelText("停止播放")).toBeTruthy());
    expect(start).toHaveBeenCalled();
  });

  it("「只想记一个字」收成折叠入口，打开后能「去敲一个字」", async () => {
    /*
     * 2026-11-18 改：它是**次要场景**，不该和主路径并排各占一大块。
     * 现在是 details，默认收起——想用的人点开，不想用的人只看到一行标题。
     */
    const { container } = render(<Home />);

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText("只想记一个字？不必打整首谱")).toBeTruthy();

    // 展开后按钮可用；jsdom 没有 scrollIntoView，点它不该抛 TypeError
    fireEvent.click(screen.getByText("只想记一个字？不必打整首谱"));
    expect(() => fireEvent.click(screen.getByRole("button", { name: "去敲一个字" }))).not.toThrow();

    // 有音符后整个入口消失
    fireEvent.click(screen.getByRole("button", { name: "沧海一声笑" }));
    await waitFor(() => {
      expect(screen.queryByText("只想记一个字？不必打整首谱")).toBeNull();
    });
  });

  it("轻用引导卡在整谱导出靶子之外", () => {
    const { container } = render(<Home />);
    const scoreArea = container.querySelector("#score-area");
    expect(scoreArea).not.toBeNull();
    expect(scoreArea?.querySelector('section[aria-label="只想记一个字"]')).toBeNull();
  });
});
