import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JianziRecognizer } from "@/components/jianzi-recognizer";

vi.mock("@/lib/api", () => ({
  recognizeJianzi: vi.fn(),
}));

import { recognizeJianzi } from "@/lib/api";

beforeEach(() => {
  vi.mocked(recognizeJianzi).mockReset();
  // jsdom 的 FileReader 不会为 File 触发 onload，mock 掉以驱动测试
  global.FileReader = class {
    result: string | ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      this.result = "data:image/png;base64,QUJD"; // 前缀会被 fileToBase64 截掉
      this.onload?.();
    }
  } as unknown as typeof FileReader;
});

describe("JianziRecognizer", () => {
  it("renders the recognized glyph and explanation", async () => {
    vi.mocked(recognizeJianzi).mockResolvedValue({
      method: "llm",
      glyph: "大九勾四",
      explanation: "左手指大、徽位九、右手指勾、弦四",
      confidence: 0.82,
    });

    const { container } = render(<JianziRecognizer />);
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["x"], "jianzi.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(
        (container.querySelector('input[aria-label="减字校正框"]') as HTMLInputElement)
          .value,
      ).toBe("大九勾四"),
    );
    expect(screen.getByText(/置信度/)).toBeTruthy();
    expect(screen.getByText(/左手指大/)).toBeTruthy();
    // 解析出的减字应触发可点听按钮
    expect(screen.getByText("试听")).toBeTruthy();
  });

  it("allows correcting the recognized glyph and re-parses live", async () => {
    vi.mocked(recognizeJianzi).mockResolvedValue({
      method: "llm",
      glyph: "大九勾四",
      explanation: "左手指大、徽位九、右手指勾、弦四",
      confidence: 0.82,
    });

    const { container } = render(<JianziRecognizer />);
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["x"], "jianzi.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // waitFor 只有在回调抛错时才会重试；直接返回 null 会立刻以 null 解析，
    // 因此这里先用 expect(...).not.toBeNull() 等待识别完成。
    await waitFor(() =>
      expect(
        container.querySelector('input[aria-label="减字校正框"]'),
      ).not.toBeNull(),
    );
    const editInput = container.querySelector(
      'input[aria-label="减字校正框"]',
    ) as HTMLInputElement;
    expect(editInput.value).toBe("大九勾四");

    fireEvent.change(editInput, { target: { value: "散勾一" } });
    expect(editInput.value).toBe("散勾一");
    // 校正后：输入框标签变为「减字（已校正）」，并保留原识别结果供对照。
    // 注意「已校正」同时出现在标签与说明文案里，故用更精确的文案断言。
    expect(screen.getByText("减字（已校正）")).toBeTruthy();
    expect(screen.getByText(/原：大九勾四/)).toBeTruthy();
  });

  it("shows message when backend AI is unavailable", async () => {
    vi.mocked(recognizeJianzi).mockResolvedValue({
      method: "unavailable",
      glyph: null,
      explanation: null,
      confidence: null,
    });

    const { container } = render(<JianziRecognizer />);
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["x"], "jianzi.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByText(/未启用 AI 识别/)).toBeTruthy(),
    );
  });
});
