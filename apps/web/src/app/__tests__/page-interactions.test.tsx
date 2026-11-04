/**
 * @vitest-environment jsdom
 *
 * 主页面「交互接线」测试：播放/节拍器/导出/保存/加载/编辑/删除。
 *
 * 这里把三个带副作用的 hook（播放、节拍器、音频导出）与后端 API 换成了替身，
 * 只验证 page.tsx 自己的状态机与参数传递是否正确。
 * 真音频合成、真 WAV 编码、真 HTTP 分别由 audio-export / audio-synth / api 的测试守。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { NoteColumn } from "@/lib/types";

const h = vi.hoisted(() => ({
  play: vi.fn(),
  stopPlayback: vi.fn(),
  toggleMetronome: vi.fn(),
  stopMetronome: vi.fn(),
  renderScoreToBuffer: vi.fn(),
  downloadWav: vi.fn(),
  downloadTextFile: vi.fn(),
  createScore: vi.fn(),
  updateScore: vi.fn(),
  listScores: vi.fn(),
  localListScores: vi.fn(),
  getScore: vi.fn(),
  localGetScore: vi.fn(),
  deleteScore: vi.fn(),
  localDeleteScore: vi.fn(),
  exportPng: vi.fn(),
  exportSvg: vi.fn(),
  translateJianpuToJianzi: vi.fn(),
  // 分句：慢练按钮靠它决定「分几句、每句到哪」
  splitPhrases: vi.fn(),
  // 收藏：登录后打开曲谱列表会拉这两个，点星会调那两个
  listFavoritesPage: vi.fn(),
  listFavoriteIds: vi.fn(),
  favoriteScore: vi.fn(),
  unfavoriteScore: vi.fn(),
  // 举报：社区列表里别人的谱点旗标
  reportScore: vi.fn(),
}));

/**
 * 播放 hook 收到的「练完三遍」回调。
 *
 * 单独放一个容器、不塞进 `h`：`h` 里全是 vi.fn()，beforeEach 会一律 mockReset，
 * 混进一个普通函数就会连 beforeEach 一起炸掉。
 */
const practiceEnd = vi.hoisted(() => ({ current: null as null | (() => void) }));

/** 可切换的存储模式：默认 browser（与既有用例一致），迁移用例里临时切 server。 */
const storeState = vi.hoisted(() => ({ storageMode: "browser" as "server" | "browser" }));

/** 播放 hook：用真实 useState 撑起 isPlaying，让按钮文案能跟着变。 */
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
      // 真 hook 在「三遍走完」时先停再回调；这里让替身照做，
      // 否则用例触发完回调还停在「正在练」，看不出停止后的样子
      practiceEnd.current = onPracticeEnd
        ? () => {
            setPlaying(false);
            onPracticeEnd();
          }
        : null;
      return {
        isPlaying,
        playingIndex: isPlaying ? 0 : null,
        // 练习遍数：真的播起来就算在第一遍，页面据此高亮「正在练第几句」
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
    // 页面现在按页取社区列表。测试里摆数据一律用 `listScores`，
    // 这里委托过去：否则每加一条分页用例就要在两处维护同一份假数据。
    listScoresPage: async (options?: { limit?: number; offset?: number }) => {
      const items = await h.listScores();
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? items.length;
      return { items: items.slice(offset, offset + limit), total: items.length };
    },
    createScore: h.createScore,
    getScore: h.getScore,
    updateScore: h.updateScore,
    deleteScore: h.deleteScore,
    localDeleteScore: h.localDeleteScore,
    localListScores: h.localListScores,
    localGetScore: h.localGetScore,
    listFavoritesPage: h.listFavoritesPage,
    listFavoriteIds: h.listFavoriteIds,
    favoriteScore: h.favoriteScore,
    unfavoriteScore: h.unfavoriteScore,
    reportScore: h.reportScore,
    // 登录态存在时「社区后端」面板会打开即校验会话；本文件只测收藏接线，
    // 这个校验给个恒成功的替身，别让一条无关的请求把用例带崩
    fetchCurrentUser: async () => ({ id: "u-1", email: "qin@you.com", display_name: "我" }),
    loginAccount: vi.fn(),
    registerAccount: vi.fn(),
    logoutAccount: vi.fn(),
    claimScore: vi.fn(),
    selectCandidates: vi.fn(),
    recognizeJianzi: vi.fn(),
    recognizeJianziSheet: vi.fn(),
    scoreStorageMode: () => storeState.storageMode,
    // jsdom 跑在 localhost，与真实判定一致：有后端模式
    isBrowserOnlyMode: () => false,
  };
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
}));

import Home from "@/app/page";
import { ApiError } from "@/lib/api";
import { resetTuningCache } from "@/lib/tuning";
import { createEmptyState } from "@/lib/jianzi";

const EXAMPLE = "沧海一声笑";

function noteColumns(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll("[data-note-column]");
}

