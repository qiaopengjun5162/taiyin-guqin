/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianpuTranslator } from "../jianpu-translator";

vi.mock("@/lib/taiyin-wasm", () => ({
  translateJianpuToJianzi: vi.fn(async () =>
    JSON.stringify({
      candidates: [
        {
          score: 150,
          note: {
            note_type: "SanYin",
            left_finger: null,
            hui: null,
            right_action: "Tiao",
            string_number: 1,
          },
        },
      ],
    }),
  ),
}));

describe("JianpuTranslator", () => {
  it("renders inputs and translate button", () => {
    const { container } = render(<JianpuTranslator onSelect={vi.fn()} />);
    expect(container.textContent).toContain("翻译");
  });

  it("calls onSelect when clicking a candidate", async () => {
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
    expect(selected.jianzi.rightAction).toBe("乚");
    expect(selected.jianzi.stringNumber).toBe("一");
    expect(selected.jianpuNumber).toBe("5");
  });
});
