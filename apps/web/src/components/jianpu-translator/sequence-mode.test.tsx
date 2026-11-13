import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { NoteColumn } from "@/lib/types";
import type { JianziCandidate } from "@/lib/generated/taiyin";
import { SequenceMode } from "./sequence-mode";

// 翻译器只依赖 wasm 这一条外部调用；其余逻辑（候选对齐、确认成谱）在组件内。
// 这里让翻译「漏回一组候选」，复现后端候选数少于音数的罕见情况，
// 验证「确认全部」不会静默丢掉没候选的音。
//
// 只替换两条异步调用，其余（尤其是 describeArrangement 这段纯文案逻辑）用真实现——
// 把它也 mock 掉等于把「界面说的话对不对」这件事一起测没了。
vi.mock("@/lib/taiyin-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/taiyin-wasm")>();
  return {
    ...actual,
    translateJianpuSequenceToJianzi: vi.fn(),
    arrangeJianpuSequence: vi.fn(),
  };
});

import {
  translateJianpuSequenceToJianzi,
  arrangeJianpuSequence,
  type JianpuArrangement,
  type PathStats,
  type PhraseSpan,
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
      structure_mark: null,
    },
  };
}

/**
 * 造一份编排结果。默认「有改善」——界面文案才有东西可说。
 * 想测「本来就最顺」的分支，传 `identical: true`。
 */