/** 加载一首示例曲谱，返回容器。 */
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
  practiceEnd.current = null;
  // 定弦是「偏好 + 曲谱属性」双身份，存在 localStorage 里且有模块级缓存；
  // 不清理的话上一个用例切过的调会漏给下一个用例。
  window.localStorage.clear();
  resetTuningCache();
  // jsdom 没有实现 scrollIntoView，点击音符列会走到这里
  Element.prototype.scrollIntoView = vi.fn();
  h.renderScoreToBuffer.mockResolvedValue({ length: 1024 } as unknown as AudioBuffer);
  h.listScores.mockResolvedValue([]);
  h.localListScores.mockResolvedValue([]);
  h.createScore.mockResolvedValue({ id: "new-id", title: "", notes: [] });
  h.updateScore.mockResolvedValue(undefined);
  h.getScore.mockResolvedValue({ notes: [] });
  storeState.storageMode = "browser";
  // 未保存确认默认放行：既有用例里切换示例/载入曲谱是常规操作，
  // 不该被新增的确认拦住。需要验证「取消」的用例自行 spyOn 覆盖成 false。
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  // 分享链接用例会改写 URL，复位避免 query 串到后续用例
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("Home · 空谱与示例", () => {
  it("空谱时禁用播放、隐藏导出入口", async () => {
    const { container } = render(<Home />);

    expect((screen.getByLabelText("播放") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("导出音频")).toBeNull();
    expect(screen.queryByLabelText("导出图片（PNG）")).toBeNull();
    expect(screen.queryByLabelText("导出文本")).toBeNull();
    expect(container.textContent).toContain("暂无音符");
    // 空态给出两个示例快捷入口（标题去掉「（片段）」）
    expect(screen.getByRole("button", { name: EXAMPLE })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仙翁操" })).toBeTruthy();
  });

  it("加载示例后出现音符列与导出入口", async () => {
    const { container } = await loadExample();

    expect(noteColumns(container).length).toBe(8);
    expect((screen.getByLabelText("播放") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByLabelText("导出音频")).toBeTruthy();
    expect(screen.getByLabelText("导出图片（PNG）")).toBeTruthy();
    expect(screen.getByLabelText("导出矢量图（SVG）")).toBeTruthy();
    expect(screen.getByLabelText("导出文本")).toBeTruthy();
    expect(container.textContent).toContain("沧海一声笑（片段）");
  });
});

describe("Home · 播放与节拍器", () => {
  it("点播放会起播并联动节拍器，再点停止一起收", async () => {
    await loadExample();

    fireEvent.click(screen.getByLabelText("播放"));
    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.toggleMetronome).toHaveBeenCalledTimes(1);

    const stopBtn = await screen.findByLabelText("停止播放");
    fireEvent.click(stopBtn);
    expect(h.stopPlayback).toHaveBeenCalledTimes(1);
    expect(h.stopMetronome).toHaveBeenCalledTimes(1);
  });

  it("取消「播放带节拍」后播放不再启动节拍器", async () => {
    await loadExample();

    fireEvent.click(screen.getByLabelText("播放时联动节拍器"));
    fireEvent.click(screen.getByLabelText("播放"));

    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.toggleMetronome).not.toHaveBeenCalled();
  });

  it("空格键播放/停止，焦点在输入框时交给原生行为", async () => {
    await loadExample();

    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(h.play).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(h.stopPlayback).toHaveBeenCalledTimes(1);

    // 焦点在标题输入框里时，空格应该正常输入而不是切播放
    const titleInput = screen.getByLabelText("曲谱名称");
    fireEvent.keyDown(titleInput, { code: "Space", key: " " });
    expect(h.play).toHaveBeenCalledTimes(1);
  });

  it("节拍器按钮切换运行态，并按拍号画拍点", async () => {
    const { container } = await loadExample();

    fireEvent.click(screen.getByLabelText("启动节拍器"));
    expect(h.toggleMetronome).toHaveBeenCalledTimes(1);

    const dots = () => container.querySelectorAll('[aria-hidden] > span').length;
    expect(dots()).toBe(4); // 默认 4/4

    fireEvent.change(screen.getByLabelText("拍号"), { target: { value: "3" } });
    expect(dots()).toBe(3);

    fireEvent.click(screen.getByLabelText("停止节拍器"));
    // 按钮的 aria-label 会随运行态变化，但 onClick 始终是 toggle（第二次点即停）
    expect(h.toggleMetronome).toHaveBeenCalledTimes(2);
    expect(h.stopMetronome).not.toHaveBeenCalled();
    expect(dots()).toBe(0);
  });

  it("BPM 滑杆改速度只影响显示与后续播放", async () => {
    const { container } = await loadExample();

    fireEvent.change(screen.getByLabelText("播放速度（BPM）"), {
      target: { value: "90" },
    });

    expect(container.textContent).toContain("速度 90 BPM");
    expect(h.play).not.toHaveBeenCalled();
  });
});

describe("Home · 音频导出", () => {
  it("默认带 2 小节预备拍，并按当前速度/拍号/节拍器设置渲染", async () => {
    await loadExample();

    fireEvent.change(screen.getByLabelText("拍号"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("播放速度（BPM）"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByLabelText("导出音频"));

    await waitFor(() => expect(h.renderScoreToBuffer).toHaveBeenCalledTimes(1));
    const [notes, bpm, opts] = h.renderScoreToBuffer.mock.calls[0];
    expect((notes as NoteColumn[]).length).toBe(8);
    expect(bpm).toBe(100);
    expect(opts).toEqual({
      beatsPerBar: 3,
      withMetronome: true,
      leadInBars: 2,
      concertPitch: 440,
      // 定弦随曲谱一起交给渲染层：谱字音高靠它算，导出才和播放一致
      tuning: "zhengdiao",
    });

    await waitFor(() => expect(h.downloadWav).toHaveBeenCalledTimes(1));
    expect(h.downloadWav.mock.calls[0][1]).toBe("沧海一声笑（片段）.wav");
  });

  it("取消「导出音频含预备拍」后 leadInBars 归零", async () => {
    await loadExample();

    fireEvent.click(screen.getByLabelText("导出音频时包含 2 小节预备拍"));
    fireEvent.click(screen.getByLabelText("导出音频"));

    await waitFor(() => expect(h.renderScoreToBuffer).toHaveBeenCalledTimes(1));
    expect(h.renderScoreToBuffer.mock.calls[0][2].leadInBars).toBe(0);
  });

  it("渲染失败时给出可读错误，不下载文件", async () => {
    await loadExample();
    h.renderScoreToBuffer.mockRejectedValue(new Error("OfflineAudioContext 不可用"));

    fireEvent.click(screen.getByLabelText("导出音频"));

    await waitFor(() => {
      expect(screen.getByText("音频导出失败")).toBeTruthy();
    });
    expect(h.downloadWav).not.toHaveBeenCalled();
    // 失败后按钮要恢复可点，不能卡在「导出中…」
    expect((screen.getByLabelText("导出音频") as HTMLButtonElement).disabled).toBe(false);
  });

  it("导出文本走文本下载通道", async () => {
    await loadExample();

    fireEvent.click(screen.getByLabelText("导出文本"));

    expect(h.downloadTextFile).toHaveBeenCalledTimes(1);
    const [text, filename] = h.downloadTextFile.mock.calls[0];
    expect(text).toContain("沧海一声笑");
    expect(filename).toBe("沧海一声笑（片段）.txt");
  });
});

describe("Home · 基准音", () => {
  it("改基准音会同步到导出，点「标准」可恢复 440", async () => {
    await loadExample();
    expect(screen.getByText("基准音 440 Hz")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("基准音（A4 频率 Hz）"), {
      target: { value: "415" },
    });
    expect(screen.getByText("基准音 415 Hz")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("导出音频"));
    await waitFor(() => expect(h.renderScoreToBuffer).toHaveBeenCalledTimes(1));
    expect(h.renderScoreToBuffer.mock.calls[0][2].concertPitch).toBe(415);

    // 恢复标准音高，避免把 415 泄漏给同一文件里的后续用例
    fireEvent.click(screen.getByRole("button", { name: "标准" }));
    expect(screen.getByText("基准音 440 Hz")).toBeTruthy();
  });
});

describe("Home · 保存与加载", () => {
  it("首次保存走 createScore，拿到 id 后再保存走 updateScore", async () => {
    await loadExample();
    const saveBtn = screen.getByLabelText("保存");

    fireEvent.click(saveBtn);
    // 按钮的 aria-label 固定为「保存」，状态体现在可见文案上
    await waitFor(() => expect(saveBtn.textContent).toBe("已保存"));
    expect(h.createScore).toHaveBeenCalledTimes(1);
    expect(h.createScore.mock.calls[0][0]).toBe("沧海一声笑（片段）");
    expect((h.createScore.mock.calls[0][1] as NoteColumn[]).length).toBe(8);

    fireEvent.click(saveBtn);
    await waitFor(() => expect(h.updateScore).toHaveBeenCalledTimes(1));
    expect(h.updateScore.mock.calls[0][0]).toBe("new-id");
  });

  it("首次发布带上本机记住的署名", async () => {
    window.localStorage.setItem("taiyin.author", "张百忍");
    await loadExample();

    fireEvent.click(screen.getByLabelText("保存"));

    await waitFor(() => expect(h.createScore).toHaveBeenCalledTimes(1));
    // 第 4 个参数是署名；空串等价匿名，由 api 层决定不发给后端
    expect(h.createScore.mock.calls[0][3]).toBe("张百忍");
  });

  it("未设置署名时按匿名发布（传空串）", async () => {
    await loadExample();

    fireEvent.click(screen.getByLabelText("保存"));

    await waitFor(() => expect(h.createScore).toHaveBeenCalledTimes(1));
    expect(h.createScore.mock.calls[0][3]).toBe("");
  });

  it("再次保存不覆盖署名（避免编辑他人的谱时改掉作者）", async () => {
    window.localStorage.setItem("taiyin.author", "张百忍");
    await loadExample();

    const saveBtn = screen.getByLabelText("保存");
    fireEvent.click(saveBtn);
    await waitFor(() => expect(saveBtn.textContent).toBe("已保存"));

    fireEvent.click(saveBtn);
    await waitFor(() => expect(h.updateScore).toHaveBeenCalledTimes(1));
    expect(h.updateScore.mock.calls[0][1]).not.toHaveProperty("author");
  });

  it("改别人的社区谱遇 403 时自动另存为新谱，而不是报错", async () => {
    await loadExample();
    const saveBtn = screen.getByLabelText("保存");

    // 第一次：正常创建，拿到 id（模拟「打开别人的谱后已有 id」）
    fireEvent.click(saveBtn);
    await waitFor(() => expect(saveBtn.textContent).toBe("已保存"));

    // 第二次：服务端按所有权凭证拒绝
    h.updateScore.mockRejectedValue(
      new ApiError("这不是你发布到社区的曲谱，无法修改或删除", 403),
    );
    fireEvent.click(saveBtn);

    await waitFor(() => expect(h.createScore).toHaveBeenCalledTimes(2));
    expect(screen.getByText("这不是你发布的曲谱，已另存为新谱")).toBeTruthy();
    // 另存后状态是成功，不是失败
    await waitFor(() => expect(saveBtn.textContent).toBe("已保存"));
  });

  it("保存失败时展示后端错误消息", async () => {
    await loadExample();
    h.createScore.mockRejectedValue(new ApiError("数据库连接失败", 500));

    fireEvent.click(screen.getByLabelText("保存"));

    await waitFor(() => expect(screen.getByText("数据库连接失败")).toBeTruthy());
    expect(screen.getByLabelText("保存").textContent).toBe("保存失败");
  });

  it("加载列表失败时提示检查后端", async () => {
    render(<Home />);
    h.listScores.mockRejectedValue(new Error("ECONNREFUSED"));

    fireEvent.click(screen.getByLabelText("加载曲谱"));

    await waitFor(() =>
      expect(screen.getByText("无法连接到服务器，请确认后端已启动")).toBeTruthy(),
    );
  });

  it("从对话框载入曲谱会替换标题与乐谱", async () => {
    const saved: NoteColumn[] = [
      {
        id: "a",
        jianpuNumber: "5",
        jianpuOctave: "",
        jianpuDot: false,
        duration: "四分",
        jianzi: {
          toneType: "散",
          rhythmMode: null,
          leftFinger: null,
          hui: null,
          fen: null,
          slide: null,
          rightAction: "勹",
          stringNumber: "五",
        },
      },
    ];
    h.listScores.mockResolvedValue([
      { id: "s1", title: "旧曲", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" },
    ]);
    h.getScore.mockResolvedValue({ id: "s1", title: "旧曲", notes: saved, created_at: "", updated_at: "" });

    const { container } = render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    const row = await screen.findByText("旧曲");
    fireEvent.click(row);

    await waitFor(() => expect(noteColumns(container).length).toBe(1));
    expect((screen.getByLabelText("曲谱名称") as HTMLInputElement).value).toBe("旧曲");
  });

  it("保存时把当前定弦一起提交", async () => {
    await loadExample();

    fireEvent.change(screen.getByLabelText("定弦（调式）"), { target: { value: "ruibin" } });
    fireEvent.click(screen.getByLabelText("保存"));

    await waitFor(() => expect(h.createScore).toHaveBeenCalledTimes(1));
    // 第三个参数就是定弦：不随谱走的话，换台机器打开就按正调反推，差半音
    expect(h.createScore.mock.calls[0][2]).toBe("ruibin");
  });

  it("加载蕤宾调的曲谱后定弦跟着切过去", async () => {
    h.listScores.mockResolvedValue([
      {
        id: "s1",
        title: "紧五弦曲",
        tuning: "ruibin",
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-02T00:00:00Z",
      },
    ]);
    h.getScore.mockResolvedValue({
      id: "s1",
      title: "紧五弦曲",
      tuning: "ruibin",
      notes: [],
      created_at: "",
      updated_at: "",
    });

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    fireEvent.click(await screen.findByText("紧五弦曲"));

    await waitFor(() =>
      expect((screen.getByLabelText("定弦（调式）") as HTMLSelectElement).value).toBe("ruibin"),
    );
  });
});

describe("Home · 编辑与删除", () => {
  it("点音符列进入编辑模式，可取消", async () => {
    const { container } = await loadExample();

    fireEvent.click(noteColumns(container)[0]);

    expect(container.textContent).toContain("正在编辑第 1 音 · 确认后更新");
    // 编辑模式下不再显示「简谱转减字」入口，避免误往谱尾追加
    expect(container.textContent).not.toContain("简谱转减字");

    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(container.textContent).not.toContain("正在编辑第 1 音");
  });

  it("点 × 删除该音符", async () => {
    const { container } = await loadExample();
    expect(noteColumns(container).length).toBe(8);

    fireEvent.click(screen.getAllByLabelText("删除此音")[0]);

    expect(noteColumns(container).length).toBe(7);
  });

  it("Cmd/Ctrl+Z 撤销回到上一版乐谱", async () => {
    const { container } = await loadExample();

    // 载入示例会产生两次提交（先换音符、再换标题），所以要撤两步才回到空谱
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await waitFor(() => expect(noteColumns(container).length).toBe(0));
    // 撤销后重做可用
    expect((screen.getByLabelText("重做") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(noteColumns(container).length).toBe(8));
  });
});

describe("Home · AI 识别面板", () => {
  it("展开后可切换单字 / 整页", async () => {
    const { container } = render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: "＋ 用 AI 识别减字图片" }));
    expect(screen.getByText("减字谱单字识别（后端模型）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "整页" }));
    expect(screen.queryByText("减字谱单字识别（后端模型）")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "收起 AI 识别" }));
    expect(container.textContent).toContain("＋ 用 AI 识别减字图片");
  });
});

describe("Home · 导出图片", () => {
  it("PNG / SVG 按钮分别接线到导出函数", async () => {
    await loadExample();

    fireEvent.click(screen.getByLabelText("导出图片（PNG）"));
    expect(h.exportPng).toHaveBeenCalledTimes(1);
    expect(h.exportSvg).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("导出矢量图（SVG）"));
    expect(h.exportSvg).toHaveBeenCalledTimes(1);
    expect(h.exportPng).toHaveBeenCalledTimes(1);
  });
});

describe("Home · 导出 PDF", () => {
  it("点击 PDF 按钮走浏览器打印通道（window.print）", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    await loadExample();

    fireEvent.click(screen.getByLabelText("导出 PDF"));
    expect(printSpy).toHaveBeenCalledTimes(1);

    printSpy.mockRestore();
  });
});

