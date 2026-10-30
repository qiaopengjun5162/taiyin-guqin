import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { JianziRecognizer } from "@/components/jianzi-recognizer";

vi.mock("@/lib/api", () => ({
  recognizeJianzi: vi.fn(),
}));

// 试听走 Web Audio；jsdom 没有 AudioContext，连合成函数一起替身，
// 只验证「按识别出的减字算出的频率与音色」有没有传对。
vi.mock("@/lib/audio-synth", () => ({
  schedulePluck: vi.fn(),
  scheduleClick: vi.fn(),
  TONE_PROFILE: {},
}));

import { recognizeJianzi } from "@/lib/api";
import { schedulePluck } from "@/lib/audio-synth";

class FakeAudioContext {
  currentTime = 1;
  state = "running";
  destination = { name: "dest" };
  resume = vi.fn(async () => {});
}

beforeEach(() => {
  vi.mocked(recognizeJianzi).mockReset();
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

/** 上传一张假图，返回容器。 */
function upload(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "jianzi.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
}

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
    upload(container);

    await waitFor(() =>
      expect(screen.getByText(/未启用 AI 识别/)).toBeTruthy(),
    );
  });

  it("上传后立刻进入「识别中…」并禁用按钮，完成再恢复", async () => {
    let resolveIt: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveIt = resolve;
    });
    vi.mocked(recognizeJianzi).mockReturnValue(pending as never);

    const { container } = render(<JianziRecognizer />);
    upload(container);

    const busy = screen.getByRole("button", { name: "识别中…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);

    await act(async () => {
      resolveIt({
        method: "llm",
        glyph: "大九勾四",
        explanation: null,
        confidence: 0.5,
      });
    });

    const idle = screen.getByRole("button", { name: "上传减字图片" }) as HTMLButtonElement;
    expect(idle.disabled).toBe(false);
  });

  it("识别请求失败时显示错误并允许重试", async () => {
    vi.mocked(recognizeJianzi).mockRejectedValue(new Error("网络超时"));

    const { container } = render(<JianziRecognizer />);
    upload(container);

    await waitFor(() => expect(screen.getByText("网络超时")).toBeTruthy());
    expect(
      (screen.getByRole("button", { name: "上传减字图片" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("识别成功但算不出音高时给出解释并禁用试听", async () => {
    // 「散勾」缺弦序：解析得出减字，但无法反推频率
    vi.mocked(recognizeJianzi).mockResolvedValue({
      method: "llm",
      glyph: "散勾",
      explanation: null,
      confidence: null,
    });

    const { container } = render(<JianziRecognizer />);
    upload(container);

    await waitFor(() =>
      expect(screen.getByText(/暂无法推算音高/)).toBeTruthy(),
    );
    expect(
      (screen.getByRole("button", { name: "试听" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(schedulePluck).not.toHaveBeenCalled();
  });

  it("点试听按识别出的减字合成（音色/频率/起播时间都对）", async () => {
    vi.mocked(recognizeJianzi).mockResolvedValue({
      method: "llm",
      glyph: "大九勾四",
      explanation: null,
      confidence: 0.9,
    });

    const { container } = render(<JianziRecognizer />);
    upload(container);
    await waitFor(() => expect(screen.getByText("试听")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "试听" }));

    expect(schedulePluck).toHaveBeenCalledTimes(1);
    const [ctx, freq, time, duration, tone] = vi.mocked(schedulePluck).mock.calls[0];
    expect(ctx).toBeInstanceOf(FakeAudioContext);
    expect(freq).toBeGreaterThan(0);
    expect(time).toBeCloseTo(1.05, 5); // currentTime + 0.05 前导
    expect(duration).toBe(1.2);
    expect(tone).toBe("按");
  });

  it("点「上传减字图片」会去触发隐藏的 file input", () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    render(<JianziRecognizer />);
    fireEvent.click(screen.getByRole("button", { name: "上传减字图片" }));

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("把校正框清空后回到「未识别」状态", async () => {
    vi.mocked(recognizeJianzi).mockResolvedValue({
      method: "llm",
      glyph: "大九勾四",
      explanation: null,
      confidence: null,
    });

    const { container } = render(<JianziRecognizer />);
    upload(container);

    await waitFor(() =>
      expect(container.querySelector('input[aria-label="减字校正框"]')).not.toBeNull(),
    );
    const edit = container.querySelector(
      'input[aria-label="减字校正框"]',
    ) as HTMLInputElement;
    fireEvent.change(edit, { target: { value: "" } });

    expect(screen.getByText("未识别")).toBeTruthy();
    expect(screen.queryByText("试听")).toBeNull();
  });
});
