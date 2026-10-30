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
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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
  getScore: vi.fn(),
  deleteScore: vi.fn(),
  exportPng: vi.fn(),
  exportSvg: vi.fn(),
  translateJianpuToJianzi: vi.fn(),
}));

/** 播放 hook：用真实 useState 撑起 isPlaying，让按钮文案能跟着变。 */
vi.mock("@/lib/use-score-player", async () => {
  const React = await import("react");
  return {
    useScorePlayer: () => {
      const [isPlaying, setPlaying] = React.useState(false);
      return {
        isPlaying,
        playingIndex: isPlaying ? 0 : null,
        play: (index?: number) => {
          h.play(index);
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
    createScore: h.createScore,
    getScore: h.getScore,
    updateScore: h.updateScore,
    deleteScore: h.deleteScore,
    selectCandidates: vi.fn(),
    recognizeJianzi: vi.fn(),
    recognizeJianziSheet: vi.fn(),
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
}));

import Home from "@/app/page";
import { ApiError } from "@/lib/api";

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
  // jsdom 没有实现 scrollIntoView，点击音符列会走到这里
  Element.prototype.scrollIntoView = vi.fn();
  h.renderScoreToBuffer.mockResolvedValue({ length: 1024 } as unknown as AudioBuffer);
  h.listScores.mockResolvedValue([]);
  h.createScore.mockResolvedValue({ id: "new-id", title: "", notes: [] });
  h.updateScore.mockResolvedValue(undefined);
  h.getScore.mockResolvedValue({ notes: [] });
});

afterEach(() => {
  cleanup();
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
    expect(opts).toEqual({ beatsPerBar: 3, withMetronome: true, leadInBars: 2 });

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
    expect(screen.getByText("减字谱单字识别（AI 图像识别）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "整页" }));
    expect(screen.queryByText("减字谱单字识别（AI 图像识别）")).toBeNull();

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
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));

    await waitFor(() => expect(h.translateJianpuToJianzi).toHaveBeenCalledTimes(1));
    // 传给 WASM 的载荷带上了数字/八度/调式
    expect(JSON.parse(h.translateJianpuToJianzi.mock.calls[0][0])).toEqual({
      number: 5,
      octave: 0,
      tuning: "zheng",
    });

    const candidate = await screen.findByTitle("评分: 90");
    fireEvent.click(candidate);

    await waitFor(() => expect(noteColumns(container).length).toBe(1));
  });

  it("翻译失败时展示错误文案", async () => {
    h.translateJianpuToJianzi.mockRejectedValue(new Error("WASM 未初始化"));
    render(<Home />);

    fireEvent.change(screen.getByLabelText("简谱数字"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));

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
