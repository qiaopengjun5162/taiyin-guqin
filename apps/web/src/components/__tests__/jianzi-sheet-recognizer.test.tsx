import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JianziSheetRecognizer } from "@/components/jianzi-sheet-recognizer";

vi.mock("@/lib/api", () => ({
  recognizeJianziSheet: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));

import { recognizeJianziSheet, ApiError } from "@/lib/api";

beforeEach(() => {
  vi.mocked(recognizeJianziSheet).mockReset();
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

describe("JianziSheetRecognizer", () => {
  it("renders grid and imports readable cells in reading order", async () => {
    vi.mocked(recognizeJianziSheet).mockResolvedValue({
      method: "llm",
      cells: [
        // 同排（row 0）两列：右侧(col 2)应先于左侧(col 1)导入
        { row: 0, col: 2, glyph: "散挑一", explanation: "散音挑一弦", confidence: 0.9 },
        { row: 0, col: 1, glyph: "大九勾四", explanation: "大指九徽勾四弦", confidence: 0.8 },
        { row: 1, col: 0, glyph: null, explanation: "看不清", confidence: 0.1 },
      ],
    });

    const onImport = vi.fn();
    const { container } = render(<JianziSheetRecognizer onImport={onImport} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "sheet.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/识别 3 格/)).toBeTruthy());
    expect(screen.getByText(/可读 2 字/)).toBeTruthy();

    fireEvent.click(screen.getByText("导入为曲谱"));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const notes = onImport.mock.calls[0][0];
    expect(notes).toHaveLength(2);
    // 阅读顺序：同排从右到左 → 散挑一 先于 大九勾四
    expect(notes[0].jianzi.stringNumber).toBe("一");
    expect(notes[1].jianzi.stringNumber).toBe("四");
    expect(screen.getByText(/已按阅读顺序导入 2 个减字/)).toBeTruthy();
  });

  it("shows message when backend AI is unavailable (503)", async () => {
    vi.mocked(recognizeJianziSheet).mockRejectedValue(new ApiError("no key", 503));

    const { container } = render(<JianziSheetRecognizer onImport={vi.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "sheet.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/未启用 AI 识别/)).toBeTruthy());
  });
});
