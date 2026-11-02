/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianziFrequencyPanel } from "@/components/jianzi-frequency-panel";
import type { JianziFreqRow, VariantGroup } from "@/lib/jianzi-dictionary-types";
import type { JianziState, NoteColumn } from "@/lib/types";
import { __resetLocalScoresForTests, localCreateScore } from "@/lib/local-score-store";

// 字频统计 / 变体归并的逻辑已在 Rust（jianzi_stats 模块 + wasm）覆盖，
// 这里只验证组件与 wasm 边界的接线：选曲是否重新统计、结果与变体是否正确渲染。

const ROWS: JianziFreqRow[] = [
  {
    id: "散挑六",
    label: "散音 挑 六弦",
    count: 20,
    ratio: 20 / 30,
    toneType: "散",
    leftFinger: null,
    rightAction: "挑",
    hui: null,
    fen: null,
    slide: null,
    stringNumber: "六",
    leftVariants: [],
    actionVariants: ["挑", "乚"],
  },
  {
    id: "名九勾四",
    label: "按音 名指 九徽 勾 四弦",
    count: 10,
    ratio: 10 / 30,
    toneType: "按",
    leftFinger: "名",
    rightAction: "勾",
    hui: "九",
    fen: null,
    slide: null,
    stringNumber: "四",
    leftVariants: ["名", "夕"],
    actionVariants: ["勾", "勹"],
  },
];

const VARIANTS: VariantGroup[] = [
  { canonical: "名指", variants: ["名", "夕"], note: "『名』取左半作『夕』" },
  { canonical: "勾", variants: ["勾", "勹"], note: "勾的省写为包字头『勹』" },
  { canonical: "挑", variants: ["挑", "乚"], note: "挑的省写为竖弯钩『乚』" },
];

vi.mock("@/lib/taiyin-wasm", () => ({
  useWasmInit: () => ({ state: "ready" as const, error: null }),
  analyzeJianziFrequency: vi.fn(async () => ({ total: 30, rows: ROWS })),
  getJianziVariantGroups: vi.fn(async () => VARIANTS),
}));

import { analyzeJianziFrequency } from "@/lib/taiyin-wasm";

const analyzeMock = vi.mocked(analyzeJianziFrequency);

/** 造一个能进统计的最小音符列（统计只看 jianzi）。 */
function note(rightAction: string, stringNumber: string): NoteColumn {
  const jianzi: JianziState = {
    toneType: "散",
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction,
    stringNumber,
  };
  return {
    id: `n-${rightAction}-${stringNumber}`,
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi,
  };
}

describe("减字字频面板（wasm 接线）", () => {
  beforeEach(() => {
    __resetLocalScoresForTests();
    analyzeMock.mockClear();
  });

  it("没有本地曲谱时给出「去编辑器保存」的引导", async () => {
    render(<JianziFrequencyPanel />);
    await screen.findByTestId("freq-rows");
    expect(screen.getByText(/在编辑器里拼一首并保存/)).toBeInTheDocument();
    expect(screen.queryByTestId("my-scores")).not.toBeInTheDocument();
  });

  it("能统计用户在编辑器里保存的曲谱", async () => {
    localCreateScore("我的练习曲", [note("勾", "三"), note("勾", "三"), note("挑", "六")]);
    render(<JianziFrequencyPanel />);
    await screen.findByTestId("my-scores");

    fireEvent.click(screen.getByRole("button", { name: "我的练习曲" }));

    // 传给 Rust 的正是这首曲谱的 3 个减字，不是示例曲。
    await waitFor(() => {
      const last = analyzeMock.mock.calls.at(-1)?.[0];
      expect(last).toHaveLength(3);
      expect(last?.[2]?.rightAction).toBe("挑");
    });
    expect(screen.getByText(/《我的练习曲》/)).toBeInTheDocument();
  });

  it("wasm 就绪后渲染字频表与统计摘要", async () => {
    render(<JianziFrequencyPanel />);
    await waitFor(() => expect(screen.getByTestId("freq-rows")).toBeInTheDocument());
    expect(screen.getByText(/共 30 音/)).toBeInTheDocument();
    expect(screen.getByText(/2 种减字/)).toBeInTheDocument();
    expect(screen.getByText(/2 种含写法变体/)).toBeInTheDocument();
    expect(within(screen.getByTestId("freq-rows")).getAllByTestId("freq-row")).toHaveLength(2);
  });

  it("含变体的行标注出原始写法（名/夕、勾/勹）", async () => {
    render(<JianziFrequencyPanel />);
    await screen.findByTestId("freq-rows");
    expect(screen.getByText(/写法变体：名\/夕 · 勾\/勹/)).toBeInTheDocument();
  });

  it("渲染写法变体对照卡", async () => {
    render(<JianziFrequencyPanel />);
    await screen.findByTestId("freq-rows");
    const card = screen.getByTestId("variant-groups");
    expect(within(card).getByText("名 / 夕")).toBeInTheDocument();
    expect(within(card).getByText("勾 / 勹")).toBeInTheDocument();
    expect(within(card).getByText("挑 / 乚")).toBeInTheDocument();
  });

  it("切换曲谱会按新曲谱的音符重新统计", async () => {
    render(<JianziFrequencyPanel />);
    await screen.findByTestId("freq-rows");
    // 首个示例《沧海一声笑》有 8 个音
    await waitFor(() => {
      const first = analyzeMock.mock.calls.at(-1)?.[0];
      expect(first).toHaveLength(8);
    });
    fireEvent.click(screen.getByRole("button", { name: "仙翁操（片段）" }));
    // 《仙翁操》有 7 个音
    await waitFor(() => {
      const last = analyzeMock.mock.calls.at(-1)?.[0];
      expect(last).toHaveLength(7);
    });
  });

  it("点字频行触发试听而不抛错", async () => {
    render(<JianziFrequencyPanel />);
    await screen.findByTestId("freq-rows");
    const first = within(screen.getByTestId("freq-rows")).getAllByTestId("freq-row")[0];
    expect(() => fireEvent.click(first)).not.toThrow();
  });
});
