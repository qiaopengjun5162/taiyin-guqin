import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScoreHistory } from "@/lib/use-score-history";
import type { NoteColumn } from "@/lib/types";
import { createEmptyState } from "@/lib/jianzi";

function makeNoteColumn(overrides: Partial<NoteColumn> = {}): NoteColumn {
  return {
    id: crypto.randomUUID(),
    jianpuNumber: null,
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: createEmptyState(),
    ...overrides,
  };
}

describe("useScoreHistory", () => {
  it("initializes with provided defaults", () => {
    const { result } = renderHook(() => useScoreHistory([makeNoteColumn({ id: "1" })], "test"));
    expect(result.current.score).toHaveLength(1);
    expect(result.current.title).toBe("test");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("commits score changes and allows undo/redo", () => {
    const { result } = renderHook(() => useScoreHistory([]));

    act(() => {
      result.current.commitScore([makeNoteColumn({ id: "a" })]);
    });
    expect(result.current.score).toHaveLength(1);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(result.current.score).toHaveLength(0);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });
    expect(result.current.score).toHaveLength(1);
    expect(result.current.canRedo).toBe(false);
  });

  it("clears future on new commit after undo", () => {
    const { result } = renderHook(() => useScoreHistory([]));

    act(() => result.current.commitScore([makeNoteColumn({ id: "a" })]));
    act(() => result.current.commitScore([makeNoteColumn({ id: "b" })]));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.commitScore([makeNoteColumn({ id: "c" })]));
    expect(result.current.canRedo).toBe(false);
    expect(result.current.score[0].id).toBe("c");
  });

  it("does not record empty commits", () => {
    const { result } = renderHook(() => useScoreHistory([]));
    act(() => result.current.commitScore([]));
    expect(result.current.canUndo).toBe(false);
  });

  it("caps history at 50 snapshots", () => {
    const { result } = renderHook(() => useScoreHistory([]));
    for (let i = 0; i < 55; i++) {
      act(() => result.current.commitScore([makeNoteColumn({ id: `n${i}` })]));
    }
    act(() => {
      for (let i = 0; i < 55; i++) result.current.undo();
    });
    expect(result.current.score).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("commits and undoes title changes", () => {
    const { result } = renderHook(() => useScoreHistory([], "old"));
    act(() => result.current.commitTitle("new"));
    expect(result.current.title).toBe("new");
    act(() => result.current.undo());
    expect(result.current.title).toBe("old");
  });

  it("supports functional score updater", () => {
    const { result } = renderHook(() => useScoreHistory([]));
    act(() => result.current.commitScore((prev) => [...prev, makeNoteColumn({ id: "x" })]));
    expect(result.current.score).toHaveLength(1);
  });
});
