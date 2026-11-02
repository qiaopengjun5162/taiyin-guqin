import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecorderPanel } from "@/components/recorder-panel";
import { __resetPracticeStoreForTests, listEntries, listRecordings } from "@/lib/practice-log";

const mocks = vi.hoisted(() => ({
  startRecording: vi.fn(),
  isRecordingSupported: vi.fn(() => true),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/recorder", () => ({
  isRecordingSupported: mocks.isRecordingSupported,
  micErrorMessage: (e: unknown) => (e instanceof Error ? e.message : "麦克风打不开"),
  startRecording: mocks.startRecording,
}));

beforeEach(() => {
  __resetPracticeStoreForTests();
  mocks.startRecording.mockReset();
  mocks.isRecordingSupported.mockReturnValue(true);
  mocks.stop.mockReset();
  mocks.stop.mockResolvedValue({
    blob: new Blob(["audio"], { type: "audio/webm" }),
    seconds: 12,
    mime: "audio/webm",
  });
  mocks.startRecording.mockImplementation(async () => ({
    paused: false,
    elapsedSeconds: () => 12,
    pause: mocks.pause,
    resume: mocks.resume,
    stop: mocks.stop,
    cancel: mocks.cancel,
  }));

  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", { writable: true, value: vi.fn(() => "blob:rec") });
  Object.defineProperty(URL, "revokeObjectURL", { writable: true, value: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 挂载要包 act：组件挂载后会异步读一遍「有没有存住的录音」，
 * 不把这段 Promise 收进 act，测试结束才落地的 setState 会刷一屏警告。
 */
async function renderPanel(scoreTitle = "良宵引") {
  await act(async () => {
    render(<RecorderPanel scoreTitle={scoreTitle} />);
  });
}

async function recordOnce() {
  await renderPanel();
  fireEvent.click(screen.getByLabelText("开始录音"));
  await waitFor(() => expect(screen.getByLabelText("结束录音并保存")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("结束录音并保存"));
  await waitFor(() => expect(screen.getByText(/已存下/)).toBeTruthy());
}

describe("RecorderPanel", () => {
  it("没录音时给出空态与「录完自动记一笔」的说明", async () => {
    await renderPanel();
    expect(screen.getByText(/还没有录音/)).toBeTruthy();
    expect(screen.getByLabelText("开始录音")).toBeTruthy();
  });

  it("开始录音后显示暂停与结束，暂停后按钮变成继续", async () => {
    await renderPanel();
    fireEvent.click(screen.getByLabelText("开始录音"));
    await waitFor(() => expect(screen.getByText(/录音中/)).toBeTruthy());

    fireEvent.click(screen.getByLabelText("暂停录音"));
    expect(screen.getByLabelText("继续录音")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("继续录音"));
    expect(screen.getByLabelText("暂停录音")).toBeTruthy();
  });

  it("结束录音：存下音频，并自动记一条同曲目同长的练习", async () => {
    await recordOnce();

    const recordings = await listRecordings();
    expect(recordings).toHaveLength(1);
    expect(recordings[0].scoreTitle).toBe("良宵引");
    expect(recordings[0].seconds).toBe(12);

    const entries = await listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      scoreTitle: "良宵引",
      seconds: 12,
      source: "recording",
      recordingId: recordings[0].id,
    });
  });

  it("列表里能回听：拿到 Blob 后喂给 audio 元素", async () => {
    await recordOnce();
    fireEvent.click(screen.getByLabelText(/播放 良宵引/));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("改名走内联输入，回车提交", async () => {
    await recordOnce();
    fireEvent.click(screen.getByLabelText(/重命名 良宵引/));
    const input = screen.getByLabelText("录音名称");
    fireEvent.change(input, { target: { value: "慢练第三段" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(async () => {
      const list = await listRecordings();
      expect(list[0].name).toBe("慢练第三段");
    });
  });

  it("删除录音会先确认；取消则保留", async () => {
    await recordOnce();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(screen.getByLabelText(/删除 良宵引/));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await listRecordings()).toHaveLength(1);

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByLabelText(/删除 良宵引/));
    await waitFor(async () => expect(await listRecordings()).toHaveLength(0));
    // 练习记录不该被连带删掉
    expect(await listEntries()).toHaveLength(1);
  });

  it("浏览器不支持录音时明确提示，并禁用按钮", async () => {
    mocks.isRecordingSupported.mockReturnValue(false);
    await renderPanel();
    expect(screen.getByText(/不支持录音/)).toBeTruthy();
    expect((screen.getByLabelText("开始录音") as HTMLButtonElement).disabled).toBe(true);
  });

  it("麦克风打不开时把原因说出来，不静默", async () => {
    mocks.startRecording.mockRejectedValueOnce(new Error("麦克风权限被拒绝。"));
    await renderPanel();
    fireEvent.click(screen.getByLabelText("开始录音"));
    await waitFor(() => expect(screen.getByText(/权限被拒绝/)).toBeTruthy());
  });
});