function makeArrangement(
  candidates_per_note: JianziCandidate[][],
  selections: (number | null)[],
  options: {
    identical?: boolean;
    stats?: PathStats;
    greedyStats?: PathStats;
    phrases?: PhraseSpan[];
  } = {},
): JianpuArrangement {
  return {
    candidates_per_note,
    selections,
    total_cost: 120,
    stats: options.stats ?? {
      string_changes: 0,
      finger_shifts: 0,
      technique_switches: 0,
      rushed_moves: 0,
      longest_open_run: 0,
    },
    greedy_stats: options.greedyStats ?? {
      string_changes: 2,
      finger_shifts: 0,
      technique_switches: 0,
      rushed_moves: 0,
      longest_open_run: 0,
    },
    identical_to_greedy: options.identical ?? false,
    phrases: options.phrases ?? [],
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
    vi.mocked(arrangeJianpuSequence).mockResolvedValue(
      makeArrangement(
        [
          [makeCandidate("按", 9, 6, "Gou", 3), makeCandidate("散", 0, 0, "Tiao", 1)],
          [makeCandidate("散", 0, 0, "Tiao", 2)],
        ],
        [0, 0],
      ),
    );

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText(/例如：5 6 1 2/), {
      target: { value: "5 6" },
    });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("智能编排")).toBeTruthy());

    fireEvent.click(screen.getByText("智能编排"));
    await waitFor(() =>
      expect(screen.getByText("已编排：少 2 次换弦")).toBeTruthy(),
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
    vi.mocked(arrangeJianpuSequence).mockResolvedValue(
      makeArrangement(
        [
          [makeCandidate("散", 0, 0, "Tiao", 1)],
          [makeCandidate("散", 0, 0, "Tiao", 2)],
        ],
        [0, 0],
        { identical: true },
      ),
    );

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText(/例如：5 6 1 2/), {
      target: { value: "5 0 6" },
    });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("智能编排")).toBeTruthy());
    fireEvent.click(screen.getByText("智能编排"));
    await waitFor(() =>
      expect(screen.getByText(/这条已经是最顺的走法/)).toBeTruthy(),
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
    vi.mocked(arrangeJianpuSequence).mockResolvedValue(
      makeArrangement(
        [
          [
            makeCandidate("散", 0, 0, "Tiao", 1),
            makeCandidate("按", 9, 6, "Gou", 3),
          ],
        ],
        [0],
      ),
    );

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText(/例如：5 6 1 2/), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("智能编排")).toBeTruthy());
    fireEvent.click(screen.getByText("智能编排"));
    await waitFor(() =>
      expect(screen.getByText("已编排：少 2 次换弦")).toBeTruthy(),
    );

    // 点第二个候选卡片（候选卡的按钮统一以「录入此音位」结尾）
    const chips = screen.getAllByLabelText(/录入此音位/);
    expect(chips.length).toBe(2);
    fireEvent.click(chips[1]);

    await waitFor(() =>
      expect(screen.queryByText("已编排：少 2 次换弦")).toBeNull(),
    );
  });

  /**
   * 分句分隔线要落在**该落的行**上。
   *
   * 送进 Rust 的数组滤掉了休止符，句子的 `start` 是那个数组的下标。
   * 换算回列表行号时少算一个休止符，分隔线就整体往前错一行——
   * 界面上只是「分句看着有点怪」，实际把「第 2 句」标在了上一句的尾音上。
   * 所以这里输入里故意带一个休止符，数清楚第二句之前到底有几行。
   */
  it("按气口标出第几句，休止符不占句内音数、但占行号", async () => {
    const onSelect = vi.fn();
    const cand = () => [makeCandidate("散", 0, 0, "Tiao", 1)];
    vi.mocked(translateJianpuSequenceToJianzi).mockResolvedValue(
      JSON.stringify({
        candidates_per_note: [cand(), cand(), cand(), cand(), cand()],
      }),
    );
    // 5 6 (休止) 1 - 2 3 → 「1」放足两拍，这里是气口
    vi.mocked(arrangeJianpuSequence).mockResolvedValue(
      makeArrangement(
        [cand(), cand(), cand(), cand(), cand()],
        [0, 0, 0, 0, 0],
        {
          phrases: [
            {
              index: 0,
              start: 0,
              end: 2,
              note_count: 3,
              stats: {
                string_changes: 2,
                finger_shifts: 0,
                technique_switches: 0,
                rushed_moves: 0,
                longest_open_run: 0,
              },
            },
            {
              index: 1,
              start: 3,
              end: 4,
              note_count: 2,
              stats: {
                string_changes: 0,
                finger_shifts: 0,
                technique_switches: 0,
                rushed_moves: 1,
                longest_open_run: 0,
              },
            },
          ],
        },
      ),
    );

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText(/例如：5 6 1 2/), {
      target: { value: "5 6 0 1 - 2 3" },
    });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("智能编排")).toBeTruthy());
    fireEvent.click(screen.getByText("智能编排"));

    await waitFor(() => expect(screen.getByText("第 1 句")).toBeTruthy());
    expect(screen.getByText("第 2 句")).toBeTruthy();
    // 句内账目跟着分隔线一起显示
    expect(screen.getByText("3 音 · 换弦 2")).toBeTruthy();
    expect(screen.getByText("2 音 · 换弦 0 · 快句换手 1")).toBeTruthy();

    // 第二句的分隔线前面应当有 4 个**音符行**：5、6、休止、1 -
    // （分隔线本身不算行，所以按 data 属性跳过）
    const second = document.querySelector('[data-phrase-index="1"]');
    expect(second).not.toBeNull();
    let rowsBefore = 0;
    for (
      let el = second?.previousElementSibling;
      el;
      el = el.previousElementSibling
    ) {
      if (!el.hasAttribute("data-phrase-index")) rowsBefore++;
    }
    expect(rowsBefore).toBe(4);
  });

  it("只有一句时不画分隔线（短曲标「第 1 句」纯属噪声）", async () => {
    const onSelect = vi.fn();
    const cand = () => [makeCandidate("散", 0, 0, "Tiao", 1)];
    vi.mocked(translateJianpuSequenceToJianzi).mockResolvedValue(
      JSON.stringify({ candidates_per_note: [cand(), cand()] }),
    );
    vi.mocked(arrangeJianpuSequence).mockResolvedValue(
      makeArrangement(
        [cand(), cand()],
        [0, 0],
        {
          phrases: [
            {
              index: 0,
              start: 0,
              end: 1,
              note_count: 2,
              stats: {
                string_changes: 0,
                finger_shifts: 0,
                technique_switches: 0,
                rushed_moves: 0,
                longest_open_run: 0,
              },
            },
          ],
        },
      ),
    );

    render(<SequenceMode tuning="zheng" onSelect={onSelect} />);
    fireEvent.change(screen.getByPlaceholderText(/例如：5 6 1 2/), {
      target: { value: "5 6" },
    });
    fireEvent.click(screen.getByText("翻译"));
    await waitFor(() => expect(screen.getByText("智能编排")).toBeTruthy());
    fireEvent.click(screen.getByText("智能编排"));

    await waitFor(() => expect(screen.getByText("已编排：少 2 次换弦")).toBeTruthy());
    expect(document.querySelector("[data-phrase-index]")).toBeNull();
  });
});
