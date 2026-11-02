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

  it("重标 A 到 B 之后时把旧的 B 一并清掉，避免区间倒挂", () => {
    render(<PracticePlayer />);
    pickAudio();
    const audio = screen.getByTestId("practice-audio") as HTMLAudioElement;

    audio.currentTime = 4;
    fireEvent.click(screen.getByText("标记 A"));
    audio.currentTime = 9;
    fireEvent.click(screen.getByText("标记 B"));
    expect(screen.getByText(/A 0:04\.0 · B 0:09\.0/)).toBeTruthy();

    // A 移到 B 右边 → B 失效，循环按钮重新变灰
    audio.currentTime = 12;
    fireEvent.click(screen.getByText("标记 A"));
    expect(screen.getByText(/A 0:12\.0 · B 0:00\.0/)).toBeTruthy();
    expect((screen.getByLabelText("AB 循环") as HTMLButtonElement).disabled).toBe(true);
  });

  it("「清空」把 A/B 与循环状态一起复位", () => {
    render(<PracticePlayer />);
    pickAudio();
    const audio = screen.getByTestId("practice-audio") as HTMLAudioElement;

    audio.currentTime = 2;
    fireEvent.click(screen.getByText("标记 A"));
    audio.currentTime = 5;
    fireEvent.click(screen.getByText("标记 B"));
    fireEvent.click(screen.getByLabelText("AB 循环"));
    expect(screen.getByLabelText("AB 循环").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByText("清空"));
    expect(screen.getByText(/A 0:00\.0 · B 0:00\.0/)).toBeTruthy();
    expect(screen.queryByText("清空")).toBeNull();
    expect(screen.getByLabelText("AB 循环").getAttribute("aria-pressed")).toBe("false");
  });

  it("拖进度条会同时改 audio.currentTime 与显示", () => {
    render(<PracticePlayer />);
    pickAudio();
    const audio = screen.getByTestId("practice-audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 20 });
    fireEvent.loadedMetadata(audio);

    fireEvent.change(screen.getByLabelText("播放位置"), { target: { value: "7.5" } });
    expect(audio.currentTime).toBe(7.5);
    expect(screen.getByText("0:07.5 / 0:20.0")).toBeTruthy();
  });

  it("音频自身的 play/pause/ended 事件会把按钮文案跟着改", () => {
    render(<PracticePlayer />);
    pickAudio();
    const audio = screen.getByTestId("practice-audio") as HTMLAudioElement;

    fireEvent.play(audio);
    expect(screen.getByLabelText("暂停")).toBeTruthy();
    fireEvent.pause(audio);
    expect(screen.getByLabelText("播放")).toBeTruthy();
    fireEvent.play(audio);
    fireEvent.ended(audio);
    expect(screen.getByLabelText("播放")).toBeTruthy();
  });

  it("AB 循环跑到 B 之后跳回 A（rAF 轮询），暂停时不跳", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    render(<PracticePlayer />);
    pickAudio();
    const audio = screen.getByTestId("practice-audio") as HTMLAudioElement;

    audio.currentTime = 2;
    fireEvent.click(screen.getByText("标记 A"));
    audio.currentTime = 6;
    fireEvent.click(screen.getByText("标记 B"));
    fireEvent.click(screen.getByLabelText("AB 循环"));

    // 循环计时器起来后就绪：挑最后一帧来跑
    expect(callbacks.length).toBeGreaterThan(0);

    Object.defineProperty(audio, "paused", { configurable: true, value: false });
    audio.currentTime = 6.5;
    callbacks.at(-1)?.(0);
    expect(audio.currentTime).toBe(2);

    // 暂停时不动它，用户拖到哪就停在哪
    Object.defineProperty(audio, "paused", { configurable: true, value: true });
    audio.currentTime = 6.5;
    callbacks.at(-1)?.(0);
    expect(audio.currentTime).toBe(6.5);

    vi.unstubAllGlobals();
  });

  it("换一段录音时释放上一段的 blob url", () => {
    render(<PracticePlayer />);
    pickAudio();
    pickAudio("第二段.m4a", "audio/mp4");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:practice");
  });

  it("浏览器拒绝播放时说明可以再点一次", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("no"));
    render(<PracticePlayer />);
    pickAudio();
    fireEvent.click(screen.getByLabelText("播放"));
    expect(await screen.findByText(/浏览器拒绝了播放/)).toBeTruthy();
  });
});
