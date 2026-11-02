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

  it("给了定弦就写在标题下一行（导出给别人弹，不讲定弦差半音）", () => {
    const notes = [makeNote()];
    const text = formatScoreAsText(notes, {
      title: "紧五弦曲",
      tuning: "蕤宾调 · 紧五弦 · 1=B♭",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("# 紧五弦曲");
    expect(lines[1]).toBe("定弦：蕤宾调 · 紧五弦 · 1=B♭");
  });

  it("不给定弦时输出与从前一致（不多出空行）", () => {
    const notes = [makeNote()];
    const text = formatScoreAsText(notes, { title: "测试曲" });
    expect(text.split("\n")[1]).toBe("");
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

  it("renders double-octave markers", () => {
    const notes = [
      makeNote({ jianpuNumber: "1", jianpuOctave: "··" }),
      makeNote({ jianpuNumber: "1", jianpuOctave: ",," }),
    ];
    const text = formatScoreAsText(notes);
    expect(text).toContain("1··");
    expect(text).toContain("1,,");
  });

  it("给了编码就多输出一行码（没有码的位置写 -）", () => {
    const notes = [
      makeNote({ jianpuNumber: "5" }),
      makeNote({ jianpuNumber: "6" }),
    ];
    const lines = formatScoreAsText(notes, { codes: ["st1", null] }).split("\n");
    expect(lines).toHaveLength(5); // 简谱 / 减字 / 编码 / 空行 / 共 N 音
    expect(lines[0]).toContain("5");
    expect(lines[1]).toContain("散挑一");
    expect(lines[2]).toContain("st1");
    expect(lines[2]).toContain("-");
  });

  it("有歌词时在减字之后加一行歌词", () => {
    const notes = [
      makeNote({ jianpuNumber: "5", lyric: "清" }),
      makeNote({ jianpuNumber: "6", lyric: "和" }),
    ];
    const lines = formatScoreAsText(notes).split("\n");
    expect(lines[1]).toContain("散挑一");
    expect(lines[2]).toContain("清");
    expect(lines[2]).toContain("和");
  });

  it("简谱 / 减字 / 歌词 / 编码四行的顺序与纸谱一致", () => {
    const notes = [
      makeNote({ jianpuNumber: "5", lyric: "清" }),
      makeNote({ jianpuNumber: "6", lyric: "和" }),
    ];
    const lines = formatScoreAsText(notes, { codes: ["st1", "st2"] }).split("\n");
    expect(lines[0]).toContain("5");
    expect(lines[1]).toContain("散挑一");
    expect(lines[2]).toContain("清");
    expect(lines[3]).toContain("st1");
  });

  it("没有歌词也没有码时仍是老的两行（不多出空行）", () => {
    const notes = [makeNote(), makeNote()];
    const lines = formatScoreAsText(notes).split("\n");
    expect(lines).toHaveLength(4); // 简谱 / 减字 / 空行 / 共 N 音
  });

  // 码尾时值：不标就没有节奏，粘回去整首谱被拍平成一串四分音符。
  // 这里的写法必须与 Rust `decode_batch_json` 的解析一致（verify-wasm 验那一侧）。
  it("annotateRhythm：每个码尾带时值，附点加 .", () => {
    const notes = [
      makeNote({ jianpuNumber: "5", duration: "八分", jianpuDot: true }),
      makeNote({ jianpuNumber: "6", duration: "全" }),
      makeNote({ jianpuNumber: "1", duration: "十六分" }),
      makeNote({ jianpuNumber: "2", duration: "二分" }),
    ];
    const line = formatScoreAsText(notes, {
      codes: ["st1", "st2", "st3", "st4"],
      annotateRhythm: true,
    }).split("\n")[2];
    expect(line).toContain("st1:8.");
    expect(line).toContain("st2:1");
    expect(line).toContain("st3:16");
    expect(line).toContain("st4:2");
  });

  it("annotateRhythm：休止符写 r（没有码，但占拍）", () => {
    const notes = [
      makeNote({ jianpuNumber: "0", duration: "二分" }),
      makeNote({ jianpuNumber: "5", duration: "四分" }),
    ];
    const line = formatScoreAsText(notes, {
      codes: [null, "st1"],
      annotateRhythm: true,
    }).split("\n")[2];
    expect(line).toContain("r:2");
    expect(line).toContain("st1:4");
  });

  it("annotateRhythm：编不出码的位置仍是 -，不伪造一个头顶替", () => {
    const notes = [makeNote({ jianpuNumber: "5", duration: "四分" })];
    const line = formatScoreAsText(notes, {
      codes: [null],
      annotateRhythm: true,
    }).split("\n")[2];
    expect(line.trim()).toBe("-");
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
