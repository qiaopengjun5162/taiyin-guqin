import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScoreHistory } from "@/lib/use-score-history";

describe("useScoreHistory", () => {
  it("initializes with provided defaults", () => {
    const { result } = renderHook(() => useScoreHistory([{ id: "1" } as any], "test"));
    expect(result.current.score).toHaveLength(1);
    expect(result.current.title).toBe("test");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("commits score changes and allows undo/redo", () => {
    const { result } = renderHook(() => useScoreHistory([]));

    act(() => {
      result.current.commitScore([{ id: "a" } as any]);
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

    act(() => result.current.commitScore([{ id: "a" } as any]));
    act(() => result.current.commitScore([{ id: "b" } as any]));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.commitScore([{ id: "c" } as any]));
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
      act(() => result.current.commitScore([{ id: `n${i}` } as any]));
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
    act(() => result.current.commitScore((prev) => [...prev, { id: "x" } as any]));
    expect(result.current.score).toHaveLength(1);
  });
});