describe("Home · 歌词跳转", () => {
  it("点歌词从该字起播（无音符在播时只起播）", async () => {
    const { container } = render(<Home />);
    fireEvent.change(screen.getByLabelText("加载示例"), {
      target: { value: "huafeihua" },
    });
    await waitFor(() => expect(noteColumns(container).length).toBeGreaterThan(0));

    // 花非花前 10 个是前奏（无歌词），第 11 个起带歌词
    const lyrics = screen.getAllByTitle("点击从此音开始播放");
    expect(lyrics.length).toBeGreaterThan(0);
    fireEvent.click(lyrics[0]);

    expect(h.stopPlayback).toHaveBeenCalledTimes(1);
    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.play.mock.calls[0][0]).toBe(10); // HUAFEI_PRELUDE = 10
  });

  it("节拍器运行中点歌词会重启节拍器以对齐", async () => {
    const { container } = render(<Home />);
    fireEvent.change(screen.getByLabelText("加载示例"), {
      target: { value: "huafeihua" },
    });
    await waitFor(() => expect(noteColumns(container).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByLabelText("启动节拍器"));
    expect(h.toggleMetronome).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByTitle("点击从此音开始播放")[0]);

    expect(h.stopMetronome).toHaveBeenCalledTimes(1);
    expect(h.toggleMetronome).toHaveBeenCalledTimes(2); // 重启
    expect(h.play.mock.calls[0][0]).toBe(10);
  });
});

