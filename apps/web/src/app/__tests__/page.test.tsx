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
    expect(screen.getByText("古琴 · 减字谱 · 拼装键盘")).toBeTruthy();
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
});
