import { describe, it, expect, beforeEach } from "vitest";
import type { NoteColumn } from "@/lib/types";
import { createEmptyState } from "@/lib/jianzi";
import { DEFAULT_TUNING } from "@/lib/tuning";
import { clearDraft, formatDraftAge, readDraft, writeDraft } from "@/lib/draft-store";

const KEY = "taiyin.draft.v1";

function makeNote(overrides: Partial<NoteColumn> = {}): NoteColumn {
  return {
    id: "n1",
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: createEmptyState(),
    ...overrides,
  };
}

describe("draft-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("没存过草稿时返回 null", () => {
    expect(readDraft()).toBeNull();
  });

  it("写入后能原样读回：标题 / 音符 / 定弦 / 来源谱 id", () => {
    const notes = [makeNote()];
    expect(writeDraft({ title: "平沙落雁", notes, tuning: "ruibin", scoreId: "abc" })).toBe(true);

    const draft = readDraft();
    expect(draft?.title).toBe("平沙落雁");
    expect(draft?.notes).toHaveLength(1);
    expect(draft?.tuning).toBe("ruibin");
    // 记住来源：恢复后保存才会更新原谱，而不是新建一份副本
    expect(draft?.scoreId).toBe("abc");
    expect(draft?.updatedAt).toBeGreaterThan(0);
  });

  it("新谱的 scoreId 允许为 null", () => {
    writeDraft({ title: "新谱", notes: [], tuning: DEFAULT_TUNING, scoreId: null });
    expect(readDraft()?.scoreId).toBeNull();
  });

  it("clearDraft 之后读不到", () => {
    writeDraft({ title: "x", notes: [makeNote()], tuning: DEFAULT_TUNING, scoreId: null });
    clearDraft();
    expect(readDraft()).toBeNull();
  });

  it("存档 JSON 坏掉时返回 null，不抛错", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readDraft()).toBeNull();
  });

  it("notes 不是数组时视为无效（恢复出来只会让编辑器崩）", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ title: "x", notes: "oops" }));
    expect(readDraft()).toBeNull();
  });

  it("不认识的定弦回退到默认正调", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ title: "x", notes: [], tuning: "youma" }));
    expect(readDraft()?.tuning).toBe(DEFAULT_TUNING);
  });

  it("缺 updatedAt / scoreId 时给出安全默认值", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ title: "x", notes: [] }));
    const draft = readDraft();
    expect(draft?.updatedAt).toBe(0);
    expect(draft?.scoreId).toBeNull();
  });

  it("存储不可用（隐私模式 / 配额满）时写入返回 false 而不是抛错", () => {
    const original = window.localStorage;
    // jsdom 的 localStorage 是特殊对象，spyOn(setItem) 拦不住 storage() 的探测写入；
    // 直接换掉整个 localStorage 才能模拟「写了就抛」的隐私模式。
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(window, "localStorage", { value: throwing, configurable: true });
    try {
      expect(
        writeDraft({ title: "x", notes: [makeNote()], tuning: DEFAULT_TUNING, scoreId: null }),
      ).toBe(false);
      expect(readDraft()).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", { value: original, configurable: true });
    }
  });
});

describe("formatDraftAge", () => {
  const now = 1_700_000_000_000;

  it("一分钟内说「刚刚」", () => {
    expect(formatDraftAge(now - 30_000, now)).toBe("刚刚");
  });

  it("按分钟 / 小时 / 天递进", () => {
    expect(formatDraftAge(now - 3 * 60_000, now)).toBe("3 分钟前");
    expect(formatDraftAge(now - 2 * 3_600_000, now)).toBe("2 小时前");
    expect(formatDraftAge(now - 3 * 86_400_000, now)).toBe("3 天前");
  });

  it("时间戳缺失或来自未来时退回「刚刚」", () => {
    expect(formatDraftAge(0, now)).toBe("刚刚");
    expect(formatDraftAge(now + 60_000, now)).toBe("刚刚");
  });
});
