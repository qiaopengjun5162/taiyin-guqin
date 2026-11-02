import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PracticePlayer } from "@/components/practice-player";

/**
 * 跟录音练琴的接线测试。
 *
 * jsdom 里没有真的音频解码：play/pause 与 createObjectURL 都要替身，
 * 这里只验证「选文件 → 标 A/B → 变速」这条操作链有没有把状态接对。
 */
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  // jsdom 未实现 createObjectURL
  Object.defineProperty(URL, "createObjectURL", {
    writable: true,
    value: vi.fn(() => "blob:practice"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function pickAudio(name = "老师的录音.mp3", type = "audio/mpeg") {
  const input = screen.getByLabelText("选择本地音频");
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type })] } });
}

describe("PracticePlayer", () => {
  it("未选音频时不渲染播放控件，并说明录音不上传", () => {
    render(<PracticePlayer />);
    expect(screen.getByText(/不上传/)).toBeTruthy();
    expect(screen.queryByLabelText("播放")).toBeNull();
  });

  it("选好音频后显示文件名与播放/标点/变速控件", () => {
    render(<PracticePlayer />);
    pickAudio();
    expect(screen.getByText("老师的录音.mp3")).toBeTruthy();
    expect(screen.getByLabelText("播放")).toBeTruthy();
    expect(screen.getByText("标记 A")).toBeTruthy();
    expect(screen.getByText("标记 B")).toBeTruthy();
    expect(screen.getByText("0.5×")).toBeTruthy();
    expect(screen.getByText("变速不变调")).toBeTruthy();
  });

  it("选了非音频文件时明确报错，不把它当录音", () => {
    render(<PracticePlayer />);
    pickAudio("谱面.png", "image/png");
    expect(screen.getByText(/这不是音频文件/)).toBeTruthy();
    expect(screen.queryByLabelText("播放")).toBeNull();
  });

  it("标了 A、B 两点后 AB 循环才可用", () => {
    render(<PracticePlayer />);
    pickAudio();
    const audio = screen.getByTestId("practice-audio") as HTMLAudioElement;
    const loopBtn = screen.getByLabelText("AB 循环") as HTMLButtonElement;

    expect(loopBtn.disabled).toBe(true);

    audio.currentTime = 3;
    fireEvent.click(screen.getByText("标记 A"));
    audio.currentTime = 8;
    fireEvent.click(screen.getByText("标记 B"));

    expect(loopBtn.disabled).toBe(false);
    expect(screen.getByText(/A 0:03\.0 · B 0:08\.0/)).toBeTruthy();
  });

  it("B 点早于 A 点时拒绝并提示", () => {
    render(<PracticePlayer />);
    pickAudio();
    const audio = screen.getByTestId("practice-audio") as HTMLAudioElement;
    audio.currentTime = 10;
    fireEvent.click(screen.getByText("标记 A"));
    audio.currentTime = 5;
    fireEvent.click(screen.getByText("标记 B"));

    expect(screen.getByText(/B 点要在 A 点之后/)).toBeTruthy();
    expect((screen.getByLabelText("AB 循环") as HTMLButtonElement).disabled).toBe(true);
  });

  it("变速按钮把 playbackRate 落到 audio 元素上", () => {
    render(<PracticePlayer />);
    pickAudio();
    const audio = screen.getByTestId("practice-audio") as HTMLAudioElement;
    fireEvent.click(screen.getByText("0.5×"));
    expect(audio.playbackRate).toBe(0.5);
    fireEvent.click(screen.getByText("1.25×"));
    expect(audio.playbackRate).toBe(1.25);
  });

  it("点播放会调用 play，并切到「暂停」文案", () => {
    render(<PracticePlayer />);
    pickAudio();
    fireEvent.click(screen.getByLabelText("播放"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(screen.getByLabelText("暂停")).toBeTruthy();
  });
});
