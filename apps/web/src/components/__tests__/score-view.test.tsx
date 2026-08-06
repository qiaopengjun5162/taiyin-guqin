/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ScoreView } from "../score-view";
import { createEmptyState } from "@/lib/jianzi";
import type { NoteColumn, JianziState } from "@/lib/types";

function makeNote(overrides: Partial<NoteColumn> = {}): NoteColumn {
  const jianzi: JianziState = {
    ...createEmptyState(),
    toneType: "散",
    rightAction: "勹",
    stringNumber: "五",
  };
  return {
    id: overrides.id ?? crypto.randomUUID(),
    jianpuNumber: null,
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi,
    ...overrides,
  };
}

describe("ScoreView", () => {
  describe("onEdit", () => {
    it("fires onEdit with correct index when clicking a note column", () => {
      const onEdit = vi.fn();
      const notes = [makeNote({ id: "a" }), makeNote({ id: "b" })];
      const { container } = render(
        <ScoreView notes={notes} onEdit={onEdit} />,
      );
      const columns = container.firstElementChild!.children;
      fireEvent.click(columns[1]);
      expect(onEdit).toHaveBeenCalledWith(1);
    });

    it("does not fire onEdit when clicking delete button", () => {
      const onEdit = vi.fn();
      const onRemove = vi.fn();
      const notes = [makeNote({ id: "a" })];
      const { container } = render(
        <ScoreView notes={notes} onEdit={onEdit} onRemove={onRemove} />,
      );
      const column = container.firstElementChild!.children[0];
      const deleteBtn = column.querySelector("button");
      expect(deleteBtn).not.toBeNull();
      fireEvent.click(deleteBtn!);
      expect(onRemove).toHaveBeenCalledWith("a");
      expect(onEdit).not.toHaveBeenCalled();
    });
  });

  describe("onRemove", () => {
    it("fires onRemove with note id", () => {
      const onRemove = vi.fn();
      const notes = [makeNote({ id: "test-id" })];
      const { container } = render(
        <ScoreView notes={notes} onRemove={onRemove} />,
      );
      const column = container.firstElementChild!.children[0];
      const deleteBtn = column.querySelector("button");
      fireEvent.click(deleteBtn!);
      expect(onRemove).toHaveBeenCalledWith("test-id");
    });
  });

  describe("editingIndex highlight", () => {
    it("adds highlight class to the editing column", () => {
      const notes = [makeNote({ id: "a" }), makeNote({ id: "b" })];
      const { container } = render(
        <ScoreView notes={notes} editingIndex={1} />,
      );
      const columns = container.firstElementChild!.children;
      expect(columns[0].className).not.toContain("ring-amber");
      expect(columns[1].className).toContain("ring-amber");
    });
  });

  describe("playingIndex highlight", () => {
    it("adds playing class to the playing column", () => {
      const notes = [makeNote({ id: "a" }), makeNote({ id: "b" })];
      const { container } = render(
        <ScoreView notes={notes} playingIndex={0} />,
      );
      const columns = container.firstElementChild!.children;
      expect(columns[0].className).toContain("bg-emerald-50");
      expect(columns[1].className).not.toContain("bg-emerald-50");
    });

    it("playing highlight takes precedence over editing", () => {
      const notes = [makeNote({ id: "a" })];
      const { container } = render(
        <ScoreView notes={notes} editingIndex={0} playingIndex={0} />,
      );
      const column = container.firstElementChild!.children[0];
      expect(column.className).toContain("bg-emerald-50");
      expect(column.className).not.toContain("ring-amber");
    });
  });

  describe("empty state", () => {
    it("shows placeholder when notes is empty", () => {
      const { container } = render(<ScoreView notes={[]} />);
      expect(container.textContent).toContain("在下方拼装减字");
    });
  });

  describe("bar lines", () => {
    it("renders a bar line after every beatsPerBar beats", () => {
      const notes = [
        makeNote({ id: "a" }),
        makeNote({ id: "b" }),
        makeNote({ id: "c" }),
        makeNote({ id: "d" }),
        makeNote({ id: "e" }),
      ];
      const { container } = render(
        <ScoreView notes={notes} beatsPerBar={4} />,
      );
      const barLines = container.querySelectorAll("[data-testid='bar-line']");
      expect(barLines).toHaveLength(1);
    });

    it("renders bar lines for mixed durations", () => {
      const notes = [
        makeNote({ id: "a", duration: "四分" }),
        makeNote({ id: "b", duration: "八分" }),
        makeNote({ id: "c", duration: "八分" }),
        makeNote({ id: "d", duration: "四分" }),
        makeNote({ id: "e", duration: "四分" }),
      ];
      const { container } = render(
        <ScoreView notes={notes} beatsPerBar={3} />,
      );
      const barLines = container.querySelectorAll("[data-testid='bar-line']");
      expect(barLines).toHaveLength(1);
    });
  });
});
