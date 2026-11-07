/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianziConcordance } from "@/components/jianzi-concordance";
import { __resetLocalScoresForTests, localCreateScore } from "@/lib/local-score-store";
import type { JianziState, NoteColumn } from "@/lib/types";

// 试听会碰 AudioContext，jsdom 里没有；这里只验证「点了会调」，声音本身由
// use-note-preview 自己的测试与真机验证负责。
const previewNote = vi.hoisted(() =>
  vi.fn((state: unknown) => typeof state === "object"),
);
vi.mock("@/lib/use-note-preview", () => ({ useNotePreview: () => previewNote }));

// 切句要走 WASM，测试里换成直接给整首一句，避免为了测 UI 去加载 wasm。
vi.mock("@/lib/score-phrases", () => ({
  splitScorePhrases: async (notes: unknown[]) => [
    { start: 0, end: Math.max(notes.length - 1, 0), noteCount: notes.length, beats: 8 },
  ],
}));

// 内置示例谱固定成一首「散勾三」：与下面用例里的怪字互不干扰，
// 这样「示例 / 我的」两种来源都能各自断言。
vi.mock("@/lib/example-scores", () => {
  const jianzi = {
    toneType: "散",
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: "勹",
    stringNumber: "三",
  };
  return {
    EXAMPLE_SCORES: [
      {
        id: "ex-1",
        title: "示例曲",
        description: "",
        notes: [
          {
            id: "ex-n1",
            jianpuNumber: "5",
            jianpuOctave: "",
            jianpuDot: false,
            duration: "四分",
            jianzi,
          },
        ],
      },
    ],
  };
});

/** 曲库里不会有的怪字：跪指十三徽二分、摘七弦。 */
const RARE: JianziState = {
  toneType: "按",
  rhythmMode: null,
  leftFinger: "跪",
  hui: "十三",
  fen: "二分",
  slide: null,
  rightAction: "倽",
  stringNumber: "七",
};

const SAN_GOU_SAN: JianziState = {
  toneType: "散",
  rhythmMode: null,
  leftFinger: null,
  hui: null,
  fen: null,
  slide: null,
  rightAction: "勹",
  stringNumber: "三",
};

let seq = 0;
function note(jianzi: JianziState): NoteColumn {
  seq += 1;
  return {
    id: `n-${seq}`,
    jianpuNumber: "1",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi,
  };
}

beforeEach(() => {
  __resetLocalScoresForTests();
  previewNote.mockClear();
});

describe("JianziConcordance", () => {
  it("列出本机曲谱里的谱例，给句号与音序", async () => {
    localCreateScore("良宵引", [note({ ...RARE }), note({ ...RARE })]);
    render(<JianziConcordance state={RARE} />);

    expect(await screen.findByText("良宵引")).toBeInTheDocument();
    expect(screen.getByText("谱中见过")).toBeInTheDocument();
    expect(screen.getByText(/2 处 · 1 首/)).toBeInTheDocument();
    expect(screen.getAllByText("第 1 句")).toHaveLength(2);
    expect(screen.getAllByText("第 1 音").length).toBeGreaterThan(0);
    // 本地曲谱标「我」，内置示例谱标「例」
    expect(screen.getAllByText("我").length).toBeGreaterThan(0);
  });

  it("点一行就试听这一字", async () => {
    localCreateScore("良宵引", [note({ ...RARE })]);
    render(<JianziConcordance state={RARE} />);

    const row = await screen.findByRole("button", { name: /良宵引/ });
    fireEvent.click(row);
    expect(previewNote).toHaveBeenCalledTimes(1);
    expect(previewNote.mock.calls[0]?.[0]).toMatchObject({ rightAction: "倽" });
  });

  it("示例谱命中时标「例」", async () => {
    render(<JianziConcordance state={SAN_GOU_SAN} />);

    expect(await screen.findByText("示例曲")).toBeInTheDocument();
    expect(screen.getByText("例")).toBeInTheDocument();
    expect(screen.getByText(/1 处 · 1 首/)).toBeInTheDocument();
  });

  it("换了弦的谱例标「别弦」", async () => {
    localCreateScore("平沙落雁", [note({ ...RARE, stringNumber: "二" })]);
    render(<JianziConcordance state={RARE} />);

    expect(await screen.findByText("平沙落雁")).toBeInTheDocument();
    expect(screen.getByText("别弦")).toBeInTheDocument();
  });

  it("超过 8 处时收起剩下的", async () => {
    localCreateScore(
      "长曲",
      Array.from({ length: 10 }, () => note({ ...RARE })),
    );
    render(<JianziConcordance state={RARE} />);

    expect(await screen.findByText("长曲")).toBeInTheDocument();
    expect(screen.getByText(/另有 2 处/)).toBeInTheDocument();
  });

  it("曲库里没这个字时整块不渲染", async () => {
    // 同一个曲库、同一个组件，只换待查的字做对照：
    // 查不到时必须整块消失，查到时必须出现——只断言「空」会连「根本没挂上」也放过。
    localCreateScore("良宵引", [note(SAN_GOU_SAN)]);

    const miss = render(<JianziConcordance state={RARE} />);
    await act(async () => {});
    expect(miss.container).toBeEmptyDOMElement();
    miss.unmount();

    const hit = render(<JianziConcordance state={SAN_GOU_SAN} />);
    await act(async () => {});
    expect(hit.container).not.toBeEmptyDOMElement();
  });
});
