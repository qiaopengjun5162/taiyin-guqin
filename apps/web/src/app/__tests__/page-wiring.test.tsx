/**
 * @vitest-environment jsdom
 *
 * 主页面「剩余接线」补漏：联袂指法、录入/识别导入、社区排序筛选、
 * 认领、跟弹判定回调、卡点句练这句。
 *
 * 这些路径都是 page.tsx 自己的状态机与回调接线，孩子组件一律换替身
 * （FollowPlayPanel / PracticeLogPanel / 识别组件各自有自己的测试），
 * 本文件只对 page.tsx 的契约负责。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { NoteColumn } from "@/lib/types";
import { createEmptyState } from "@/lib/jianzi";

const h = vi.hoisted(() => ({
  play: vi.fn(),
  stopPlayback: vi.fn(),
  toggleMetronome: vi.fn(),
  stopMetronome: vi.fn(),
  renderScoreToBuffer: vi.fn(),
  downloadWav: vi.fn(),
  downloadTextFile: vi.fn(),
  exportPng: vi.fn(),
  exportSvg: vi.fn(),
  translateJianpuToJianzi: vi.fn(),
  splitPhrases: vi.fn(),
  // 社区列表按页取：本文件要断言 sort / query / tuning 参数，直接当 spy 用
  listScoresPage: vi.fn(),
  listScores: vi.fn(),
  localListScores: vi.fn(),
  createScore: vi.fn(),
  getScore: vi.fn(),
  updateScore: vi.fn(),
  deleteScore: vi.fn(),
  localDeleteScore: vi.fn(),
  listFavoritesPage: vi.fn(),
  listFavoriteIds: vi.fn(),
  favoriteScore: vi.fn(),
  unfavoriteScore: vi.fn(),
  reportScore: vi.fn(),
  claimScore: vi.fn(),
  addEntry: vi.fn(),
  scoreToMidi: vi.fn(),
  downloadMidi: vi.fn(),
}));

/** 可切换的存储模式：默认 browser，社区/认领用例里切 server。 */
const storeState = vi.hoisted(() => ({ storageMode: "server" as "server" | "browser" }));

vi.mock("@/lib/use-score-player", async () => {
  const React = await import("react");
  return {
    useScorePlayer: (
      _notes: unknown,
      _bpm?: number,
      _concertPitch?: number,
      _tuning?: unknown,
      onPracticeEnd?: () => void,
    ) => {
      const [isPlaying, setPlaying] = React.useState(false);
      void onPracticeEnd;
      return {
        isPlaying,
        playingIndex: isPlaying ? 0 : null,
        practicePass: isPlaying ? 1 : null,
        play: (index?: number, practice?: unknown) => {
          h.play(index, practice);
          setPlaying(true);
          return Promise.resolve();
        },
        stop: () => {
          h.stopPlayback();
          setPlaying(false);
        },
      };
    },
  };
});

vi.mock("@/lib/use-metronome", async () => {
  const React = await import("react");
  return {
    useMetronome: () => {
      const [isRunning, setRunning] = React.useState(false);
      const [currentBeat] = React.useState(0);
      return {
        isRunning,
        currentBeat,
        toggle: () => {
          h.toggleMetronome();
          setRunning((v) => !v);
        },
        stop: () => {
          h.stopMetronome();
          setRunning(false);
        },
      };
    },
  };
});

vi.mock("@/lib/audio-export", () => ({
  renderScoreToBuffer: h.renderScoreToBuffer,
  downloadWav: h.downloadWav,
}));

vi.mock("@/lib/score-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/score-export")>();
  return { ...actual, downloadTextFile: h.downloadTextFile };
});

vi.mock("@/lib/use-export-image", () => ({
  useExportImage: () => ({
    exportPng: h.exportPng,
    exportSvg: h.exportSvg,
    isExporting: false,
  }),
}));

