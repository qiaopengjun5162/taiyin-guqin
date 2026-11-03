import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { NoteColumn } from "@/lib/types";
import type { JianziCandidate } from "@/lib/generated/taiyin";
import { SequenceMode } from "./sequence-mode";

// 翻译器只依赖 wasm 这一条外部调用；其余逻辑（候选对齐、确认成谱）在组件内。
// 这里让翻译「漏回一组候选」，复现后端候选数少于音数的罕见情况，
// 验证「确认全部」不会静默丢掉没候选的音。
vi.mock("@/lib/taiyin-wasm", () => ({
  translateJianpuSequenceToJianzi: vi.fn(),
  arrangeJianpuSequence: vi.fn(),
}));

import {
  translateJianpuSequenceToJianzi,
  arrangeJianpuSequence,
} from "@/lib/taiyin-wasm";

/**
 * 造一条候选减字。
 *
 * 字段必须与 Rust 生成的 `GuqinNote` 完全一致——这份对象现在直接喂给
 * `arrangeJianpuSequence` 的 mock 返回值，缺字段编译期就会炸，
 * 不会等到运行时才在谱面上变成空白减字。
 */
function makeCandidate(
  note_type: "散" | "泛" | "按",
  hui: number,
  fen: number | null,
  action: "Tiao" | "Gou",
  stringNumber: number,
): JianziCandidate {
  return {
    score: 1,
    note: {
      note_type,
      left_finger: "Da",
      hui: { hui, fen },
      right_action: action,
      string_number: stringNumber,
      compound: null,
      ornaments: [],
      rhythm_mode: "板",
      duration: 1,
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

describe("SequenceMode · 智能编排", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("编排后用的是全局路径选中的候选，而不是单音第一名", async () => {
    const onSelect = vi.fn();
    vi.mocked(translateJianpuSequenceToJianzi).mockResolvedValue(
      JSON.stringify({
        candidates_per_note: [
          [makeCandidate("散", 0, 0, "Tiao", 1), makeCandidate("按", 9, 6, "Gou", 3)],
          [makeCandidate("散", 0, 0, "Tiao", 2)],
        ],
      }),
    );
    // 全局编排把第一音换成了按音（弦三），并把它提到候选首位——这是 Rust 端的契约：
    // 返回的候选已经被按路径整理过，selections 恒指向首位。
    vi.mocked(arrangeJianpuSequence).mockResolvedValue({
      candidates_per_note: [
        [makeCandidate("按", 9, 6, "Gou", 3), makeCandidate("散", 0, 0, "Tiao", 1)],
        [makeCandidate("散", 0, 0, "Tiao", 2)],
      ],
      selections: [0, 0],
      total_cost: 120,
    });

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText(/例如：5 6 1 2/), {
      target: { value: "5 6" },
    });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("智能编排")).toBeTruthy());

    fireEvent.click(screen.getByText("智能编排"));
    await waitFor(() =>
      expect(screen.getByText("已按整句连贯重排")).toBeTruthy(),
    );

    fireEvent.click(screen.getByText("确认全部"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const columns = onSelect.mock.calls[0][0] as NoteColumn[];

    // selections[0] = 1 指向候选列表第二位（弦三按音），不是单音第一名的散一弦
    expect(columns[0].jianzi.toneType).toBe("按");
    expect(columns[0].jianzi.stringNumber).toBe("三");
    expect(columns[1].jianzi.toneType).toBe("散");
  });

  it("编排结果要按休止符对齐，否则后面每个音都会左移、小节全错", async () => {
    const onSelect = vi.fn();
    vi.mocked(translateJianpuSequenceToJianzi).mockResolvedValue(
      JSON.stringify({
        candidates_per_note: [
          [makeCandidate("散", 0, 0, "Tiao", 1)],
          [makeCandidate("散", 0, 0, "Tiao", 2)],
        ],
      }),
    );
    vi.mocked(arrangeJianpuSequence).mockResolvedValue({
      candidates_per_note: [
        [makeCandidate("散", 0, 0, "Tiao", 1)],
        [makeCandidate("散", 0, 0, "Tiao", 2)],
      ],
      selections: [0, 0],
      total_cost: 80,
    });

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText(/例如：5 6 1 2/), {
      target: { value: "5 0 6" },
    });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("智能编排")).toBeTruthy());
    fireEvent.click(screen.getByText("智能编排"));
    await waitFor(() =>
      expect(screen.getByText("已按整句连贯重排")).toBeTruthy(),
    );

    fireEvent.click(screen.getByText("确认全部"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const columns = onSelect.mock.calls[0][0] as NoteColumn[];

    expect(columns).toHaveLength(3);
    expect(columns[1].jianpuNumber).toBe("0"); // 休止符留在原位
    expect(columns[2].jianzi.stringNumber).toBe("二"); // 第三音仍对应第二个音
  });

  it("手动改选候选后，编排标记要消失（旧代价已不对应当前选择）", async () => {
    const onSelect = vi.fn();
    vi.mocked(translateJianpuSequenceToJianzi).mockResolvedValue(
      JSON.stringify({
        candidates_per_note: [
          [
            makeCandidate("散", 0, 0, "Tiao", 1),
            makeCandidate("按", 9, 6, "Gou", 3),
          ],
        ],
      }),
    );
    vi.mocked(arrangeJianpuSequence).mockResolvedValue({
      candidates_per_note: [
        [
          makeCandidate("散", 0, 0, "Tiao", 1),
          makeCandidate("按", 9, 6, "Gou", 3),
        ],
      ],
      selections: [0],
      total_cost: 40,
    });

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText(/例如：5 6 1 2/), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("智能编排")).toBeTruthy());
    fireEvent.click(screen.getByText("智能编排"));
    await waitFor(() =>
      expect(screen.getByText("已按整句连贯重排")).toBeTruthy(),
    );

    // 点第二个候选卡片（候选卡的按钮统一以「录入此音位」结尾）
    const chips = screen.getAllByLabelText(/录入此音位/);
    expect(chips.length).toBe(2);
    fireEvent.click(chips[1]);

    await waitFor(() =>
      expect(screen.queryByText("已按整句连贯重排")).toBeNull(),
    );
  });
});
