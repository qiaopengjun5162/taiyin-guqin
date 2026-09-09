import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JianziRecognizer } from "@/components/jianzi-recognizer";

vi.mock("@/lib/api", () => ({
  recognizeJianzi: vi.fn(),
}));

import { recognizeJianzi } from "@/lib/api";

beforeEach(() => {
  vi.mocked(recognizeJianzi).mockReset();
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

    await waitFor(() => expect(screen.getByText(/大九勾四/)).toBeTruthy());
    expect(screen.getByText(/置信度/)).toBeTruthy();
    expect(screen.getByText(/左手指大/)).toBeTruthy();
    // 解析出的减字应触发可点听按钮
    expect(screen.getByText("试听")).toBeTruthy();
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
