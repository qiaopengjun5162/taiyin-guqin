import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetPracticeStoreForTests,
  addEntry,
  defaultRecordingName,
  deleteEntry,
  deleteRecording,
  formatDuration,
  getRecordingBlob,
  isPersistentStorage,
  listEntries,
  listRecordings,
  localDateKey,
  monthRange,
  renameRecording,
  saveRecording,
  streakDays,
  summarize,
  updateEntryNote,
  weekRange,
  type PracticeEntry,
} from "../practice-log";

/** 造一条记录，只关心日期/时长，其余给默认值。 */
function entry(date: string, seconds: number, scoreTitle = "良宵引"): PracticeEntry {
  return {
    id: `${date}-${scoreTitle}-${seconds}`,
    date,
    createdAt: `${date}T10:00:00.000Z`,
    scoreTitle,
    seconds,
    note: "",
    source: "manual",
  };
}

beforeEach(() => {
  __resetPracticeStoreForTests();
});

describe("日期键与区间", () => {
  it("用本地日期而不是 UTC（晚上练琴不会记到昨天）", () => {
    // 东八区 23:30 若用 toISOString 会变成次日的 15:30
    expect(localDateKey(new Date(2026, 10, 2, 23, 30))).toBe("2026-11-02");
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("本周从周一起算", () => {
    // 2026-11-02 是周一
    expect(weekRange(new Date(2026, 10, 2))).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    // 同一周的周日
    expect(weekRange(new Date(2026, 10, 8))).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    // 下周一
    expect(weekRange(new Date(2026, 10, 9))).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });

  it("本月区间取首末日（含闰年二月）", () => {
    expect(monthRange(new Date(2026, 10, 2))).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange(new Date(2024, 1, 10))).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});

describe("汇总", () => {
  it("只算区间内，累计时长按天去重统计天数", () => {
    const entries = [
      entry("2026-11-02", 600),
      entry("2026-11-02", 300, "流水"),
      entry("2026-11-05", 120),
      entry("2026-10-31", 999), // 区间外
    ];
    const s = summarize(entries, "2026-11-02", "2026-11-08");
    expect(s.seconds).toBe(1020);
    expect(s.days).toBe(2);
    expect(s.entryCount).toBe(3);
  });

  it("曲目分布按时长降序，空标题归「未记曲目」", () => {
    const entries = [
      entry("2026-11-02", 100, "良宵引"),
      entry("2026-11-03", 400, "良宵引"),
      entry("2026-11-04", 200, "  "),
    ];
    const s = summarize(entries, "2026-11-01", "2026-11-30");
    expect(s.byScore).toEqual([
      { title: "良宵引", seconds: 500 },
      { title: "未记曲目", seconds: 200 },
    ]);
  });

  it("空记录汇总是零，不是 NaN", () => {
    expect(summarize([], "2026-11-01", "2026-11-30")).toEqual({
      seconds: 0,
      days: 0,
      entryCount: 0,
      byScore: [],
    });
  });
});

describe("连续打卡", () => {
  const today = new Date(2026, 10, 2); // 周一

  it("今天练了：从今天往回数", () => {
    expect(streakDays([entry("2026-11-02", 60), entry("2026-11-01", 60)], today)).toBe(2);
  });

  it("今天还没练：从昨天往回数，不显示 0", () => {
    expect(streakDays([entry("2026-11-01", 60), entry("2026-10-31", 60)], today)).toBe(2);
  });

  it("中间断了就停在那里", () => {
    expect(
      streakDays([entry("2026-11-02", 60), entry("2026-10-31", 60), entry("2026-10-30", 60)], today),
    ).toBe(1);
  });

  it("同一天记两笔只算一天", () => {
    expect(streakDays([entry("2026-11-02", 60), entry("2026-11-02", 90, "流水")], today)).toBe(1);
  });

  it("没有任何记录是 0", () => {
    expect(streakDays([], today)).toBe(0);
  });
});

describe("时长文案", () => {
  it.each([
    [0, "0 秒"],
    [45, "45 秒"],
    [60, "1 分钟"],
    [750, "12 分 30 秒"],
    [3600, "1 小时"],
    [3900, "1 小时 5 分"],
  ])("%i 秒 → %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe("记录存储（IndexedDB 不可用时退化为内存）", () => {
  it("jsdom 里没有 IndexedDB，应如实报告不持久", async () => {
    expect(await isPersistentStorage()).toBe(false);
  });

  it("写入后能列出、改笔记、删除", async () => {
    const created = await addEntry({ scoreTitle: " 平沙落雁 ", seconds: 305.6, note: "  " });
    expect(created.scoreTitle).toBe("平沙落雁");
    expect(created.seconds).toBe(306); // 四舍五入到秒
    expect(created.date).toBe(localDateKey(new Date()));
    expect(created.source).toBe("manual");

    await updateEntryNote(created.id, " 第七段还是抢 ");
    let list = await listEntries();
    expect(list).toHaveLength(1);
    expect(list[0].note).toBe("第七段还是抢");

    await deleteEntry(created.id);
    list = await listEntries();
    expect(list).toHaveLength(0);
  });

  it("负数时长被夹成 0，不会出现负的练习时间", async () => {
    const created = await addEntry({ scoreTitle: "x", seconds: -30 });
    expect(created.seconds).toBe(0);
  });

  it("列表按创建时间倒序", async () => {
    const a = await addEntry({ scoreTitle: "先", seconds: 60 });
    await new Promise((r) => setTimeout(r, 5));
    const b = await addEntry({ scoreTitle: "后", seconds: 60 });
    expect((await listEntries()).map((e) => e.id)).toEqual([b.id, a.id]);
  });
});

describe("录音存储", () => {
  it("存元信息与 Blob，列表不读音频本体", async () => {
    const blob = new Blob(["fake-audio"], { type: "audio/webm" });
    const meta = await saveRecording({ blob, seconds: 62.4, scoreTitle: "良宵引" });

    expect(meta.seconds).toBe(62);
    expect(meta.mime).toBe("audio/webm");
    expect(meta.scoreTitle).toBe("良宵引");
    expect(meta.name).toContain("良宵引");

    const list = await listRecordings();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(meta.id);
    // 元信息里不该夹带 blob
    expect(Object.keys(list[0])).not.toContain("blob");

    const back = await getRecordingBlob(meta.id);
    expect(back).not.toBeNull();
    expect(await back!.text()).toBe("fake-audio");
  });

  it("改名后列表跟着变，空名不生效", async () => {
    const meta = await saveRecording({ blob: new Blob(["a"]), seconds: 3 });
    await renameRecording(meta.id, "  第三段  ");
    expect((await listRecordings())[0].name).toBe("第三段");

    await renameRecording(meta.id, "   ");
    expect((await listRecordings())[0].name).toBe("第三段");
  });

  it("删录音会连带删掉 Blob", async () => {
    const meta = await saveRecording({ blob: new Blob(["a"]), seconds: 3 });
    await deleteRecording(meta.id);
    expect(await listRecordings()).toHaveLength(0);
    expect(await getRecordingBlob(meta.id)).toBeNull();
  });

  it("按时间倒序，且默认名带日期时间", async () => {
    const first = await saveRecording({ blob: new Blob(["a"]), seconds: 3 });
    await new Promise((r) => setTimeout(r, 5));
    const second = await saveRecording({ blob: new Blob(["b"]), seconds: 3 });
    expect((await listRecordings()).map((r) => r.id)).toEqual([second.id, first.id]);

    expect(defaultRecordingName(" 流水 ")).toBe("流水");
    expect(defaultRecordingName("   ")).toBe("练习");
    expect(defaultRecordingName()).toBe("练习");
  });
});
