/**
 * @vitest-environment jsdom
 *
 * 单功能页 → 工作台的「带回结果」通道。
 * 拆页后这是唯一一条跨页数据边，坏了的表现是「识别完点回去，谱上什么也没有」，
 * 所以这里把写入 / 读取 / 过期 / 坏数据 / 存储不可用都验一遍。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  queueNotesForWorkbench,
  queuePhraseForWorkbench,
  takeQueuedNotes,
  takeQueuedPhrase,
} from "../workbench-bridge";
import type { NoteColumn } from "../types";

const NOTES_KEY = "taiyin:bridge:notes:v1";
const PHRASE_KEY = "taiyin:bridge:phrase:v1";

function note(id: string): NoteColumn {
  return {
    id,
    jianpuNumber: 5,
    jianpuOctave: "4",
    jianpuDot: false,
    duration: 0.5,
    jianzi: { json: "test" },
  } as unknown as NoteColumn;
}

describe("workbench-bridge", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("谱字写入后能原样取出，取走即删（刷新不会重复入谱）", () => {
    queueNotesForWorkbench([note("a"), note("b")]);
    expect(JSON.parse(window.sessionStorage.getItem(NOTES_KEY) ?? "{}").value).toHaveLength(2);

    expect(takeQueuedNotes().map((n) => n.id)).toEqual(["a", "b"]);
    expect(takeQueuedNotes()).toEqual([]);
    expect(window.sessionStorage.getItem(NOTES_KEY)).toBeNull();
  });

  it("空数组不写；坏 JSON / 非数组 / 过期信封都被吞成空", () => {
    queueNotesForWorkbench([]);
    expect(window.sessionStorage.getItem(NOTES_KEY)).toBeNull();

    window.sessionStorage.setItem(NOTES_KEY, "not json");
    expect(takeQueuedNotes()).toEqual([]);

    window.sessionStorage.setItem(NOTES_KEY, JSON.stringify({ at: Date.now(), value: "oops" }));
    expect(takeQueuedNotes()).toEqual([]);

    window.sessionStorage.setItem(
      NOTES_KEY,
      JSON.stringify({ at: Date.now() - 6 * 60 * 1000, value: [note("old")] }),
    );
    expect(takeQueuedNotes()).toEqual([]);
  });

  it("会话存储不可用时静默降级，不把功能页弄崩", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => queueNotesForWorkbench([note("a")])).not.toThrow();
    spy.mockRestore();
  });

  it("句号能带走，负数与过期值不生效", () => {
    queuePhraseForWorkbench(2);
    expect(takeQueuedPhrase()).toBe(2);
    expect(takeQueuedPhrase()).toBeNull();

    window.sessionStorage.setItem(PHRASE_KEY, JSON.stringify({ at: Date.now(), value: -1 }));
    expect(takeQueuedPhrase()).toBeNull();

    window.sessionStorage.setItem(
      PHRASE_KEY,
      JSON.stringify({ at: Date.now() - 6 * 60 * 1000, value: 1 }),
    );
    expect(takeQueuedPhrase()).toBeNull();
  });
});
