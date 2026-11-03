import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { NoteColumn } from "@/lib/types";
import { SequenceMode } from "./sequence-mode";

// 翻译器只依赖 wasm 这一条外部调用；其余逻辑（候选对齐、确认成谱）在组件内。
// 这里让翻译「漏回一组候选」，复现后端候选数少于音数的罕见情况，
// 验证「确认全部」不会静默丢掉没候选的音。
vi.mock("@/lib/taiyin-wasm", () => ({
  translateJianpuSequenceToJianzi: vi.fn(),
}));

import { translateJianpuSequenceToJianzi } from "@/lib/taiyin-wasm";

function makeCandidate(note_type: string, hui: number, fen: number, action: string, stringNumber: number) {
  return {
    score: 1,
    note: {
      note_type,
      left_finger: "Da",
      hui: { hui, fen },
      right_action: action,
      string_number: stringNumber,
    },
  };
}

describe("SequenceMode · 候选缺失不丢音", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("翻译漏回一组候选时，确认全部仍产出全部音符（缺失音减字留空、简谱保留）", async () => {
    const onSelect = vi.fn();
    // 输入 3 个音，但后端只回了 2 组候选（第三组为空）
    vi.mocked(translateJianpuSequenceToJianzi).mockResolvedValue(
      JSON.stringify({
        candidates_per_note: [
          [makeCandidate("按", 9, 6, "Gou", 3)],
          [makeCandidate("按", 7, 6, "Tiao", 4)],
          [],
        ],
      }),
    );

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    const textarea = screen.getByPlaceholderText(/例如：5 6 1 2/);
    fireEvent.change(textarea, { target: { value: "5 6 1" } });
    fireEvent.click(screen.getByText("翻译"));

    // 候选渲染出来后，「确认全部」才出现
    await waitFor(() => expect(screen.getByText("确认全部")).toBeTruthy());
    fireEvent.click(screen.getByText("确认全部"));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const columns = onSelect.mock.calls[0][0] as NoteColumn[];

    // 关键断言：3 个音一个都没丢，节奏不破
    expect(columns).toHaveLength(3);

    // 前两音走正常候选
    expect(columns[0].jianzi.toneType).toBe("按");
    expect(columns[0].jianzi.stringNumber).toBe("三");
    expect(columns[1].jianzi.stringNumber).toBe("四");

    // 第三音没拿到候选：减字留空（不静默丢弃），但简谱数字保留 → 播放退回简谱音高
    expect(columns[2].jianzi.toneType).toBeNull();
    expect(columns[2].jianpuNumber).toBe("1");
  });

  it("全部候选齐全时照常成谱", async () => {
    const onSelect = vi.fn();
    vi.mocked(translateJianpuSequenceToJianzi).mockResolvedValue(
      JSON.stringify({
        candidates_per_note: [
          [makeCandidate("按", 9, 6, "Gou", 3)],
          [makeCandidate("按", 7, 6, "Tiao", 4)],
        ],
      }),
    );

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    const textarea = screen.getByPlaceholderText(/例如：5 6 1 2/);
    fireEvent.change(textarea, { target: { value: "5 6" } });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("确认全部")).toBeTruthy());
    fireEvent.click(screen.getByText("确认全部"));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const columns = onSelect.mock.calls[0][0] as NoteColumn[];
    expect(columns).toHaveLength(2);
    expect(columns[0].jianzi.stringNumber).toBe("三");
    expect(columns[1].jianzi.stringNumber).toBe("四");
  });
});
