/**
 * @vitest-environment jsdom
 *
 * 主页底部那几个「＋ …」折叠面板的接线测试。
 *
 * 这些面板平时收着，展开才挂载子组件——正因为平时看不见，
 * 之前漏过「点了没反应」这类问题（子组件没接上、tab 状态写错）。
 * 这里把每个面板都真正点开一次，确认挂的是对应组件、切 tab 生效、再点能收起。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  listScores: vi.fn().mockResolvedValue([]),
  createScore: vi.fn(),
  getScore: vi.fn(),
  updateScore: vi.fn(),
  deleteScore: vi.fn(),
  translateJianpuToJianzi: vi.fn(),
  encodeJianziBatchSync: vi.fn().mockReturnValue([]),
  decodeJianziBatch: vi.fn(),
  renderScoreToBuffer: vi.fn(),
  downloadWav: vi.fn(),
  downloadTextFile: vi.fn(),
  exportPng: vi.fn(),
  exportSvg: vi.fn(),
  play: vi.fn(),
  stopPlayback: vi.fn(),
  toggleMetronome: vi.fn(),
  stopMetronome: vi.fn(),
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {}
  return {
    ApiError,
    listScores: h.listScores,
    createScore: h.createScore,
    getScore: h.getScore,
    updateScore: h.updateScore,
    deleteScore: h.deleteScore,
    selectCandidates: vi.fn(),
    recognizeJianzi: vi.fn(),
    recognizeJianziSheet: vi.fn(),
    scoreStorageMode: () => "server",
    isBrowserOnlyMode: () => false,
  };
});

vi.mock("@/lib/use-score-player", async () => {
  const React = await import("react");
  return {
    useScorePlayer: () => {
      const [, setPlaying] = React.useState(false);
      return {
        isPlaying: false,
        playingIndex: null,
        play: () => {
          h.play();
          setPlaying(true);
          return Promise.resolve();
        },
        stop: () => h.stopPlayback(),
      };
    },
  };
});

vi.mock("@/lib/use-metronome", () => ({
  useMetronome: () => ({ isRunning: false, currentBeat: 0, toggle: h.toggleMetronome, stop: h.stopMetronome }),
}));

vi.mock("@/lib/use-export-image", () => ({
  useExportImage: () => ({ exportPng: h.exportPng, exportSvg: h.exportSvg, isExporting: false }),
}));

vi.mock("@/lib/audio-export", () => ({
  renderScoreToBuffer: h.renderScoreToBuffer,
  downloadWav: h.downloadWav,
}));

vi.mock("@/lib/score-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/score-export")>();
  return { ...actual, downloadTextFile: h.downloadTextFile };
});

vi.mock("@/lib/taiyin-wasm", () => ({
  // 释义/短标签等已迁进 Rust，前端薄壳要 isWasmReady 才肯转发。
  // 这里给「未就绪」：本测试只关心面板开合，释义内容不参与断言；
  // 给了 ready 反而要连 getWasmSync 一起造，平白多一堆假实现。
  isWasmReady: () => false,
  getWasmSync: () => {
    throw new Error("本测试不应调用 WASM 同步接口");
  },
  getWasmLoadState: () => "ready",
  getWasmLoadError: () => null,
  initWasm: vi.fn().mockResolvedValue(undefined),
  useWasmInit: () => ({ state: "ready", error: null }),
  translateJianpuToJianzi: h.translateJianpuToJianzi,
  translateJianpuSequenceToJianzi: vi.fn(),
  splitPhrases: vi.fn().mockResolvedValue([]),
  encodeJianziBatchSync: h.encodeJianziBatchSync,
  decodeJianziBatch: h.decodeJianziBatch,
  getJianziDictionary: vi.fn().mockResolvedValue({ total: 0, entries: [] }),
  analyzeJianziFrequency: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
  getJianziVariantGroups: vi.fn().mockResolvedValue([]),
}));

// 只替身这几个「展开才出现」的组件：它们各自要麦克风/音频/画布，与本测试无关。
vi.mock("@/components/jianzi-recognizer", () => ({
  JianziRecognizer: () => <div data-testid="recognizer-single">单字识别</div>,
}));
vi.mock("@/components/jianzi-sheet-recognizer", () => ({
  JianziSheetRecognizer: () => <div data-testid="recognizer-sheet">整页识别</div>,
}));
vi.mock("@/components/qin-board", () => ({
  QinBoard: () => <div data-testid="qin-board">琴面</div>,
}));
vi.mock("@/components/tuner-panel", () => ({
  TunerPanel: () => <div data-testid="tuner">调音器</div>,
}));
vi.mock("@/components/practice-player", () => ({
  PracticePlayer: () => <div data-testid="practice">跟录音练</div>,
}));
vi.mock("@/components/recorder-panel", () => ({
  RecorderPanel: () => <div data-testid="recorder">录音</div>,
}));
vi.mock("@/components/practice-log-panel", () => ({
  PracticeLogPanel: () => <div data-testid="practice-log">打卡统计</div>,
}));

import Home from "@/app/page";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("主页语义结构（屏幕阅读器 / 键盘）", () => {
  it("标题大纲：唯一 h1，各主区块都有 h2 可跳转", () => {
    render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // 区块名与右栏页内导航一致；改文案时两边一起改
    for (const name of [
      "曲谱",
      "录入减字",
      "演奏控制台",
      "谱字识别",
      "琴面音位",
      "调音定弦",
      "跟奏",
      "练琴日志",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  it("折叠按钮用 aria-expanded 播报开合状态", () => {
    render(<Home />);

    const toggle = screen.getByRole("button", { name: "＋ 识别减字图片" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "收起识别" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("跳转主内容链接指向可聚焦的 main", () => {
    render(<Home />);

    const skip = screen.getByRole("link", { name: "跳到主内容" });
    expect(skip).toHaveAttribute("href", "#main-content");

    const main = document.getElementById("main-content");
    expect(main).toBeInTheDocument();
    // tabindex=-1 才能让锚点跳转把焦点交给 main，而不是留在链接上
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});

describe("主页折叠面板", () => {
  it("默认全部收起：只留入口，不挂子组件", () => {
    render(<Home />);

    expect(screen.queryByTestId("recognizer-single")).not.toBeInTheDocument();
    expect(screen.queryByTestId("qin-board")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tuner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("practice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("recorder")).not.toBeInTheDocument();
    // 用按钮角色定位：折叠说明里也提到了「识别减字图片」，纯文本匹配会撞上两个
    expect(screen.getByRole("button", { name: /识别减字图片/ })).toBeInTheDocument();
  });

  it("点开识别：默认单字，可切整页，再点收起", () => {
    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /识别减字图片/ }));
    expect(screen.getByTestId("recognizer-single")).toBeInTheDocument();

    fireEvent.click(screen.getByText("整页"));
    expect(screen.getByTestId("recognizer-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("recognizer-single")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("单字"));
    expect(screen.getByTestId("recognizer-single")).toBeInTheDocument();

    fireEvent.click(screen.getByText("收起识别"));
    expect(screen.queryByTestId("recognizer-single")).not.toBeInTheDocument();
  });

  it("琴面 / 调音 / 跟录音练三个面板各自能开", () => {
    render(<Home />);

    fireEvent.click(screen.getByText(/琴面音位全览/));
    expect(screen.getByTestId("qin-board")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/调音 \/ 定弦/));
    expect(screen.getByTestId("tuner")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/跟录音练/));
    expect(screen.getByTestId("practice")).toBeInTheDocument();
  });

  it("练琴记录：默认录音页，可切到打卡与统计", () => {
    render(<Home />);

    fireEvent.click(screen.getByText(/练琴记录/));
    expect(screen.getByTestId("recorder")).toBeInTheDocument();

    fireEvent.click(screen.getByText("打卡与统计"));
    expect(screen.getByTestId("practice-log")).toBeInTheDocument();
    expect(screen.queryByTestId("recorder")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("录音"));
    expect(screen.getByTestId("recorder")).toBeInTheDocument();
  });
});