vi.mock("@/lib/taiyin-wasm", () => ({
  getWasmLoadState: () => "ready",
  getWasmLoadError: () => null,
  initWasm: vi.fn().mockResolvedValue(undefined),
  useWasmInit: () => ({ state: "ready", error: null }),
  translateJianpuToJianzi: h.translateJianpuToJianzi,
  translateJianpuSequenceToJianzi: vi.fn(),
  splitPhrases: h.splitPhrases,
  encodeJianziBatch: vi.fn().mockResolvedValue([]),
  decodeJianziBatch: vi.fn(),
  getJianziDictionary: vi.fn().mockResolvedValue({ total: 0, entries: [] }),
  analyzeJianziFrequency: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
  getJianziVariantGroups: vi.fn().mockResolvedValue([]),
}));

// 跟弹判定通过顺手记一笔练琴：这是 page 的回调，记账本体在 practice-log 自己的测试里
vi.mock("@/lib/practice-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/practice-log")>();
  return { ...actual, addEntry: h.addEntry };
});

vi.mock("@/lib/midi-export", () => ({
  scoreToMidi: h.scoreToMidi,
  downloadMidi: h.downloadMidi,
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError,
    listScores: h.listScores,
    listScoresPage: h.listScoresPage,
    createScore: h.createScore,
    getScore: h.getScore,
    updateScore: h.updateScore,
    deleteScore: h.deleteScore,
    localDeleteScore: h.localDeleteScore,
    localListScores: h.localListScores,
    localGetScore: vi.fn(),
    listFavoritesPage: h.listFavoritesPage,
    listFavoriteIds: h.listFavoriteIds,
    favoriteScore: h.favoriteScore,
    unfavoriteScore: h.unfavoriteScore,
    reportScore: h.reportScore,
    claimScore: h.claimScore,
    fetchCurrentUser: async () => ({ id: "u-1", email: "qin@you.com", display_name: "我" }),
    loginAccount: vi.fn(),
    registerAccount: vi.fn(),
    logoutAccount: vi.fn(),
    selectCandidates: vi.fn(),
    recognizeJianzi: vi.fn(),
    recognizeJianziSheet: vi.fn(),
    scoreStorageMode: () => storeState.storageMode,
    isBrowserOnlyMode: () => false,
  };
});

// 孩子组件替身：只验 page 传下来的 props 接线（onImport / onPass / onLog / onPracticePhrase）
vi.mock("@/components/jianzi-recognizer", () => ({
  JianziRecognizer: () => <div data-testid="recognizer-single">单字识别</div>,
}));
vi.mock("@/components/jianzi-sheet-recognizer", () => ({
  JianziSheetRecognizer: ({ onImport }: { onImport: (notes: NoteColumn[]) => void }) => (
    <button onClick={() => onImport([makeNote("sheet-1")])}>模拟整页导入</button>
  ),
}));
vi.mock("@/components/jianzi-code-import", () => ({
  JianziCodeImport: ({ onImport }: { onImport: (notes: NoteColumn[]) => void }) => (
    <button onClick={() => onImport([makeNote("code-1")])}>模拟码导入</button>
  ),
}));
vi.mock("@/components/qin-board", () => ({ QinBoard: () => <div>琴面</div> }));
vi.mock("@/components/tuner-panel", () => ({ TunerPanel: () => <div>调音器</div> }));
vi.mock("@/components/practice-player", () => ({ PracticePlayer: () => <div>跟录音练</div> }));
vi.mock("@/components/recorder-panel", () => ({ RecorderPanel: () => <div>录音</div> }));
vi.mock("@/components/follow-play-panel", () => ({
  FollowPlayPanel: (props: {
    onBeforeStart?: () => void;
    onPass?: (tempo: number) => void;
    onLog?: (seconds: number) => void;
  }) => (
    <div>
      <button onClick={() => props.onBeforeStart?.()}>判定-先停声</button>
      <button onClick={() => props.onPass?.(0.8)}>判定-通过0.8</button>
      <button onClick={() => props.onPass?.(0.5)}>判定-通过0.5</button>
      <button onClick={() => props.onLog?.(30)}>判定-记谱</button>
    </div>
  ),
}));
vi.mock("@/components/practice-log-panel", () => ({
  PracticeLogPanel: (props: {
    sticking?: { index: number; best: number }[];
    onPracticePhrase?: (index: number, tempo: number) => void;
  }) => (
    <div>
      <div data-testid="sticking-count">{(props.sticking ?? []).length}</div>
      <button onClick={() => props.onPracticePhrase?.(props.sticking?.[0]?.index ?? 0, 0)}>
        练卡点句
      </button>
      <button onClick={() => props.onPracticePhrase?.(0, 0)}>练第1句</button>
    </div>
  ),
}));

