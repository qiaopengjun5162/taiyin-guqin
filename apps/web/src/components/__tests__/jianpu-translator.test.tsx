/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianpuTranslator } from "../jianpu-translator";

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

    fireEvent.change(container.querySelector("select") as HTMLSelectElement, {
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
});
