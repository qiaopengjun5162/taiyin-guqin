import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("@/lib/taiyin-wasm", () => ({
  getWasmLoadState: () => "ready",
  getWasmLoadError: () => null,
  initWasm: vi.fn().mockResolvedValue(undefined),
  useWasmInit: () => ({ state: "ready", error: null }),
  translateJianpuToJianzi: vi.fn(),
  translateJianpuSequenceToJianzi: vi.fn(),
  splitPhrases: vi.fn().mockResolvedValue([]),
}));

import Home from "@/app/page";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

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

  it("空谱给出「太音是什么」介绍区，载入示例后收起", async () => {
    const { container } = render(<Home />);

    // 新访客第一眼要看见定位：打谱工具 + 三类入口
    expect(container.querySelector('section[aria-label="太音是什么"]')).not.toBeNull();
    expect(screen.getByText("太音是什么")).toBeTruthy();
    expect(screen.getByText("古琴打谱工具")).toBeTruthy();
    expect(screen.getByRole("button", { name: "先听一首《沧海一声笑》" })).toBeTruthy();

    // 「先听一首」直接载入示例——听懂比读懂快；载入后介绍区收起，不挡打谱
    fireEvent.click(screen.getByRole("button", { name: "先听一首《沧海一声笑》" }));
    await waitFor(() => {
      expect(container.querySelector('section[aria-label="太音是什么"]')).toBeNull();
      expect(container.querySelectorAll("[data-note-column]").length).toBeGreaterThan(0);
    });
  });

  it("空谱给出「只想记一个字」的轻用入口，开始打谱后收起", async () => {
    const { container } = render(<Home />);

    // 冷启动是最需要「原来只要记一个字」这句话的时刻
    expect(container.querySelector('section[aria-label="只想记一个字"]')).not.toBeNull();
    expect(screen.getByText("只想记一个字？不必打整首谱")).toBeTruthy();
    // jsdom 没有 scrollIntoView：点这个按钮不该抛 TypeError
    expect(() => fireEvent.click(screen.getByRole("button", { name: "去敲一个字" }))).not.toThrow();

    fireEvent.click(screen.getByRole("button", { name: "沧海一声笑" }));
    await waitFor(() => {
      expect(container.querySelector('section[aria-label="只想记一个字"]')).toBeNull();
    });
  });

  it("轻用引导卡在整谱导出靶子之外", () => {
    const { container } = render(<Home />);
    const scoreArea = container.querySelector("#score-area");
    expect(scoreArea).not.toBeNull();
    expect(scoreArea?.querySelector('section[aria-label="只想记一个字"]')).toBeNull();
  });
});