import Home from "@/app/page";
import { ApiError } from "@/lib/api";
import { resetTuningCache } from "@/lib/tuning";

function makeNote(id: string): NoteColumn {
  return {
    id,
    jianpuNumber: "1",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: createEmptyState(),
  };
}

const EXAMPLE = "沧海一声笑";

function noteColumns(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll("[data-note-column]");
}

async function loadExample() {
  const utils = render(<Home />);
  fireEvent.click(screen.getByRole("button", { name: EXAMPLE }));
  await waitFor(() => {
    expect(noteColumns(utils.container).length).toBeGreaterThan(0);
  });
  return utils;
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
  h.renderScoreToBuffer.mockResolvedValue({ length: 1024 } as unknown as AudioBuffer);
  h.listScores.mockResolvedValue([]);
  h.listScoresPage.mockResolvedValue({ items: [], total: 0 });
  h.localListScores.mockResolvedValue([]);
  h.listFavoritesPage.mockResolvedValue({ items: [], total: 0 });
  h.listFavoriteIds.mockResolvedValue([]);
  h.addEntry.mockResolvedValue({});
  h.splitPhrases.mockResolvedValue([
    { start: 0, end: 3 },
    { start: 4, end: 7 },
  ]);
  window.localStorage.clear();
  resetTuningCache();
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("Home · 联袂指法接线", () => {
  it("编辑音符时可与后一音成组，解组后恢复", async () => {
    const { container } = await loadExample();

    fireEvent.click(noteColumns(container)[0]);
    expect(container.textContent).toContain("与后一音联袂");

    // 关系提示条一定在（四个分支共用这个出口）
    expect(container.querySelector("[data-lianmei-relation]")).not.toBeNull();

    const tong = screen.getByRole("button", { name: "同声" });
    fireEvent.click(tong);
    expect(tong.getAttribute("aria-pressed")).toBe("true");

    // 成组后给出解组按钮；点掉后回到未成组
    fireEvent.click(screen.getByRole("button", { name: "解组" }));
    expect(screen.getByRole("button", { name: "同声" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("button", { name: "解组" })).toBeNull();
  });

  it("编辑最后一个音时不给联袂区（没有后一音可组）", async () => {
    const { container } = await loadExample();

    fireEvent.click(noteColumns(container)[7]);
    expect(container.textContent).toContain("正在编辑第 8 音");
    expect(container.textContent).not.toContain("与后一音联袂");
  });
});

describe("Home · 录入与识别导入接线", () => {
  it("减字码入谱 tab 的 onImport 把音符追加到谱尾", async () => {
    const { container } = await loadExample();
    expect(noteColumns(container).length).toBe(8);

    fireEvent.click(screen.getByRole("button", { name: "减字码入谱" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟码导入" }));

    expect(noteColumns(container).length).toBe(9);

    // 切回简谱 tab 仍能渲染
    fireEvent.click(screen.getByRole("button", { name: "简谱转减字" }));
    expect(container.textContent).toContain("提示");
  });

  it("整页识别的 onImport 把音符追加到谱尾", async () => {
    const { container } = await loadExample();

    fireEvent.click(screen.getByRole("button", { name: "＋ 识别减字图片" }));
    fireEvent.click(screen.getByRole("button", { name: "整页" }));
    fireEvent.click(screen.getByRole("button", { name: "模拟整页导入" }));

    expect(noteColumns(container).length).toBe(9);
  });
});

describe("Home · 社区排序与筛选接线", () => {
  const SCORES = [
    { id: "c1", title: "平沙落雁", tuning: "zhengdiao", created_at: "", updated_at: "" },
    { id: "c2", title: "流水", tuning: "ruibin", created_at: "", updated_at: "" },
  ];

  it("点「最热」带 sort=popular 重拉第一页", async () => {
    h.listScoresPage.mockResolvedValue({ items: SCORES, total: 2 });

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("平沙落雁", {}, { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "最热" }));
    await waitFor(() =>
      expect(h.listScoresPage).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "popular" }),
      ),
    );
  }, 20000);

  it("切换排序失败时提示，不吞成静默", async () => {
    h.listScoresPage.mockResolvedValue({ items: SCORES, total: 2 });

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("平沙落雁", {}, { timeout: 5000 });

    h.listScoresPage.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "最热" }));

    // 默认 findByText 只等 1000ms，CI 慢机上会假红（2026-11-10 实测 1187ms 超时、
    // 本地 21/21 全绿）。同文件其它异步断言都给 3000~5000ms，这里对齐。
    expect(
      await screen.findByText("切换排序失败，请稍后再试", {}, { timeout: 5000 }),
    ).toBeTruthy();
  });

  it("搜索词防抖后带 query 重拉（不是只在已加载里过滤）", async () => {
    h.listScoresPage.mockResolvedValue({ items: SCORES, total: 2 });

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("平沙落雁", {}, { timeout: 5000 });

    fireEvent.change(screen.getByLabelText("按曲名搜索"), {
      target: { value: "平沙" },
    });

    // 300ms 防抖：等它真的发出去
    await waitFor(
      () =>
        expect(h.listScoresPage).toHaveBeenCalledWith(
          expect.objectContaining({ query: "平沙" }),
        ),
      { timeout: 2000 },
    );
  });

  it("定弦筛选带 tuning 重拉；失败提示「筛选失败」", async () => {
    h.listScoresPage.mockResolvedValue({ items: SCORES, total: 2 });

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("平沙落雁", {}, { timeout: 5000 });

    h.listScoresPage.mockRejectedValueOnce(new Error("boom"));
    fireEvent.change(screen.getByLabelText("按定弦筛选"), {
      target: { value: "ruibin" },
    });

    expect(await screen.findByText("筛选失败，请稍后再试", {}, { timeout: 3000 })).toBeTruthy();
    await waitFor(() =>
      expect(h.listScoresPage).toHaveBeenCalledWith(
        expect.objectContaining({ tuning: "ruibin" }),
      ),
    );
  });

  it("社区翻页失败：提示「加载更多失败」并复位按钮", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({
      id: `c${i}`,
      title: `社区谱${i}`,
      tuning: "zhengdiao",
      created_at: "",
      updated_at: "",
    }));
    h.listScoresPage
      .mockResolvedValueOnce({ items: page1, total: 51 })
      .mockRejectedValueOnce(new Error("boom"));

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("社区谱0", {}, { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("加载更多失败，请稍后再试", {}, { timeout: 5000 })).toBeTruthy();
    // 失败后按钮要能再点（loadingMore 复位）
    expect(
      (screen.getByRole("button", { name: "加载更多" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  }, 20000);

  it("收藏翻页失败：提示「加载更多收藏失败」", async () => {
    const auth = await import("@/lib/auth");
    auth.setStoredSession({
      token: "tok",
      user: { id: "u-1", email: "qin@you.com", display_name: "我" },
    });
    const favs = Array.from({ length: 50 }, (_, i) => ({
      id: `f${i}`,
      title: `收藏${i}`,
      tuning: "zhengdiao",
      created_at: "",
      updated_at: "",
    }));
    h.listFavoritesPage
      .mockResolvedValueOnce({ items: favs, total: 51 })
      .mockRejectedValueOnce(new Error("boom"));

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    // 登录且有收藏：默认落在「我的收藏」
    await screen.findByText("收藏0", {}, { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(
      await screen.findByText("加载更多收藏失败，请稍后再试", {}, { timeout: 5000 }),
    ).toBeTruthy();
  }, 20000);
});

describe("Home · 认领曲谱接线", () => {
  const MINE = {
    id: "p1",
    title: "旧谱",
    tuning: "zhengdiao",
    created_at: "",
    updated_at: "",
  };

  async function openClaimable() {
    const auth = await import("@/lib/auth");
    auth.setStoredSession({
      token: "tok",
      user: { id: "u-1", email: "qin@you.com", display_name: "我" },
    });
    window.localStorage.setItem("taiyin.myScoreIds", JSON.stringify([MINE.id]));
    h.listScoresPage.mockResolvedValue({ items: [MINE], total: 1 });
    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("旧谱", {}, { timeout: 5000 });
  }

  it("确认认领后提交并就地更新列表", async () => {
    h.claimScore.mockResolvedValue({ owner_user_id: "u-1" });
    await openClaimable();

    fireEvent.click(screen.getByRole("button", { name: "认领" }));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("挂到我的账号下"),
    );
    await waitFor(() => expect(h.claimScore).toHaveBeenCalledWith("p1"));
    expect(
      await screen.findByText("已认领到我的账号，之后换设备也能改删它"),
    ).toBeTruthy();
  });

  it("确认框里点取消就不发请求", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await openClaimable();

    fireEvent.click(screen.getByRole("button", { name: "认领" }));
    expect(h.claimScore).not.toHaveBeenCalled();
  });

  it("认领失败时把服务端原话显示出来", async () => {
    h.claimScore.mockRejectedValue(new ApiError("这个凭证对不上", 403));
    await openClaimable();

    fireEvent.click(screen.getByRole("button", { name: "认领" }));
    expect(await screen.findByText("这个凭证对不上")).toBeTruthy();
  });
});

describe("Home · 跟弹判定回调接线", () => {
  it("开始判定前先把播放与节拍器都停掉（防参考音录进麦克风）", async () => {
    await loadExample();
    fireEvent.click(screen.getByRole("button", { name: "启动节拍器" }));
    fireEvent.click(screen.getByRole("button", { name: "判定-先停声" }));

    expect(h.stopPlayback).toHaveBeenCalled();
    expect(h.stopMetronome).toHaveBeenCalled();
  });

  it("没在练时判定通过/记谱都不写（practiceIndex 空早退）", async () => {
    await loadExample();

    fireEvent.click(screen.getByRole("button", { name: "判定-通过0.8" }));
    fireEvent.click(screen.getByRole("button", { name: "判定-记谱" }));

    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith("taiyin.practiceProgress.v1:"),
    );
    expect(keys).toHaveLength(0);
    expect(h.addEntry).not.toHaveBeenCalled();
  });

  it("判定通过记档位（只升不降），记谱带句号与档位", async () => {
    await loadExample();
    fireEvent.click(await screen.findByLabelText("慢练第 2 句"));

    fireEvent.click(screen.getByRole("button", { name: "判定-通过0.8" }));
    await waitFor(() => {
      const stored = Object.keys(window.localStorage)
        .filter((k) => k.startsWith("taiyin.practiceProgress.v1:"))
        .map((k) => window.localStorage.getItem(k))
        .join("");
      expect(stored).toContain('"4-7-4":0.8');
    });

    // 低档不降级
    fireEvent.click(screen.getByRole("button", { name: "判定-通过0.5" }));
    const stored = Object.keys(window.localStorage)
      .filter((k) => k.startsWith("taiyin.practiceProgress.v1:"))
      .map((k) => window.localStorage.getItem(k))
      .join("");
    expect(stored).toContain('"4-7-4":0.8');
    expect(stored).not.toContain("0.5");

    fireEvent.click(screen.getByRole("button", { name: "判定-记谱" }));
    await waitFor(() =>
      expect(h.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "judge",
          seconds: 30,
          note: "跟弹 · 第 2 句 · 0.6×",
        }),
      ),
    );
  });
});

