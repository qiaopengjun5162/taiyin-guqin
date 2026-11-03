import { describe, it, expect } from "vitest";
import type { NoteColumn } from "@/lib/types";
import { createEmptyState } from "@/lib/jianzi";
import { scoreFingerprint } from "@/lib/unsaved-guard";

function makeNote(overrides: Partial<NoteColumn> = {}): NoteColumn {
  return {
    id: "note-1",
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: createEmptyState(),
    ...overrides,
  };
}

const EMPTY = scoreFingerprint("未命名曲谱", [], "zhengdiao");

describe("scoreFingerprint", () => {
  it("空谱指纹稳定：同样输入得同样结果", () => {
    expect(scoreFingerprint("未命名曲谱", [], "zhengdiao")).toBe(EMPTY);
  });

  it("新增音符会改变指纹", () => {
    expect(scoreFingerprint("未命名曲谱", [makeNote()], "zhengdiao")).not.toBe(EMPTY);
  });

  it("改标题会改变指纹", () => {
    expect(scoreFingerprint("平沙落雁", [], "zhengdiao")).not.toBe(EMPTY);
  });

  it("改定弦会改变指纹（紧五弦差半音，属于曲谱属性）", () => {
    expect(scoreFingerprint("未命名曲谱", [], "ruibin")).not.toBe(EMPTY);
  });

  it("忽略 id：删掉一列再加回内容相同的一列不算改动", () => {
    const a = scoreFingerprint("x", [makeNote({ id: "a" })], "zhengdiao");
    const b = scoreFingerprint("x", [makeNote({ id: "b" })], "zhengdiao");
    expect(a).toBe(b);
  });

  it("忽略 jianzi 的键序：服务器返回的 JSON 与本地产出等价", () => {
    const local = makeNote({ jianzi: { ...createEmptyState(), leftFinger: "大", hui: "七" } });
    // 模拟从接口反序列化：键序被打乱，值完全一样
    const fromServer = {
      ...local,
      jianzi: Object.fromEntries(
        Object.entries(local.jianzi).reverse(),
      ) as NoteColumn["jianzi"],
    };
    expect(scoreFingerprint("x", [fromServer], "zhengdiao")).toBe(
      scoreFingerprint("x", [local], "zhengdiao"),
    );
  });

  it("减字里任一字段变化都能检出", () => {
    const base = scoreFingerprint("x", [makeNote()], "zhengdiao");
    const changed = scoreFingerprint(
      "x",
      [makeNote({ jianzi: { ...createEmptyState(), rightAction: "勾" } })],
      "zhengdiao",
    );
    expect(changed).not.toBe(base);
  });

  it("歌词变化能检出（歌词按字对齐，也算内容）", () => {
    const base = scoreFingerprint("x", [makeNote()], "zhengdiao");
    expect(scoreFingerprint("x", [makeNote({ lyric: "沧" })], "zhengdiao")).not.toBe(base);
    // 缺省 undefined 与空串视为同一件事
    expect(scoreFingerprint("x", [makeNote({ lyric: undefined })], "zhengdiao")).toBe(base);
  });

  it("音符顺序变化会改变指纹（顺序就是旋律）", () => {
    const a = scoreFingerprint("x", [makeNote({ id: "1" }), makeNote({ id: "2", jianpuNumber: "6" })], "zhengdiao");
    const b = scoreFingerprint("x", [makeNote({ id: "2", jianpuNumber: "6" }), makeNote({ id: "1" })], "zhengdiao");
    expect(a).not.toBe(b);
  });
});