describe("Home · 简谱转减字", () => {
  const CANDIDATES = JSON.stringify({
    candidates: [
      {
        score: 90,
        note: {
          note_type: "散",
          left_finger: null,
          hui: null,
          right_action: "Gou",
          string_number: 3,
        },
      },
    ],
  });

  it("翻译出候选并选中后，往谱尾追加一列音符", async () => {
    h.translateJianpuToJianzi.mockResolvedValue(CANDIDATES);
    const { container } = render(<Home />);
    expect(noteColumns(container).length).toBe(0);

    fireEvent.change(screen.getByLabelText("简谱数字"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "查音位" }));

    await waitFor(() => expect(h.translateJianpuToJianzi).toHaveBeenCalledTimes(1));
    // 传给 WASM 的载荷带上了数字/八度/调式
    expect(JSON.parse(h.translateJianpuToJianzi.mock.calls[0][0])).toEqual({
      number: 5,
      octave: 0,
      tuning: "zheng",
    });

    // 候选是带字形的卡片，读屏名统一以「录入此音位」结尾
    const [candidate] = await screen.findAllByRole("button", { name: /录入此音位$/ });
    fireEvent.click(candidate);

    await waitFor(() => expect(noteColumns(container).length).toBe(1));
  });

  it("翻译失败时展示错误文案", async () => {
    h.translateJianpuToJianzi.mockRejectedValue(new Error("WASM 未初始化"));
    render(<Home />);

    fireEvent.change(screen.getByLabelText("简谱数字"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "查音位" }));

    await waitFor(() => expect(screen.getByText("WASM 未初始化")).toBeTruthy());
  });
});

describe("Home · 曲谱删除", () => {
  const savedNote: NoteColumn = {
    id: "a",
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: {
      toneType: "散",
      rhythmMode: null,
      leftFinger: null,
      hui: null,
      fen: null,
      slide: null,
      rightAction: "勹",
      stringNumber: "五",
    },
  };

  it("删除需二次确认，取消则不动后端", async () => {
    h.listScores.mockResolvedValue([
      { id: "s1", title: "旧曲", created_at: "", updated_at: "" },
    ]);
    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    const del = await screen.findByTitle("删除");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(del);
    expect(h.deleteScore).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(del);
    await waitFor(() => expect(h.deleteScore).toHaveBeenCalledWith("s1"));
    confirmSpy.mockRestore();
  });

  it("删除当前打开的曲谱后回到空谱并复位标题", async () => {
    h.listScores.mockResolvedValue([
      { id: "s1", title: "旧曲", created_at: "", updated_at: "" },
    ]);
    h.getScore.mockResolvedValue({
      id: "s1",
      title: "旧曲",
      notes: [savedNote],
      created_at: "",
      updated_at: "",
    });
    const { container } = render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    fireEvent.click(await screen.findByText("旧曲"));
    await waitFor(() => expect(noteColumns(container).length).toBe(1));

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    fireEvent.click(await screen.findByTitle("删除"));

    await waitFor(() => expect(noteColumns(container).length).toBe(0));
    expect((screen.getByLabelText("曲谱名称") as HTMLInputElement).value).toBe("未命名曲谱");
    expect((screen.getByLabelText("播放") as HTMLButtonElement).disabled).toBe(true);
  });

  it("删除失败时提示「删除失败」", async () => {
    h.listScores.mockResolvedValue([
      { id: "s1", title: "旧曲", created_at: "", updated_at: "" },
    ]);
    h.deleteScore.mockRejectedValue(new Error("boom"));
    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByTitle("删除"));

    await waitFor(() => expect(screen.getByText("删除失败")).toBeTruthy());
  });
});