describe("Home · 卡点句「练这句」接线", () => {
  it("有成绩的句按最好成绩档起练，没成绩的退回当前档", async () => {
    // 第 2 句（键 4-7-4）练到 0.8，第 1 句没练过。
    // 进度键 = local|曲名|音数，示例曲全名带「（片段）」
    window.localStorage.setItem(
      "taiyin.practiceProgress.v1:local|沧海一声笑（片段）|8",
      JSON.stringify({ "4-7-4": 0.8 }),
    );
    await loadExample();

    fireEvent.click(screen.getByText(/练琴记录/));
    fireEvent.click(screen.getByText("打卡与统计"));
    expect(await screen.findByTestId("sticking-count")).toHaveTextContent("1");

    // 先点没成绩的句：退回当前档（默认 0.6），再点卡点句：按最好成绩 0.8 起练
    fireEvent.click(screen.getByRole("button", { name: "练第1句" }));
    expect(h.play).toHaveBeenCalledWith(0, { endIndex: 3, repeat: 3, tempo: 0.6 });

    fireEvent.click(screen.getByRole("button", { name: "练卡点句" }));
    expect(h.play).toHaveBeenCalledWith(4, { endIndex: 7, repeat: 3, tempo: 0.8 });
  });
});

describe("Home · 导出与外观零散接线", () => {
  it("导出 MIDI 走 scoreToMidi + 下载通道", async () => {
    h.scoreToMidi.mockReturnValue(new Uint8Array([1, 2, 3]));
    await loadExample();

    fireEvent.click(screen.getByLabelText("导出 MIDI"));
    expect(h.scoreToMidi).toHaveBeenCalledTimes(1);
    expect(h.downloadMidi).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.stringContaining(".mid"),
    );
  });

  it("谱面布局 / 疏密 / 行宽三个控件都真的写进偏好", async () => {
    const { container } = await loadExample();

    fireEvent.click(screen.getByRole("button", { name: "小节换行" }));
    expect(
      screen.getByRole("button", { name: "小节换行" }).getAttribute("aria-pressed"),
    ).toBe("true");
    // 布局重排后音符列还在（只是排法变了）
    expect(noteColumns(container).length).toBe(8);

    fireEvent.change(screen.getByLabelText("谱面疏密"), { target: { value: "loose" } });
    fireEvent.change(screen.getByLabelText("谱面行宽"), { target: { value: "narrow" } });

    const pref = JSON.parse(window.localStorage.getItem("taiyin.scoreLayout.v1") ?? "{}");
    expect(pref).toMatchObject({ layout: "barline", density: "loose", width: "narrow" });
  });

  it("改标题后 blur 不丢字，且撤销历史仍可用", async () => {
    await loadExample();

    const input = screen.getByLabelText("曲谱名称") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "我的新谱" } });
    fireEvent.blur(input);
    // blur（commitTitle）不能把正在编辑的标题弄丢
    expect(input.value).toBe("我的新谱");

    // 历史没被 blur 弄坏：一次撤销离开当前标题
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(input.value).not.toBe("我的新谱"));
  });

  it("加载对话框点「取消」关掉", async () => {
    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("社区曲谱", {}, { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("社区曲谱")).toBeNull();
  });
});
