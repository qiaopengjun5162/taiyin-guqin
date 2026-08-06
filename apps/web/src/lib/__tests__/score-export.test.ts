/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatScoreAsText, downloadTextFile } from "../score-export";
import { createEmptyState } from "@/lib/jianzi";
import type { NoteColumn, JianziState } from "../types";

function makeNote(overrides: Partial<NoteColumn> = {}): NoteColumn {
  const jianzi: JianziState = {
    ...createEmptyState(),
    toneType: "散",
    rightAction: "乚",
    stringNumber: "一",
  };
  return {
    id: "note-1",
    jianpuNumber: null,
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi,
    ...overrides,
  };
}

describe("formatScoreAsText", () => {
  it("includes title when provided", () => {
    const notes = [makeNote()];
    const text = formatScoreAsText(notes, { title: "测试曲" });
    expect(text).toContain("# 测试曲");
  });

  it("formats jianpu and jianzi lines", () => {
    const notes = [
      makeNote({ jianpuNumber: "5", jianzi: { ...createEmptyState(), toneType: "散", rightAction: "乚", stringNumber: "一" } }),
      makeNote({ jianpuNumber: "6", jianzi: { ...createEmptyState(), toneType: "散", rightAction: "乚", stringNumber: "二" } }),
    ];
    const text = formatScoreAsText(notes);
    const [jianpuLine, jianziLine] = text.split("\n");
    expect(jianpuLine).toContain("5");
    expect(jianpuLine).toContain("6");
    expect(jianziLine).toContain("散挑一");
    expect(jianziLine).toContain("散挑二");
  });

  it("inserts bar lines based on beatsPerBar", () => {
    const notes = [
      makeNote({ jianpuNumber: "1" }),
      makeNote({ jianpuNumber: "2" }),
      makeNote({ jianpuNumber: "3" }),
      makeNote({ jianpuNumber: "4" }),
      makeNote({ jianpuNumber: "5" }),
    ];
    const text = formatScoreAsText(notes, { beatsPerBar: 4 });
    const lines = text.split("\n");
    expect(lines[0]).toContain("|");
  });

  it("renders dash for missing jianpu number", () => {
    const notes = [makeNote()];
    const text = formatScoreAsText(notes);
    expect(text).toContain("-");
  });

  it("renders octave markers", () => {
    const notes = [
      makeNote({ jianpuNumber: "5", jianpuOctave: "·" }),
      makeNote({ jianpuNumber: "3", jianpuOctave: "," }),
    ];
    const text = formatScoreAsText(notes);
    expect(text).toContain("5·");
    expect(text).toContain("3,");
  });
});

describe("downloadTextFile", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:url"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a link and triggers download", () => {
    const clickSpy = vi.fn();
    const appendSpy = vi.fn();
    const removeSpy = vi.fn();

    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        href: "",
        download: "",
        click: clickSpy,
      })),
      body: {
        appendChild: appendSpy,
        removeChild: removeSpy,
      },
    });

    downloadTextFile("hello", "test.txt");

    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
  });
});
