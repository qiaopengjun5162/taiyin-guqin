import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// 点格子试听走 Web Audio；jsdom 没有 AudioContext，连合成一起替身。
vi.mock("@/lib/audio-synth", () => ({
  schedulePluck: vi.fn(),
  scheduleClick: vi.fn(),
  TONE_PROFILE: {},
}));

import { recognizeJianziSheet, ApiError } from "@/lib/api";
import { schedulePluck } from "@/lib/audio-synth";

class FakeAudioContext {
  currentTime = 0;
  state = "running";
  destination = {};
  resume = vi.fn(async () => {});
}

beforeEach(() => {
  vi.mocked(recognizeJianziSheet).mockReset();
  vi.mocked(schedulePluck).mockReset();
  vi.stubGlobal("AudioContext", FakeAudioContext);
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

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 上传一张假整页图。 */
function upload(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["x"], "sheet.png", { type: "image/png" })] },
  });
}

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
    expect(screen.getByText(/可导入 2 字/)).toBeTruthy();

    fireEvent.click(screen.getByText("导入为曲谱"));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const notes = onImport.mock.calls[0][0];
    expect(notes).toHaveLength(2);
    // 阅读顺序：同排从右到左 → 散挑一 先于 大九勾四
    expect(notes[0].jianzi.stringNumber).toBe("一");
    expect(notes[1].jianzi.stringNumber).toBe("四");
    // 第 3 格无减字，应被计入「跳过」而不是静默丢弃
    expect(screen.getByText(/已导入 2 个减字/)).toBeTruthy();
    expect(screen.getByText(/跳过 1 个/)).toBeTruthy();
  });

  it("shows message when backend AI is unavailable (503)", async () => {
    vi.mocked(recognizeJianziSheet).mockRejectedValue(new ApiError("no key", 503));

    const { container } = render(<JianziSheetRecognizer onImport={vi.fn()} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "sheet.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/未启用 AI 识别/)).toBeTruthy());
  });

  it("lets the user correct a misrecognized glyph before importing", async () => {
    vi.mocked(recognizeJianziSheet).mockResolvedValue({
      method: "llm",
      cells: [
        { row: 0, col: 0, glyph: "大九勾四", explanation: "x", confidence: 0.8 },
        // 故意把「散勾一」误识别为「散挑一」，用户需校正
        { row: 0, col: 1, glyph: "散挑一", explanation: "x", confidence: 0.9 },
      ],
    });

    const onImport = vi.fn();
    const { container } = render(<JianziSheetRecognizer onImport={onImport} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "sheet.png", { type: "image/png" })] } });

    await waitFor(() => expect(screen.getByText(/识别 2 格/)).toBeTruthy());

    // 校正 col 1 的「散挑一」→「散勾一」
    const editInputs = screen.getAllByLabelText(/校正减字/) as HTMLInputElement[];
    // 渲染为 row-major：index 0 = (0,0)，index 1 = (0,1)
    fireEvent.change(editInputs[1], { target: { value: "散勾一" } });

    fireEvent.click(screen.getByText("导入为曲谱"));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const notes = onImport.mock.calls[0][0];
    expect(notes).toHaveLength(2);
    // 阅读顺序同排从右到左：col1(散勾一) 先，col0(大九勾四) 后
    expect(notes[0].jianzi.rightAction).toBe("勾");
    expect(notes[0].jianzi.stringNumber).toBe("一");
    expect(notes[1].jianzi.rightAction).toBe("勾");
    expect(notes[1].jianzi.stringNumber).toBe("四");
  });

  it("flags unparseable glyphs and reports skipped notes on import", async () => {
    vi.mocked(recognizeJianziSheet).mockResolvedValue({
      method: "llm",
      cells: [
        { row: 0, col: 0, glyph: "散挑一", explanation: "x", confidence: 0.9 },
        // 「大九勾」缺弦序 → parseJianziText 判为不完整，无法解析
        { row: 0, col: 1, glyph: "大九勾", explanation: "缺弦序", confidence: 0.5 },
      ],
    });

    const onImport = vi.fn();
    const { container } = render(<JianziSheetRecognizer onImport={onImport} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "sheet.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(screen.getByText(/识别 2 格/)).toBeTruthy());
    // 解析失败的格子要被明确标出，不能与「未识别」混为一谈
    expect(screen.getByText(/待校正 1 字/)).toBeTruthy();
    expect(screen.getByText("无法解析")).toBeTruthy();

    fireEvent.click(screen.getByText("导入为曲谱"));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const notes = onImport.mock.calls[0][0];
    expect(notes).toHaveLength(1);
    expect(screen.getByText(/跳过 1 个/)).toBeTruthy();
    expect(screen.getByText(/无法解析 1/)).toBeTruthy();
  });

  it("非 503 的失败照原样报错，不伪装成「未启用」", async () => {
    vi.mocked(recognizeJianziSheet).mockRejectedValue(new Error("图片太大"));

    const { container } = render(<JianziSheetRecognizer onImport={vi.fn()} />);
    upload(container);

    await waitFor(() => expect(screen.getByText("图片太大")).toBeTruthy());
    expect(screen.queryByText(/未启用 AI 识别/)).toBeNull();
  });

  it("识别结果为空时提示换一张更清晰的图", async () => {
    vi.mocked(recognizeJianziSheet).mockResolvedValue({ method: "llm", cells: [] });

    const { container } = render(<JianziSheetRecognizer onImport={vi.fn()} />);
    upload(container);

    await waitFor(() => expect(screen.getByText(/未识别到减字/)).toBeTruthy());
    expect(screen.queryByText("导入为曲谱")).toBeNull();
  });

  it("点「上传整页减字图片」会触发隐藏 file input", () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    render(<JianziSheetRecognizer onImport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "上传整页减字图片" }));

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("点已识别的格子可按该减字试听", async () => {
    vi.mocked(recognizeJianziSheet).mockResolvedValue({
      method: "llm",
      cells: [{ row: 0, col: 0, glyph: "散挑一", explanation: "x", confidence: 0.9 }],
    });

    const { container } = render(<JianziSheetRecognizer onImport={vi.fn()} />);
    upload(container);
    await waitFor(() => expect(screen.getByText(/识别 1 格/)).toBeTruthy());

    // 点击校正框会冒泡到格子的 onClick
    fireEvent.click(screen.getByLabelText("校正减字 0-0"));

    expect(schedulePluck).toHaveBeenCalledTimes(1);
    const [ctx, freq, time, duration, tone] = vi.mocked(schedulePluck).mock.calls[0];
    expect(ctx).toBeInstanceOf(FakeAudioContext);
    expect(freq).toBeGreaterThan(0);
    expect(time).toBeCloseTo(0.05, 5);
    expect(duration).toBe(1.2);
    expect(tone).toBe("散");
  });
});
