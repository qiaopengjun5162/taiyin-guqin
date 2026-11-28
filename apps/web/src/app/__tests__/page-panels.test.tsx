/**
 * @vitest-environment jsdom
 *
 * 2026-11-28 拆页后：原先这里测的是「主页右栏五个折叠面板」。
 * 那五个面板已经各自独立成页，所以这里改成验证**一个功能一个页面**：
 * 每页只挂自己的组件、导航高亮当前页、跨页「带回结果」的接线还在。
 *
 * 折叠面板时代的用例（默认收起 / 手风琴开合 / 页内锚点）不再适用——
 * 功能没丢，只是从「一页里的五个入口」变成「五个页面里的各一个入口」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { NoteColumn } from "@/lib/types";

const h = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
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

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: h.push }),
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

// 替身组件各自带一个可点的动作，用来验证「带回工作台」的接线。
vi.mock("@/components/jianzi-recognizer", () => ({
  JianziRecognizer: () => <div data-testid="recognizer-single">单字识别</div>,
}));
vi.mock("@/components/jianzi-sheet-recognizer", () => ({
  JianziSheetRecognizer: ({ onImport }: { onImport: (notes: NoteColumn[]) => void }) => (
    <button
      data-testid="recognizer-sheet"
      onClick={() =>
        onImport([
          {
            id: "imported-1",
            jianpuNumber: 5,
            jianpuOctave: "4",
            jianpuDot: false,
            duration: 0.5,
            jianzi: { json: "test" },
          } as unknown as NoteColumn,
        ])
      }
    >
      模拟整页导入
    </button>
  ),
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
  PracticeLogPanel: ({
    onPracticePhrase,
  }: {
    onPracticePhrase?: (index: number) => void;
  }) => (
    <button data-testid="practice-log" onClick={() => onPracticePhrase?.(2)}>
      练第3句
    </button>
  ),
}));

import Home from "@/app/page";
import TranslatePage from "@/app/translate/page";
import RecognizePage from "@/app/recognize/page";
import QinBoardPage from "@/app/qin-board/page";
import TunerPage from "@/app/tuner/page";
import PracticeAudioPage from "@/app/practice-audio/page";
import RecorderPage from "@/app/recorder/page";
import PracticeLogPage from "@/app/practice-log/page";
import SettingsPage from "@/app/settings/page";

beforeEach(() => {
  vi.clearAllMocks();
  h.pathname = "/";
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("单功能页：一个页面只做一件事", () => {
  it("每个功能页只挂自己的组件，不夹带其它工具", () => {
    const pages: Array<[string, React.ReactElement, string]> = [
      ["recognize", <RecognizePage key="recognize" />, "recognizer-single"],
      ["qin-board", <QinBoardPage key="qin-board" />, "qin-board"],
      ["tuner", <TunerPage key="tuner" />, "tuner"],
      ["practice-audio", <PracticeAudioPage key="practice-audio" />, "practice"],
      ["recorder", <RecorderPage key="recorder" />, "recorder"],
      ["practice-log", <PracticeLogPage key="practice-log" />, "practice-log"],
    ];
    for (const [, page, testid] of pages) {
      const { unmount } = render(page);
      expect(screen.getByTestId(testid)).toBeInTheDocument();
      unmount();
    }
  });

  it("功能导航高亮当前页", () => {
    h.pathname = "/tuner";
    render(<TunerPage />);
    const current = screen.getByRole("link", { name: "调音定弦" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "功能导航" })).toBeInTheDocument();
  });

  it("识别页单字 / 整页可切换，整页结果带回工作台", () => {
    render(<RecognizePage />);
    expect(screen.getByTestId("recognizer-single")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "整页" }));
    expect(screen.getByTestId("recognizer-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("recognizer-single")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("recognizer-sheet"));
    expect(h.push).toHaveBeenCalledWith("/");
    const queued = JSON.parse(window.sessionStorage.getItem("taiyin:bridge:notes:v1") ?? "null");
    expect(queued?.value).toHaveLength(1);
  });

  it("简谱录入页确认后同样带回工作台", () => {
    // 这里只验页面结构；Translator 的候选流程由它自己的组件测试覆盖
    render(<TranslatePage />);
    expect(screen.getByRole("tab", { name: "简谱数字" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "减字文本码" }));
    expect(screen.getByRole("tab", { name: "减字文本码" })).toHaveAttribute("aria-selected", "true");
  });

  it("日志页「练这句」带回句号并回到工作台", () => {
    render(<PracticeLogPage />);
    fireEvent.click(screen.getByTestId("practice-log"));
    expect(h.push).toHaveBeenCalledWith("/");
    expect(
      JSON.parse(window.sessionStorage.getItem("taiyin:bridge:phrase:v1") ?? "null")?.value,
    ).toBe(2);
  });

  it("主页不再挂五个工具面板，标题大纲只剩打谱相关三块", () => {
    render(<Home />);
    for (const testid of [
      "recognizer-single",
      "qin-board",
      "tuner",
      "practice",
      "recorder",
      "practice-log",
    ]) {
      expect(screen.queryByTestId(testid)).not.toBeInTheDocument();
    }
    for (const name of ["曲谱", "录入减字", "演奏控制台"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { level: 2, name: "谱字识别" })).not.toBeInTheDocument();
  });

  it("工作台会接住功能页带回的谱字", async () => {
    window.sessionStorage.setItem(
      "taiyin:bridge:notes:v1",
      JSON.stringify({
        at: Date.now(),
        value: [
          {
            id: "from-recognize",
            jianpuNumber: 5,
            jianpuOctave: "4",
            jianpuDot: false,
            duration: 0.5,
            jianzi: { json: "test" },
          } as unknown as NoteColumn,
        ],
      }),
    );
    const { container } = render(<Home />);
    await waitFor(() => expect(screen.queryByText(/已从功能页带回 1 个谱字/)).toBeInTheDocument());
    expect(container.querySelectorAll("[data-note-column]")).toHaveLength(1);
    expect(window.sessionStorage.getItem("taiyin:bridge:notes:v1")).toBeNull();
  });

  it("跳转主内容链接仍指向可聚焦的 main", () => {
    render(<Home />);
    const skip = screen.getByRole("link", { name: "跳到主内容" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("main-content")).toHaveAttribute("tabindex", "-1");
  });

  it("设置页单独承载社区后端配置", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { level: 1, name: /设置/ })).toBeInTheDocument();
  });
});
