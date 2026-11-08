/**
 * @vitest-environment jsdom
 */
/**
 * 跟弹面板：只在「能明确说出发生了什么」的路径上做断言。
 *
 * 判定算法本身在 `lib/__tests__/play-along.test.ts` 里逐条钉过了；这里把
 * play-along 整个 mock 掉（judgeTake 的结果由用例给定），只验面板这一层的
 * 契约：① 不该出声的东西有没有被停掉（这决定了分数是不是真的）、② 出错时
 * 有没有说人话、③ 结果面板讲没讲清楚「错在哪」、④ 记档按钮给没给对、
 * ⑤ 中途叫停有没有真把麦克风关掉。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FollowPlayPanel } from "../follow-play-panel";
import {
  expectedFromSchedule,
  judgeTake,
  segmentNotes,
  type ExpectedNote,
  type JudgeResult,
  type JudgedNote,
} from "@/lib/play-along";
import { detectPitch } from "@/lib/pitch-detect";
import { scheduleClick } from "@/lib/audio-synth";
import { PRACTICE_COUNT_IN_BEATS } from "@/lib/use-score-player";
import type { NoteColumn } from "@/lib/types";
import type { ScorePhrase } from "@/lib/score-phrases";

vi.mock("@/lib/audio-synth", () => ({ scheduleClick: vi.fn() }));
vi.mock("@/lib/pitch-detect", () => ({ detectPitch: vi.fn() }));
vi.mock("@/lib/play-along", () => ({
  expectedFromSchedule: vi.fn(),
  judgeTake: vi.fn(),
  segmentNotes: vi.fn(),
}));

const phrase: ScorePhrase = { start: 0, end: 2, noteCount: 3, beats: 3 };

function makeNote(freq: string): NoteColumn {
  return {
    id: Math.random().toString(36).slice(2),
    jianpuNumber: "1",
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
      rightAction: "勾",
      stringNumber: freq,
    },
  } as NoteColumn;
}

const notes: NoteColumn[] = [makeNote("1"), makeNote("2"), makeNote("3")];

function panel(overrides: Record<string, unknown> = {}) {
  return (
    <FollowPlayPanel
      notes={notes}
      phrase={phrase}
      bpm={120}
      tempo={0.6}
      concertPitch={440}
      tuning="zhengdiao"
      {...overrides}
    />
  );
}

// —— 判定结果的固定件：算法在 play-along.test.ts 里钉，这里只当输入用 ——

function exp(index: number, start: number): ExpectedNote {
  return { index, start, duration: 0.5, freq: 440, slide: false };
}

function judged(
  expected: ExpectedNote,
  over: Partial<JudgedNote> = {},
): JudgedNote {
  return {
    expected,
    detected: { start: expected.start, freq: 440, duration: 0.5 },
    cents: 0,
    onsetOffset: 0,
    verdict: "ok",
    ...over,
  };
}

/** 4 个期望音：2 个全对、1 个按错位置、1 个偏高、1 个漏弹。 */
const EXPECTED = [exp(0, 0), exp(1, 0.5), exp(2, 1.0), exp(3, 1.5)];

const PASS_RESULT: JudgeResult = {
  notes: [
    judged(EXPECTED[0]),
    judged(EXPECTED[1], {
      verdict: "wrong",
      cents: 2400,
      detected: { start: 0.5, freq: 200, duration: 0.4 },
    }),
    judged(EXPECTED[2], {
      verdict: "sharp",
      cents: 32.6,
      detected: { start: 1.0, freq: 445, duration: 0.5 },
    }),
    judged(EXPECTED[3], { verdict: "missed", cents: null, detected: null }),
  ],
  matched: 3,
  missed: 1,
  extra: 0,
  pitchOkRatio: 0.8,
  offset: 0.02,
  passed: true,
  summary: "3 音弹准，1 音漏了——整体稳。",
};

const FAIL_RESULT: JudgeResult = {
  ...PASS_RESULT,
  notes: [
    judged(EXPECTED[0], { verdict: "missed", cents: null, detected: null }),
    judged(EXPECTED[1], { verdict: "missed", cents: null, detected: null }),
    judged(EXPECTED[2]),
    judged(EXPECTED[3]),
  ],
  matched: 2,
  missed: 2,
  pitchOkRatio: 0.5,
  passed: false,
  summary: "漏了 2 音，多半是没记住弦位——再来一遍。",
};

// —— 麦克风与 Web Audio 的假件 ——

const trackStop = vi.fn();

class FakeCtx {
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = "running";
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: vi.fn(),
    };
  }
}

function stubMic() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: trackStop }],
      }),
    },
  });
  vi.stubGlobal("AudioContext", FakeCtx);
}

/** start() 里有两层 await（getUserMedia、resume），多flush几轮。 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 走完预备拍 + 全句 + 尾音，比组件的 finish 计时器（约 4s）留足余量。 */
function runToResult() {
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
}

