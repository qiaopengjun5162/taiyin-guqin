/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianpuTranslator } from "../jianpu-translator";
import {
  translateJianpuToJianzi,
  translateJianpuSequenceToJianzi,
  useWasmInit,
} from "@/lib/taiyin-wasm";

const singleCandidate = {
  score: 150,
  note: {
    note_type: "散",
    left_finger: null,
    hui: null,
    right_action: "Tiao",
    string_number: 1,
  },
};

vi.mock("@/lib/taiyin-wasm", () => ({
  translateJianpuToJianzi: vi.fn(async () =>
    JSON.stringify({ candidates: [singleCandidate] }),
  ),
  translateJianpuSequenceToJianzi: vi.fn(async () =>
    JSON.stringify({
      candidates_per_note: [
        [singleCandidate],
        [
          {
            score: 140,
            note: {
              note_type: "泛",
              left_finger: "Da",
              hui: { hui: 10, fen: null },
              right_action: "Tiao",
              string_number: 5,
            },
          },
          {
            score: 135,
            note: {
              note_type: "散",
              left_finger: null,
              hui: null,
              right_action: "Tiao",
              string_number: 2,
            },
          },
        ],
        [
          {
            score: 110,
            note: {
              note_type: "按",
              left_finger: "Da",
              hui: { hui: 4, fen: null },
              right_action: "Tiao",
              string_number: 1,
            },
          },
        ],
      ],
    }),
  ),
  useWasmInit: vi.fn(() => ({ state: "ready", error: null })),
}));

vi.mock("@/lib/api", () => ({
  selectCandidates: vi.fn(async () => ({
    method: "llm",
    selections: [{ note_index: 1, candidate_index: 1, reason: "把位连贯" }],
  })),
}));

beforeEach(() => {
  vi.mocked(useWasmInit).mockReturnValue({ state: "ready", error: null });
});

describe("JianpuTranslator single mode", () => {
  beforeEach(() => {
    vi.mocked(useWasmInit).mockReturnValue({ state: "ready", error: null });
  });

  it("renders inputs and translate button", () => {
    const { container } = render(<JianpuTranslator onSelect={vi.fn()} />);
    expect(container.textContent).toContain("翻译");
  });

  it("calls onSelect with an array when clicking a candidate", async () => {
    const onSelect = vi.fn();
    const { getByText, container } = render(<JianpuTranslator onSelect={onSelect} />);

    // select[0] 为调式，select[1] 为数字
    fireEvent.change(container.querySelectorAll("select")[1] as HTMLSelectElement, {
      target: { value: "5" },
    });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });

    fireEvent.click(getByText("散挑一"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = onSelect.mock.calls[0][0];
    expect(Array.isArray(selected)).toBe(true);
    expect(selected[0].jianzi.rightAction).toBe("乚");
    expect(selected[0].jianzi.stringNumber).toBe("一");
    expect(selected[0].jianpuNumber).toBe("5");
  });

  it("passes selected tuning to WASM payload", async () => {
    const { getByText, container } = render(<JianpuTranslator onSelect={vi.fn()} />);

    fireEvent.change(container.querySelectorAll("select")[0] as HTMLSelectElement, {
      target: { value: "ruibin" },
    });
    fireEvent.change(container.querySelectorAll("select")[1] as HTMLSelectElement, {
      target: { value: "5" },
    });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });
    expect(vi.mocked(translateJianpuToJianzi).mock.calls.at(-1)?.[0]).toContain('"tuning":"ruibin"');
  });

  it("invalidates candidates when tuning changes", async () => {
    const { getByText, queryByText, container } = render(<JianpuTranslator onSelect={vi.fn()} />);

    fireEvent.change(container.querySelectorAll("select")[1] as HTMLSelectElement, {
      target: { value: "5" },
    });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });

    fireEvent.change(container.querySelectorAll("select")[0] as HTMLSelectElement, {
      target: { value: "ruibin" },
    });

    expect(queryByText("散挑一")).not.toBeInTheDocument();
    expect(getByText("调式已变更，请重新翻译")).toBeInTheDocument();
  });

  it("shows WASM initialization error and disables translate", () => {
    vi.mocked(useWasmInit).mockReturnValue({
      state: "error",
      error: new Error("wasm load failed"),
    });
    const { container } = render(<JianpuTranslator onSelect={vi.fn()} />);
    expect(container.textContent).toContain("引擎加载失败");
    expect(container.textContent).toContain("wasm load failed");
  });
});

