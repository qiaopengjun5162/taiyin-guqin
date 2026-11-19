/**
 * @vitest-environment jsdom
 *
 * `useScoreDraft` —— 自动草稿的读写与恢复提示。
 *
 * 要守的两条（都写在 hook 的文档注释里，且都是「不报错、只让人困惑」的类型）：
 *
 * 1. 提示只在页面还是空的时候出现。用户一旦开始录入就该消失——
 *    「开始录」本身就是选了「不恢复」，不该再弹一次问。
 * 2. 分享直达（`?score=`）不弹草稿提示：两条载入路径不能打架。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useScoreDraft } from "../use-score-draft";
import { clearDraft, readDraft, writeDraft } from "../draft-store";
import type { NoteColumn } from "../types";
import { createEmptyState } from "../jianzi";

function makeNote(id: string): NoteColumn {
  return {
    id,
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: {
      ...createEmptyState(),
      toneType: "散",
      rightAction: "勹",
      stringNumber: "五",
    },
  };
}

const UNTITLED = "未命名曲谱";

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    score: [] as NoteColumn[],
    scoreTitle: UNTITLED,
    tuning: "zhengdiao" as const,
    currentScoreId: null,
    isDirty: false,
    untitledTitle: UNTITLED,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  clearDraft();
  // 每个用例从干净 URL 开始：分享直达的判断现在在 hook 内部读 window.location
  window.history.replaceState({}, "", "/");
});

describe("useScoreDraft · 恢复提示", () => {
  it("有草稿且页面还空着时给出提示", async () => {
    writeDraft({ title: "上次的谱", notes: [makeNote("a")], tuning: "zhengdiao", scoreId: null });

    const { result } = renderHook(() => useScoreDraft(baseOptions()));

    await waitFor(() => expect(result.current.pendingDraft).not.toBeNull());
    expect(result.current.showDraftBanner).toBe(true);
  });

  it("页面已有内容时不给提示（用户已经选了「不恢复」）", async () => {
    writeDraft({ title: "上次的谱", notes: [makeNote("a")], tuning: "zhengdiao", scoreId: null });

    const { result } = renderHook(() =>
      useScoreDraft(baseOptions({ score: [makeNote("x")], scoreTitle: "新曲" })),
    );

    // 草稿读到了，但横幅不该出现
    await waitFor(() => expect(result.current.pendingDraft).not.toBeNull());
    expect(result.current.showDraftBanner).toBe(false);
  });

  it("分享直达时不读草稿", async () => {
    writeDraft({ title: "上次的谱", notes: [makeNote("a")], tuning: "zhengdiao", scoreId: null });
    // 模拟从分享链接进入：URL 带 ?score=<id>
    window.history.replaceState({}, "", "/?score=abc123");

    const { result } = renderHook(() => useScoreDraft(baseOptions()));

    // 给 effect 一点时间，确认它确实没把草稿搬进来
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.pendingDraft).toBeNull();
    expect(result.current.showDraftBanner).toBe(false);
  });

  it("空草稿（0 个音）不提示", async () => {
    writeDraft({ title: "空的", notes: [], tuning: "zhengdiao", scoreId: null });

    const { result } = renderHook(() => useScoreDraft(baseOptions()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.pendingDraft).toBeNull();
  });
});

describe("useScoreDraft · 写盘", () => {
  it("有未保存修改时防抖写草稿", async () => {
    const { rerender } = renderHook(
      (opts) => useScoreDraft(opts as never),
      { initialProps: baseOptions() },
    );
    // 无修改：不该写盘
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(readDraft()).toBeNull();

    // 变成有修改
    rerender(
      baseOptions({
        isDirty: true,
        score: [makeNote("a")],
        scoreTitle: "新谱",
      }),
    );

    await waitFor(() => expect(readDraft()).not.toBeNull(), { timeout: 2000 });
    expect(readDraft()?.title).toBe("新谱");
    expect(readDraft()?.notes).toHaveLength(1);
  });
});

describe("useScoreDraft · 恢复与丢弃", () => {
  it("取出草稿后提示收起，内容交给调用方", async () => {
    writeDraft({ title: "上次的谱", notes: [makeNote("a")], tuning: "zhengdiao", scoreId: null });
    const { result } = renderHook(() => useScoreDraft(baseOptions()));

    await waitFor(() => expect(result.current.pendingDraft).not.toBeNull());

    let taken: { title: string; notes: unknown[] } | null = null;
    act(() => {
      taken = result.current.takeDraftForRestore();
    });

    expect(taken!.title).toBe("上次的谱");
    expect(result.current.pendingDraft).toBeNull();
  });

  it("丢弃会清盘并收起提示", async () => {
    writeDraft({ title: "上次的谱", notes: [makeNote("a")], tuning: "zhengdiao", scoreId: null });
    const { result } = renderHook(() => useScoreDraft(baseOptions()));

    await waitFor(() => expect(result.current.pendingDraft).not.toBeNull());

    act(() => {
      result.current.discardDraft();
    });

    expect(result.current.pendingDraft).toBeNull();
    expect(readDraft()).toBeNull();
  });

  it("没有草稿时取出来是 null（不制造空对象）", () => {
    const { result } = renderHook(() => useScoreDraft(baseOptions()));
    let taken: unknown = "sentinel";
    act(() => {
      taken = result.current.takeDraftForRestore();
    });
    expect(taken).toBeNull();
  });
});