beforeEach(() => {
  trackStop.mockClear();
  vi.mocked(detectPitch).mockReturnValue({
    freq: 440,
    clarity: 1,
    rms: 0.2,
  });
  // 非空谱给 4 个期望音；空谱必须给空（「没有可判定的音」那条用例靠它）
  vi.mocked(expectedFromSchedule).mockImplementation((schedule) =>
    schedule.length > 0 ? EXPECTED : [],
  );
  vi.mocked(segmentNotes).mockReturnValue([]);
  vi.mocked(judgeTake).mockReturnValue(PASS_RESULT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FollowPlayPanel", () => {
  it("没选句时不出现——谱面上没有「这一句」这回事，面板摆出来只会让人困惑", () => {
    const { container } = render(panel({ phrase: undefined }));
    expect(container.textContent).toBe("");
  });

  it("说明白「不放参考音」，否则用户会以为按钮坏了", () => {
    render(panel());
    expect(screen.getByText(/不放参考音/)).toBeInTheDocument();
  });

  it("开始前先要求停掉播放与节拍器（否则会把自己放的谱子当成你弹的）", async () => {
    const onBeforeStart = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    render(panel({ onBeforeStart }));
    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    expect(onBeforeStart).toHaveBeenCalled();
    // 没麦克风也不该崩，要给提示
    expect(await screen.findByText(/不支持麦克风采集/)).toBeInTheDocument();
  });

  it("权限被拒时说清楚去开权限", async () => {
    // jsdom 没有 AudioContext；面板会先查它再要权限（缺 Web Audio 就别去弹授权框），
    // 所以这里补一个占位构造器，让流程走到 getUserMedia 那一步
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class {},
    });
    const denied = new Error("denied");
    denied.name = "NotAllowedError";
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(denied) },
    });
    render(panel());
    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    expect(await screen.findByText(/麦克风权限被拒绝/)).toBeInTheDocument();
  });

  it("这一句没有可判定的音时明确说没法判，而不是判成零分", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    });
    render(panel({ notes: [] }));
    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    expect(await screen.findByText(/没有标简谱的音/)).toBeInTheDocument();
  });

  it("浏览器没有 Web Audio 时说清楚，而不是去弹麦克风授权框", async () => {
    // 显式删掉 AudioContext（含 webkit 变体），让流程停在能力检查
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: undefined,
    });
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    render(panel());
    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    expect(await screen.findByText(/不支持 Web Audio/)).toBeInTheDocument();
    // 能力都不够，不该先吓人一跳去要权限
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("没找到麦克风设备时把这句话说出来", async () => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class {},
    });
    const missing = new Error("missing device");
    missing.name = "NotFoundError";
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(missing) },
    });
    render(panel());
    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    expect(await screen.findByText(/没有找到麦克风设备/)).toBeInTheDocument();
  });

  it("完整走一遍：结果面板讲清楚错在哪，漏弹的不在错误清单里凑数", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    stubMic();
    const onHighlight = vi.fn();
    render(panel({ onHighlight }));

    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    await flush();
    // 预备拍：只给拍子不给参考音，拍数与慢练同一个常量
    expect(scheduleClick).toHaveBeenCalledTimes(PRACTICE_COUNT_IN_BEATS);

    runToResult();

    // 高亮从第 1 音开始逐个点亮（定时器挂在起手时刻之后）
    expect(onHighlight.mock.calls.map((c) => c[0])).toContain(0);

    const box = screen.getByTestId("judge-result");
    expect(box).toBeInTheDocument();
    expect(screen.getByText("3 音弹准，1 音漏了——整体稳。")).toBeInTheDocument();
    // 按错位置要点名到音
    expect(screen.getByText("第 2 音")).toBeInTheDocument();
    expect(screen.getByText("按错位置")).toBeInTheDocument();
    // 偏高 32.6 音分取整显示
    expect(screen.getByText("第 3 音")).toBeInTheDocument();
    expect(screen.getByText("+33 音分")).toBeInTheDocument();
    // 漏弹不算「弹错」，不该挤进错误清单
    expect(screen.queryByText("第 4 音")).not.toBeInTheDocument();
    expect(screen.getByText("记下这一遍")).toBeInTheDocument();
    expect(screen.getByText("再来一遍")).toBeInTheDocument();
    // 听完后高亮必须熄掉，否则谱面一直停在最后一个音
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it("过了才让记档：「记下这一遍」把档位和这一句的时长都记准", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    stubMic();
    const onPass = vi.fn();
    const onLog = vi.fn();
    render(panel({ onPass, onLog }));

    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    await flush();
    runToResult();

    fireEvent.click(screen.getByText("记下这一遍"));
    // 该句记到当前档位（0.6×）
    expect(onPass).toHaveBeenCalledWith(0.6);
    // 时长是这一句的谱面长度（4 个音 × 0.5s = 2.0s），不是墙上时钟
    expect(onLog).toHaveBeenCalledWith(2.0);
    expect(screen.getByText("已记下 · 这一句到 0.6×")).toBeInTheDocument();
    // 记过就不再给按钮，免得重复记档
    expect(screen.queryByText("记下这一遍")).not.toBeInTheDocument();
  });

  it("没过就不给「记下这一遍」，但「再来一遍」得真的重来", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    stubMic();
    vi.mocked(judgeTake).mockReturnValue(FAIL_RESULT);
    render(panel());

    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    await flush();
    runToResult();

    expect(screen.getByText("漏了 2 音，多半是没记住弦位——再来一遍。")).toBeInTheDocument();
    // 不及格不许记档——日课里的「过了」必须是真的过了
    expect(screen.queryByText("记下这一遍")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("再来一遍"));
    await flush();
    expect(
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mock
        .calls.length,
    ).toBe(2);
  });

  it("听的当中叫停：麦克风必须关掉，状态回零", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    stubMic();
    const onHighlight = vi.fn();
    render(panel({ onHighlight }));

    fireEvent.click(screen.getByLabelText(/跟弹判定第 1 音起这一句/));
    await flush();
    fireEvent.click(screen.getByLabelText("停止跟弹判定"));

    // 浏览器的录音指示灯要跟着灭
    expect(trackStop).toHaveBeenCalled();
    // 回到起步状态：说回「不放参考音」、按钮变回「听我弹」
    expect(screen.getByText(/不放参考音/)).toBeInTheDocument();
    expect(screen.getByText("听我弹")).toBeInTheDocument();
    expect(screen.queryByTestId("judge-result")).not.toBeInTheDocument();
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });
});