describe("JianpuTranslator sequence mode", () => {
  it("renders sequence input after switching mode", () => {
    const { container, getByText } = render(<JianpuTranslator onSelect={vi.fn()} />);
    fireEvent.click(getByText("序列"));
    expect(container.querySelector("textarea")).toBeInTheDocument();
  });

  it("translates a sequence and confirms all notes", async () => {
    const onSelect = vi.fn();
    const { getByText, container } = render(<JianpuTranslator onSelect={onSelect} />);

    fireEvent.click(getByText("序列"));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "5 6 1" } });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });

    fireEvent.click(getByText("确认全部"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = onSelect.mock.calls[0][0];
    expect(Array.isArray(selected)).toBe(true);
    expect(selected).toHaveLength(3);
    expect(selected[0].jianzi.toneType).toBe("散");
    expect(selected[1].jianzi.toneType).toBe("泛");
    expect(selected[2].jianzi.toneType).toBe("按");
    expect(selected[2].jianzi.leftFinger).toBe("大");
    expect(selected[2].jianzi.hui).toBe("四");
  });

  it("carries parsed durations into confirmed notes", async () => {
    const onSelect = vi.fn();
    const { getByText, container } = render(<JianpuTranslator onSelect={onSelect} />);

    fireEvent.click(getByText("序列"));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "5 - 6_ 1." } });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });

    fireEvent.click(getByText("确认全部"));
    const selected = onSelect.mock.calls[0][0];
    expect(selected).toHaveLength(3);
    expect(selected[0].duration).toBe("二分");
    expect(selected[0].jianpuDot).toBe(false);
    expect(selected[1].duration).toBe("八分");
    expect(selected[2].duration).toBe("四分");
    expect(selected[2].jianpuDot).toBe(true);
  });

  it("inserts a rest column for 0 when confirming", async () => {
    const onSelect = vi.fn();
    const { getByText, container } = render(<JianpuTranslator onSelect={onSelect} />);

    fireEvent.click(getByText("序列"));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "5 0 6" } });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });

    fireEvent.click(getByText("确认全部"));
    const selected = onSelect.mock.calls[0][0];
    expect(selected).toHaveLength(3);
    expect(selected[1].jianpuNumber).toBe("0");
    expect(selected[1].duration).toBe("四分");
    expect(selected[1].jianzi.toneType).toBeNull();
    expect(selected[1].jianzi.rightAction).toBeNull();
  });

  it("sends notes and tuning as object payload in sequence mode", async () => {
    const { getByText, container } = render(<JianpuTranslator onSelect={vi.fn()} />);

    fireEvent.change(container.querySelectorAll("select")[0] as HTMLSelectElement, {
      target: { value: "manjiao" },
    });
    fireEvent.click(getByText("序列"));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "5 6 1" } });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });
    const payload = vi.mocked(translateJianpuSequenceToJianzi).mock.calls.at(-1)?.[0] ?? "";
    expect(payload).toContain('"tuning":"manjiao"');
    expect(payload).toContain('"notes":');
  });

  it("applies LLM selections when clicking AI 优选", async () => {
    const onSelect = vi.fn();
    const { getByText, container } = render(<JianpuTranslator onSelect={onSelect} />);

    fireEvent.click(getByText("序列"));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "5 6 1" } });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });

    fireEvent.click(getByText("AI 优选"));

    await waitFor(() => {
      expect(getByText("AI 已优选")).toBeInTheDocument();
    });

    // LLM 为第二音选择了 candidate_index 1（散挑二）
    fireEvent.click(getByText("确认全部"));
    const selected = onSelect.mock.calls[0][0];
    expect(selected[1].jianzi.toneType).toBe("散");
    expect(selected[1].jianzi.stringNumber).toBe("二");
  });

  it("hides confirm and candidates when tuning changes in sequence mode", async () => {
    const { getByText, queryByText, container } = render(<JianpuTranslator onSelect={vi.fn()} />);

    fireEvent.click(getByText("序列"));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "5 6 1" } });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("确认全部")).toBeInTheDocument();
    });

    fireEvent.change(container.querySelectorAll("select")[0] as HTMLSelectElement, {
      target: { value: "manjiao" },
    });

    expect(queryByText("确认全部")).not.toBeInTheDocument();
    expect(getByText("调式已变更，请重新翻译")).toBeInTheDocument();
  });
});