describe("Home · 加载失败", () => {
  it("拉取曲谱详情失败时提示「加载失败」且不关掉对话框", async () => {
    h.listScores.mockResolvedValue([
      { id: "s1", title: "旧曲", created_at: "", updated_at: "" },
    ]);
    h.getScore.mockRejectedValue(new Error("boom"));
    const { container } = render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    fireEvent.click(await screen.findByText("旧曲"));

    await waitFor(() => expect(screen.getByText("加载失败")).toBeTruthy());
    expect(noteColumns(container).length).toBe(0);
  });
});

describe("Home · 本机→社区一键迁移", () => {
  const LOCAL_TWO = [
    { id: "l1", title: "平沙落雁", tuning: "zhengdiao" as const, created_at: "", updated_at: "" },
    { id: "l2", title: "潇湘水云", tuning: "ruibin" as const, created_at: "", updated_at: "" },
  ];

  it("server 模式下把本机谱逐个发布到社区", async () => {
    storeState.storageMode = "server";
    // 设置了署名后迁移的谱应挂上署名（迁移 = 一次性发布多首）
    window.localStorage.setItem("taiyin.author", "张百忍");
    h.listScores.mockResolvedValue([]);
    h.localListScores.mockResolvedValue(LOCAL_TWO);
    h.localGetScore.mockImplementation(async (id: string) => {
      const item = LOCAL_TWO.find((s) => s.id === id) ?? LOCAL_TWO[0];
      return { ...item, notes: [] };
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    fireEvent.click(await screen.findByRole("button", { name: /本机/ }));
    fireEvent.click(screen.getByLabelText("一键发布本机谱到社区"));

    await waitFor(() => expect(h.createScore).toHaveBeenCalledTimes(2));
    expect(confirmSpy).toHaveBeenCalled();
    expect(h.createScore.mock.calls.map((c) => c[0])).toEqual(["平沙落雁", "潇湘水云"]);
    expect(h.createScore.mock.calls.map((c) => c[3])).toEqual(["张百忍", "张百忍"]);
    confirmSpy.mockRestore();
  });

  it("社区已有同名谱时跳过，不重复发布", async () => {
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([
      { id: "c1", title: "平沙落雁", tuning: "zhengdiao" as const, created_at: "", updated_at: "" },
    ]);
    h.localListScores.mockResolvedValue(LOCAL_TWO);
    h.localGetScore.mockResolvedValue({ ...LOCAL_TWO[1], notes: [] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    fireEvent.click(await screen.findByRole("button", { name: /本机/ }));
    fireEvent.click(screen.getByLabelText("一键发布本机谱到社区"));

    await waitFor(() => expect(h.createScore).toHaveBeenCalledTimes(1));
    expect(h.createScore.mock.calls[0][0]).toBe("潇湘水云");
    confirmSpy.mockRestore();
  });

  it("取消确认时不发起任何发布", async () => {
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([]);
    h.localListScores.mockResolvedValue(LOCAL_TWO);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    fireEvent.click(await screen.findByRole("button", { name: /本机/ }));
    fireEvent.click(screen.getByLabelText("一键发布本机谱到社区"));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(h.createScore).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("Home · 曲谱分享链接", () => {
  const SHARED = {
    id: "abc",
    title: "平沙落雁",
    tuning: "zhengdiao" as const,
    notes: [],
    created_at: "",
    updated_at: "",
  };

  it("URL 带 ?score= 时自动加载该社区谱，并出现分享按钮", async () => {
    storeState.storageMode = "server";
    window.history.replaceState({}, "", "/?score=abc");
    h.getScore.mockResolvedValue(SHARED);

    render(<Home />);

    await waitFor(() => expect(h.getScore).toHaveBeenCalledWith("abc"));
    await waitFor(() =>
      expect((screen.getByLabelText("曲谱名称") as HTMLInputElement).value).toBe("平沙落雁"),
    );
    // 加载后记下服务器 id，分享按钮随之出现
    expect(await screen.findByLabelText("复制分享链接")).toBeTruthy();
  });

  it("分享链接打开时亮出打谱人署名", async () => {
    storeState.storageMode = "server";
    window.history.replaceState({}, "", "/?score=abc");
    h.getScore.mockResolvedValue({ ...SHARED, author: "张百忍" });

    render(<Home />);

    await waitFor(() => expect(screen.getByText("已载入 张百忍 的《平沙落雁》")).toBeTruthy());
  });

  it("点分享按钮把含 ?score= 的链接写入剪贴板", async () => {
    storeState.storageMode = "server";
    window.history.replaceState({}, "", "/?score=abc");
    h.getScore.mockResolvedValue(SHARED);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<Home />);
    fireEvent.click(await screen.findByLabelText("复制分享链接"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("score=abc");
    await waitFor(() => expect(screen.getByText("分享链接已复制")).toBeTruthy());
  });

  it("分享的曲谱不存在时给出提示", async () => {
    storeState.storageMode = "server";
    window.history.replaceState({}, "", "/?score=gone");
    h.getScore.mockRejectedValue(new Error("not found"));

    render(<Home />);

    await waitFor(() => expect(screen.getByText("分享的曲谱不存在或已删除")).toBeTruthy());
  });
});

/**
 * 所有权：发布到社区后仍要能撤回自己的谱，但不能删别人的。
 * 这一层靠「本机记录 + 服务端凭证」双保险，本地记录被伪造也删不动别人的谱。
 */
describe("Home · 我发布的社区谱可删", () => {
  const MINE = {
    id: "mine-1",
    title: "我的平沙",
    tuning: "zhengdiao" as const,
    created_at: "",
    updated_at: "",
  };
  const OTHERS = {
    id: "others-1",
    title: "别人的流水",
    tuning: "zhengdiao" as const,
    created_at: "",
    updated_at: "",
  };

  it("社区 tab 里自己的谱显示删除按钮，删除走服务器接口", async () => {
    storeState.storageMode = "server";
    window.localStorage.setItem("taiyin.myScoreIds", JSON.stringify([MINE.id]));
    h.listScores.mockResolvedValue([MINE, OTHERS]);
    h.localListScores.mockResolvedValue([]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("我的平沙");

    // 只有自己的谱有删除按钮（别人的谱只读）
    const deleteButtons = container.querySelectorAll('[title="删除"]');
    expect(deleteButtons).toHaveLength(1);

    fireEvent.click(deleteButtons[0]);
    await waitFor(() => expect(h.deleteScore).toHaveBeenCalledWith(MINE.id));
    expect(h.localDeleteScore).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("本机谱走本地删除，不会把本地 id 发到服务器", async () => {
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([]);
    h.localListScores.mockResolvedValue([
      {
        id: "local-1",
        title: "本地草稿",
        tuning: "zhengdiao" as const,
        created_at: "",
        updated_at: "",
      },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    // 社区 tab 是默认首个 tab，本机谱要切过去才看得到
    fireEvent.click(await screen.findByRole("button", { name: /本机/ }));
    await screen.findByText("本地草稿");

    const btn = container.querySelector('[title="删除"]');
    expect(btn).not.toBeNull();
    fireEvent.click(btn as Element);

    await waitFor(() => expect(h.localDeleteScore).toHaveBeenCalledWith("local-1"));
    expect(h.deleteScore).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("Home · 未保存保护", () => {
  /** 改标题即算「有未保存修改」——标题也是随谱保存的一部分。 */
  function makeDirty() {
    fireEvent.change(screen.getByLabelText("曲谱名称"), {
      target: { value: "我正在录的谱" },
    });
  }

  it("有未保存修改时切换示例先确认；取消则原谱不动", async () => {
    const { container } = await loadExample();
    const before = noteColumns(container).length;
    makeDirty();
    // 改动要在界面上可见，而不是只在关闭时才弹一次
    expect(screen.getByLabelText("有未保存的修改")).toBeTruthy();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.change(screen.getByLabelText("加载示例"), {
      target: { value: "xianwencao" },
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(noteColumns(container).length).toBe(before);
    expect((screen.getByLabelText("曲谱名称") as HTMLInputElement).value).toBe("我正在录的谱");
  });

  it("没有未保存修改时不打扰", async () => {
    await loadExample();
    const confirmSpy = vi.spyOn(window, "confirm");
    fireEvent.change(screen.getByLabelText("加载示例"), {
      target: { value: "xianwencao" },
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("确认切换后基线跟着更新，再切一次不再重复打扰", async () => {
    await loadExample();
    makeDirty();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.change(screen.getByLabelText("加载示例"), {
      target: { value: "xianwencao" },
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.mockClear();
    fireEvent.change(screen.getByLabelText("加载示例"), {
      target: { value: "huafeihua" },
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("有未保存修改时，刷新/关页会被拦下", async () => {
    await loadExample();
    makeDirty();

    const evt = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("没有改动时不拦刷新（否则每个访客都被弹窗骚扰）", async () => {
    await loadExample();
    const evt = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });

  it("保存成功后不再拦页", async () => {
    await loadExample();
    makeDirty();

    fireEvent.click(screen.getByLabelText("保存"));
    await waitFor(() => expect(h.createScore).toHaveBeenCalled());

    // 保存成功 → 基线随 state 提交更新、beforeunload 监听被摘掉。
    // 这里用 waitFor 重试，避免在 React 提交前一帧就断言。
    await waitFor(() => {
      const evt = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(false);
    });
  });
});

describe("Home · 自动草稿", () => {
  const DRAFT_KEY = "taiyin.draft.v1";

  function makeDraftNote(id: string): NoteColumn {
    return {
      id,
      jianpuNumber: "5",
      jianpuOctave: "",
      jianpuDot: false,
      duration: "四分",
      jianzi: createEmptyState(),
    };
  }

  function seedDraft(overrides: Record<string, unknown> = {}) {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        title: "昨夜录的谱",
        notes: [makeDraftNote("d1"), makeDraftNote("d2")],
        tuning: "zhengdiao",
        scoreId: null,
        updatedAt: Date.now() - 5 * 60_000,
        ...overrides,
      }),
    );
  }

  it("有草稿且编辑区为空时提示恢复，并说清有几个音、多久之前", async () => {
    seedDraft();
    const { container } = render(<Home />);

    expect(await screen.findByRole("button", { name: "恢复" })).toBeTruthy();
    // 文案被拆在多个文本节点里，用整页文本断言比 getByText 稳
    expect(container.textContent).toContain("昨夜录的谱");
    expect(container.textContent).toContain("2 个音");
    expect(container.textContent).toContain("分钟前");
  });

  it("点「恢复」把草稿内容载入编辑区，并还原来源谱 id", async () => {
    seedDraft({ scoreId: "srv-1" });
    const { container } = render(<Home />);

    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));

    await waitFor(() => expect(noteColumns(container).length).toBe(2));
    expect((screen.getByLabelText("曲谱名称") as HTMLInputElement).value).toBe("昨夜录的谱");
    // 草稿本来就没存进库，恢复后仍应显示「未保存」
    expect(screen.getByLabelText("有未保存的修改")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "恢复" })).toBeNull();
  });

  it("点「丢弃」清掉 localStorage 里的草稿，提示随之消失", async () => {
    seedDraft();
    render(<Home />);

    fireEvent.click(await screen.findByRole("button", { name: "丢弃" }));

    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复" })).toBeNull();
  });

  it("分享直达（?score=）时不弹草稿提示，避免两份内容打架", async () => {
    window.history.replaceState({}, "", "/?score=s1");
    seedDraft();
    h.getScore.mockResolvedValue({
      id: "s1",
      title: "社区谱",
      notes: [],
      tuning: "zhengdiao",
      author: "",
    });

    render(<Home />);
    await waitFor(() => expect(h.getScore).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "恢复" })).toBeNull();
  });

  it("编辑后会把草稿写进 localStorage（这才是刷新能救回来的原因）", async () => {
    await loadExample();
    fireEvent.change(screen.getByLabelText("曲谱名称"), {
      target: { value: "待存稿" },
    });

    await waitFor(
      () => {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw as string).title).toBe("待存稿");
      },
      { timeout: 3000 },
    );
  });

  it("保存成功后清掉草稿，不再提示恢复", async () => {
    seedDraft();
    const { container } = render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
    await waitFor(() => expect(noteColumns(container).length).toBe(2));

    fireEvent.click(screen.getByLabelText("保存"));
    await waitFor(() => expect(h.createScore).toHaveBeenCalled());

    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("Home · 收藏（跟账号走）", () => {
  const SESSION = { token: "tok-fav", user: { id: "u-1", email: "qin@you.com", display_name: "我" } };

  it("登录且收过谱：默认落在「我的收藏」，点星即取消并从列表消失", async () => {
    const auth = await import("@/lib/auth");
    auth.setStoredSession(SESSION);
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([
      { id: "c1", title: "广陵散", tuning: "zhengdiao", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ]);
    h.listFavoritesPage.mockResolvedValue({
      items: [
        { id: "f1", title: "平沙落雁", tuning: "zhengdiao", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      ],
      total: 1,
    });
    h.listFavoriteIds.mockResolvedValue(["f1"]);
    h.unfavoriteScore.mockResolvedValue(undefined);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    // 收藏 tab 排在最前，且默认激活：收藏的用途就是「少翻两页」
    expect(await screen.findByText("平沙落雁")).toBeTruthy();
    expect(screen.getByRole("button", { name: /我的收藏/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "取消收藏「平沙落雁」" }));

    await waitFor(() => expect(h.unfavoriteScore).toHaveBeenCalledWith("f1"));
    // 取消后这一行要立刻消失：留在原地会让人以为没生效，再点一次
    await waitFor(() => expect(screen.queryByText("平沙落雁")).toBeNull());
  });

  it("登录但还没收过谱：不摆一个空的「我的收藏」tab", async () => {
    const auth = await import("@/lib/auth");
    auth.setStoredSession(SESSION);
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([
      { id: "c1", title: "广陵散", tuning: "zhengdiao", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ]);
    h.listFavoritesPage.mockResolvedValue({ items: [], total: 0 });
    h.listFavoriteIds.mockResolvedValue([]);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    await screen.findByText("广陵散");
    // 一打开就落在空列表上，比没有这个 tab 更让人困惑
    expect(screen.queryByRole("button", { name: /我的收藏/ })).toBeNull();
  });

  it("未登录：不请求收藏接口，也不画星标（画了点了必然 401）", async () => {
    // 必须显式登出：auth 除了 localStorage 还有一份内存缓存，
    // 上个用例 setStoredSession 留下的会话不会因为清 localStorage 就消失
    const auth = await import("@/lib/auth");
    auth.clearStoredSession();
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([
      { id: "c1", title: "广陵散", tuning: "zhengdiao", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ]);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    await screen.findByText("广陵散");
    expect(h.listFavoritesPage).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /收藏「/ })).toBeNull();
  });

  it("收藏接口挂了也不影响打开曲谱列表（附加能力不能拖垮主流程）", async () => {
    const auth = await import("@/lib/auth");
    auth.setStoredSession(SESSION);
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([
      { id: "c1", title: "广陵散", tuning: "zhengdiao", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ]);
    h.listFavoritesPage.mockRejectedValue(new Error("favorites down"));

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    expect(await screen.findByText("广陵散")).toBeTruthy();
  });
});

describe("Home · 收藏翻页", () => {
  it("收藏多于一页时「加载更多」按 offset 续取，且不重复渲染", async () => {
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "tok-page", user: { id: "u-1", email: "qin@you.com", display_name: "我" } });
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([]);
    h.listFavoritesPage
      .mockResolvedValueOnce({
        items: [
          { id: "f1", title: "平沙落雁", tuning: "zhengdiao", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [
          { id: "f2", title: "潇湘水云", tuning: "zhengdiao", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
        ],
        total: 2,
      });
    h.listFavoriteIds.mockResolvedValue(["f1", "f2"]);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    await screen.findByText("平沙落雁");
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    await waitFor(() =>
      expect(h.listFavoritesPage).toHaveBeenLastCalledWith({ limit: 50, offset: 1 }),
    );
    expect(await screen.findByText("潇湘水云")).toBeTruthy();
    // 第一页那条还在，没被整页替换掉
    expect(screen.getByText("平沙落雁")).toBeTruthy();
  });
});

describe("Home · 社区翻页（回归：按钮点了没反应）", () => {
  /**
   * 曾经的 bug：`openLoadDialog` 把 `onLoadMore` 写进 tab 对象时，回调闭包捕获的是
   * 那一次渲染的 `loadTabs`（还是空的），于是点「加载更多」会 `find` 不到 tab、
   * 直接 return——表现就是按钮点了毫无反应，而且只有谱多到要翻页时才暴露。
   */
  it("第二页的谱能通过「加载更多」取回来", async () => {
    storeState.storageMode = "server";
    const all = Array.from({ length: 51 }, (_, i) => ({
      id: `c${i}`,
      title: `社区谱${i}`,
      tuning: "zhengdiao",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
    }));
    h.listScores.mockResolvedValue(all);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));

    await screen.findByText("社区谱0");
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    expect(await screen.findByText("社区谱50")).toBeTruthy();
  });
});

describe("Home · 举报（只记录，不当场下架）", () => {
  const SESSION = { token: "tok-rep", user: { id: "u-1", email: "qin@you.com", display_name: "我" } };

  /** 登录 + 社区里有一首别人的谱，打开列表等它就位。 */
  async function openCommunity() {
    const auth = await import("@/lib/auth");
    auth.setStoredSession(SESSION);
    storeState.storageMode = "server";
    h.listScores.mockResolvedValue([
      {
        id: "c1",
        title: "广陵散",
        tuning: "zhengdiao",
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      },
    ]);
    h.listFavoritesPage.mockResolvedValue({ items: [], total: 0 });
    h.listFavoriteIds.mockResolvedValue([]);

    render(<Home />);
    fireEvent.click(screen.getByLabelText("加载曲谱"));
    await screen.findByText("广陵散");
  }

  it("点旗标 → 确认后提交，并如实说「当前 N 人举报」", async () => {
    h.reportScore.mockResolvedValue({ reported: true, reports_count: 2 });
    await openCommunity();

    fireEvent.click(screen.getByRole("button", { name: /举报「广陵散」/ }));

    await waitFor(() => expect(h.reportScore).toHaveBeenCalledWith("c1"));
    // 文案不能承诺「已处理」：下架要管理员看过后手动做
    expect(await screen.findByText(/已收到举报/)).toBeTruthy();
    expect(screen.getByText(/2 人举报/)).toBeTruthy();
  });

  it("重复举报：说清楚「之前已经报过」，而不是假装又记了一次", async () => {
    h.reportScore.mockResolvedValue({ reported: false, reports_count: 2 });
    await openCommunity();

    fireEvent.click(screen.getByRole("button", { name: /举报「广陵散」/ }));

    expect(await screen.findByText(/之前已经举报过/)).toBeTruthy();
  });

  it("确认框里点取消就不发请求（举报是公开动作，别误触）", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await openCommunity();

    fireEvent.click(screen.getByRole("button", { name: /举报「广陵散」/ }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(h.reportScore).not.toHaveBeenCalled();
  });

  it("接口失败时把服务端原话显示出来，不吞成「举报失败」", async () => {
    const api = await import("@/lib/api");
    h.reportScore.mockRejectedValue(new api.ApiError("举报需要登录：匿名举报无法去重", 401));
    await openCommunity();

    fireEvent.click(screen.getByRole("button", { name: /举报「广陵散」/ }));

    expect(await screen.findByText(/举报需要登录/)).toBeTruthy();
  });
});

describe("Home · 逐句慢练", () => {
  it("点某一句：只播这一句、连弹三遍、按当前倍速", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    fireEvent.click(await screen.findByLabelText("慢练第 2 句"));

    // 先停再播：重叠播放会让两遍的余音搅在一起
    expect(h.stopPlayback).toHaveBeenCalled();
    expect(h.play).toHaveBeenCalledWith(4, {
      endIndex: 7,
      repeat: 3,
      tempo: 0.6,
    });
  });

  it("慢练先停节拍器——它按原速走，留着只会把人往原速上带", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    fireEvent.click(screen.getByLabelText("启动节拍器"));
    fireEvent.click(await screen.findByLabelText("慢练第 1 句"));

    expect(h.stopMetronome).toHaveBeenCalled();
  });

  it("只有一句的曲子不显示分句条——一排只有一个按钮会让人以为坏了", async () => {
    h.splitPhrases.mockResolvedValue([{ start: 0, end: 999 }]);
    await loadExample();

    await waitFor(() => expect(h.splitPhrases).toHaveBeenCalled());
    expect(screen.queryByText("分句")).toBeNull();
  });

  it("正在练的那一句再点一下就停", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    fireEvent.click(await screen.findByLabelText("慢练第 2 句"));
    fireEvent.click(await screen.findByLabelText("停止慢练第 2 句"));

    expect(h.stopPlayback).toHaveBeenCalledTimes(2);
    // 第二次只是停止，不该再起一遍
    expect(h.play).toHaveBeenCalledTimes(1);
  });

  it("三遍真的走完才记账，并在句子上标「已过原速」", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    // 直接选原速：过关判定看的是「在 1× 下标完整走完三遍」
    fireEvent.click(await screen.findByLabelText("慢练倍速 1×"));
    fireEvent.click(await screen.findByLabelText("慢练第 2 句"));
    act(() => practiceEnd.current?.());

    // 第二句 start 4 / end 7 / 4 个位置 → 键 4-7-4
    const stored = Object.keys(window.localStorage)
      .filter((k) => k.startsWith("taiyin.practiceProgress.v1:"))
      .map((k) => window.localStorage.getItem(k))
      .join("");
    expect(stored).toContain('"4-7-4":1');

    expect(await screen.findByLabelText("慢练第 2 句 · 已过原速")).toBeTruthy();
    expect(screen.getByText("已过 1/2")).toBeTruthy();
  });

  it("同一档练第二遍不再写一次——重复的写只会让存储白白多一次抖动", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    const practiceOnce = async () => {
      fireEvent.click(await screen.findByLabelText(/^慢练第 2 句/));
      act(() => practiceEnd.current?.());
      await waitFor(() => expect(practiceEnd.current).not.toBeNull());
    };

    await practiceOnce();
    const key = Object.keys(window.localStorage).find((k) =>
      k.startsWith("taiyin.practiceProgress.v1:"),
    );
    expect(key).toBeTruthy();
    const first = window.localStorage.getItem(key as string);

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await practiceOnce();
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(key as string)).toBe(first);
    setItem.mockRestore();
  });

  it("合练：跨过气口把两句连着走，档位取两句里更慢的那句", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    // 先把第 1 句练到 0.8×（合练只对练过的句子开放）
    fireEvent.click(await screen.findByLabelText("慢练倍速 0.8×"));
    fireEvent.click(screen.getByLabelText("慢练第 1 句"));
    act(() => practiceEnd.current?.());
    h.play.mockClear();

    fireEvent.click(await screen.findByLabelText("连弹第 1+2 句"));

    // 第 2 句还没练过 → 按手选档位；区间从第 1 句起点一直排到第 2 句终点
    expect(h.play).toHaveBeenCalledWith(0, {
      endIndex: 7,
      repeat: 2,
      tempo: 0.8,
    });
    // 两句都在响，状态行要说两句——只报头一句，用户会以为后一句没放出来
    expect(
      await screen.findByText("第 1+2 句 · 8 个位置 · 0.8× · 第 1/2 遍"),
    ).toBeTruthy();
  });

  it("合练走完不记账——跨了两句，成绩记到哪一句上都是谎话", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    // 第 1 句练到 0.6×
    fireEvent.click(await screen.findByLabelText("慢练第 1 句"));
    act(() => practiceEnd.current?.());
    // 手边把档位拨到 0.9×（还没练），合练仍按两句里更慢的那句走 → 0.6×
    fireEvent.click(screen.getByLabelText("慢练倍速 0.9×"));
    h.play.mockClear();

    fireEvent.click(await screen.findByLabelText("连弹第 1+2 句"));
    expect(h.play).toHaveBeenCalledWith(0, {
      endIndex: 7,
      repeat: 2,
      tempo: 0.6,
    });
    act(() => practiceEnd.current?.());

    const stored = Object.keys(window.localStorage)
      .filter((k) => k.startsWith("taiyin.practiceProgress.v1:"))
      .map((k) => window.localStorage.getItem(k))
      .join("");
    // 第 1 句仍是单句练出来的 0.6×，没被合练改写成手边的 0.9×
    expect(stored).toContain('"0-3-4":0.6');
    expect(stored).not.toContain("0.9");
    // 第 2 句从未单独走完，不能因为合练过就算练过
    expect(stored).not.toContain('"4-7-4"');
  });

  it("练到一半把档位拨高，走完记的仍是实际那一档", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    fireEvent.click(await screen.findByLabelText("慢练第 2 句"));
    // 正在练的时候拨到 1×：这一遍不会重新排程，跑的还是 0.6×
    fireEvent.click(screen.getByLabelText("慢练倍速 1×"));
    act(() => practiceEnd.current?.());

    const stored = Object.keys(window.localStorage)
      .filter((k) => k.startsWith("taiyin.practiceProgress.v1:"))
      .map((k) => window.localStorage.getItem(k))
      .join("");
    expect(stored).toContain('"4-7-4":0.6');
    // 拨一下就算过关，那根朱砂横线就成了谎话
    expect(screen.queryByLabelText("慢练第 2 句 · 已过原速")).toBeNull();
  });

  it("中途按停不算练过——没走完的三遍不能算成绩", async () => {
    h.splitPhrases.mockResolvedValue([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    await loadExample();

    fireEvent.click(await screen.findByLabelText("慢练倍速 1×"));
    fireEvent.click(await screen.findByLabelText("慢练第 2 句"));
    fireEvent.click(await screen.findByLabelText("停止慢练第 2 句"));

    expect(
      Object.keys(window.localStorage).filter((k) =>
        k.startsWith("taiyin.practiceProgress.v1:"),
      ),
    ).toEqual([]);
    expect(screen.queryByLabelText("慢练第 2 句 · 已过原速")).toBeNull();
  });
});
