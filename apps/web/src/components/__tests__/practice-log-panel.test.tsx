import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PracticeLogPanel } from "@/components/practice-log-panel";
import {
  __resetPracticeStoreForTests,
  addEntry,
  listEntries,
  localDateKey,
} from "@/lib/practice-log";

beforeEach(() => {
  __resetPracticeStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 挂载包 act：挂载后会异步读一遍本地记录，不收进 act 会刷 setState 警告。 */
async function renderPanel(scoreTitle = "") {
  await act(async () => {
    render(<PracticeLogPanel scoreTitle={scoreTitle} />);
  });
}

function fillManualForm(title: string, minutes: string, note = "") {
  fireEvent.change(screen.getByLabelText("练习曲目"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("练习时长（分钟）"), { target: { value: minutes } });
  fireEvent.change(screen.getByLabelText("练习笔记"), { target: { value: note } });
  // jsdom 点提交按钮不会触发 submit 事件（未实现表单提交），直接提交表单
  fireEvent.submit(screen.getByText("记一笔").closest("form")!);
}

describe("PracticeLogPanel", () => {
  it("没有记录时三项汇总都是 0，并说明数据不出本机", async () => {
    await renderPanel();
    expect(screen.getByText("0 秒")).toBeTruthy();
    expect(screen.getByText(/不上传、不跨设备同步/)).toBeTruthy();
    expect(screen.getByText(/还没有练习记录/)).toBeTruthy();
  });

  it("记一笔后：汇总、曲目分布、明细同时更新", async () => {
    await renderPanel("良宵引");
    fireEvent.change(screen.getByLabelText("练习时长（分钟）"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("练习笔记"), { target: { value: "第七段还是抢" } });
    // jsdom 点提交按钮不会触发 submit 事件（未实现表单提交），直接提交表单
  fireEvent.submit(screen.getByText("记一笔").closest("form")!);

    // 汇总值、曲目分布、明细三处都会出现 45 分钟
    await waitFor(() => expect(screen.getAllByText("45 分钟").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("第七段还是抢")).toBeTruthy();
    expect(screen.getByText(/记下了/)).toBeTruthy();

    const entries = await listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scoreTitle: "良宵引", seconds: 2700, source: "manual" });
  });

  it("时长填 0 或非数字时给出提示，且不写记录", async () => {
    await renderPanel();
    fillManualForm("良宵引", "0");
    await waitFor(() => expect(screen.getByText(/填个正数/)).toBeTruthy());
    expect(await listEntries()).toHaveLength(0);
  });

  it("周/月切换：两个按钮是互斥的按下态", async () => {
    await renderPanel();
    const week = screen.getByText("本周");
    const month = screen.getByText("本月");
    expect(week.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(month);
    expect(month.getAttribute("aria-pressed")).toBe("true");
    expect(week.getAttribute("aria-pressed")).toBe("false");
  });

  it("只把本周的记录算进本周（上个月的记录进本月统计）", async () => {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15);
    // 造一条上个月的记录：直接进存储，绕开「只能记今天」的表单
    await addEntry({ scoreTitle: "旧曲", seconds: 600, date: localDateKey(lastMonth) });

    await renderPanel();
    await waitFor(() => expect(screen.getByText("旧曲")).toBeTruthy());
    expect(screen.getByText("0 秒")).toBeTruthy(); // 本周窗口内没有练习

    fireEvent.click(screen.getByText("本月"));
    expect(screen.getByText("10 分钟")).toBeTruthy();
  });

  it("专注计时：结束后自动记一笔，用时来自计时器", async () => {
    vi.useFakeTimers();
    await renderPanel();
    fireEvent.click(screen.getByLabelText("开始专注计时"));
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    vi.useRealTimers();

    fireEvent.click(screen.getByLabelText("结束专注计时并记一笔"));
    await waitFor(() => expect(screen.getByText(/专注 1 分 5 秒/)).toBeTruthy());

    const entries = await listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ seconds: 65, source: "timer" });
  });

  it("专注不到 10 秒不记账（点错了不该留痕）", async () => {
    vi.useFakeTimers();
    await renderPanel();
    fireEvent.click(screen.getByLabelText("开始专注计时"));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    vi.useRealTimers();

    fireEvent.click(screen.getByLabelText("结束专注计时并记一笔"));
    await waitFor(() => expect(screen.getByText(/不到 10 秒/)).toBeTruthy());
    expect(await listEntries()).toHaveLength(0);
  });

  it("删除记录先确认，确认后从存储和列表里一起消失", async () => {
    const created = await addEntry({ scoreTitle: "平沙落雁", seconds: 300 });
    await renderPanel();
    await waitFor(() => expect(screen.getAllByText("平沙落雁").length).toBeGreaterThan(0));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(screen.getByLabelText(`删除 ${created.date} 的 平沙落雁 记录`));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await listEntries()).toHaveLength(1);

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByLabelText(`删除 ${created.date} 的 平沙落雁 记录`));
    await waitFor(async () => expect(await listEntries()).toHaveLength(0));
  });

  it("曲谱标题变化时跟随，但不覆盖用户已填的曲目", async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<PracticeLogPanel scoreTitle="流水" />);
    });
    expect((screen.getByLabelText("练习曲目") as HTMLInputElement).value).toBe("流水");

    fireEvent.change(screen.getByLabelText("练习曲目"), { target: { value: "潇湘水云" } });
    await act(async () => {
      view.rerender(<PracticeLogPanel scoreTitle="梅花三弄" />);
    });
    expect((screen.getByLabelText("练习曲目") as HTMLInputElement).value).toBe("潇湘水云");
  });
});
