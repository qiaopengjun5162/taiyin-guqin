/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianpuTranslator } from "../jianpu-translator";
import { translateJianpuToJianzi, translateJianpuSequenceToJianzi } from "@/lib/taiyin-wasm";

const singleCandidate = {
  score: 150,
  note: {
    note_type: "SanYin",
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
              note_type: "FanYin",
              left_finger: "Da",
              hui: { hui: 10, fen: null },
              right_action: "Tiao",
              string_number: 5,
            },
          },
        ],
        [
          {
            score: 110,
            note: {
              note_type: "AnYin",
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
}));

describe("JianpuTranslator single mode", () => {
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
});
