/**
 * @vitest-environment jsdom
 */
/**
 * 跟弹面板：只在「能明确说出发生了什么」的路径上做断言。
 *
 * 判定算法本身在 `lib/__tests__/play-along.test.ts` 里逐条钉过了；这里只验
 * ① 不该出声的东西有没有被停掉（这决定了分数是不是真的）、② 出错时有没有说人话。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FollowPlayPanel } from "../follow-play-panel";
import type { NoteColumn } from "@/lib/types";
import type { ScorePhrase } from "@/lib/score-phrases";

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

afterEach(() => {
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
});
