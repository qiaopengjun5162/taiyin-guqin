import { describe, it, expect } from "vitest";
import {
  jianziSignature,
  findConcordance,
  countScores,
  type ConcordanceScore,
} from "../score-concordance";
import type { JianziState, NoteColumn } from "../types";

function state(partial: Partial<JianziState>): JianziState {
  return {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: null,
    stringNumber: null,
    ...partial,
  };
}

/** 大九六勾四：最常用的按音写法（键盘里右手指法是偏旁「勹」）。 */
const AN = state({
  toneType: "按",
  leftFinger: "大",
  hui: "九",
  fen: "六分",
  rightAction: "勹",
  stringNumber: "四",
});

function note(jianzi: JianziState): NoteColumn {
  return {
    id: `n-${Math.random().toString(36).slice(2)}`,
    jianpuNumber: "1",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi,
  };
}

function score(
  id: string,
  title: string,
  notes: NoteColumn[],
  phrases: Array<{ start: number; end: number }> = [],
  source: "示例" | "我的" = "示例",
): ConcordanceScore {
  return { id, title, source, notes, phrases };
}

describe("jianziSignature", () => {
  it("把完整谱字编成稳定字符串", () => {
    expect(jianziSignature(AN)).toBe("按|大指|九|六分|-|勾|四");
  });

  it("忽略弦号时与带弦号的键不同", () => {
    expect(jianziSignature(AN, { ignoreString: true })).toBe("按|大指|九|六分|-|勾");
    expect(jianziSignature(AN, { ignoreString: true })).not.toBe(jianziSignature(AN));
  });

  it("偏旁与全字归一成同一个键", () => {
    const handwritten = { ...AN, rightAction: "勾" };
    expect(jianziSignature(handwritten)).toBe(jianziSignature(AN));
    const pi = { ...AN, rightAction: "劈" };
    const shi = { ...AN, rightAction: "尸" };
    expect(jianziSignature(pi)).toBe(jianziSignature(shi));
  });

  it("左手全字与偏旁同样归一", () => {
    const full = { ...AN, leftFinger: "大指" };
    expect(jianziSignature(full)).toBe(jianziSignature(AN));
  });

  it("缺音色或缺右手指法时不给键", () => {
    expect(jianziSignature(state({ rightAction: "勹" }))).toBeNull();
    expect(jianziSignature(state({ toneType: "按" }))).toBeNull();
  });

  it("节奏模式不进键（板/散/宕不改这个字怎么写）", () => {
    expect(jianziSignature({ ...AN, rhythmMode: "散" })).toBe(jianziSignature(AN));
  });

  it("走手音进键（绰不绰是两种弹法）", () => {
    expect(jianziSignature({ ...AN, slide: "绰" })).not.toBe(jianziSignature(AN));
  });
});

describe("findConcordance", () => {
  it("找到同一个字，并给出句号", () => {
    const target = score("s1", "良宵引", [note(AN), note(AN), note(AN)], [
      { start: 0, end: 1 },
      { start: 2, end: 2 },
    ]);
    const hits = findConcordance(AN, [target]);
    expect(hits).toHaveLength(3);
    expect(hits.map((hit) => hit.phraseIndex)).toEqual([0, 0, 1]);
    expect(hits.every((hit) => hit.kind === "exact")).toBe(true);
    expect(hits[0]?.title).toBe("良宵引");
  });

  it("没切句时句号是 null，不猜", () => {
    const hits = findConcordance(AN, [score("s1", "良宵引", [note(AN)])]);
    expect(hits[0]?.phraseIndex).toBeNull();
  });

  it("严匹配有结果时，不把换了弦的混进来", () => {
    const other = { ...AN, stringNumber: "二" };
    const hits = findConcordance(AN, [
      score("s1", "甲", [note(other), note(AN)]),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("exact");
    expect(hits[0]?.index).toBe(1);
  });

  it("严匹配为空时退到宽匹配，并标成 loose", () => {
    const other = { ...AN, stringNumber: "二" };
    const hits = findConcordance(AN, [score("s1", "甲", [note(other)])]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("loose");
  });

  it("弦号还没选时直接走宽匹配", () => {
    const noString = { ...AN, stringNumber: null };
    const hits = findConcordance(noString, [
      score("s1", "甲", [note({ ...AN, stringNumber: "二" })]),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("loose");
  });

  it("半截字不查", () => {
    expect(findConcordance(state({ toneType: "按" }), [
      score("s1", "甲", [note(AN)]),
    ])).toEqual([]);
  });

  it("空曲库给空结果", () => {
    expect(findConcordance(AN, [])).toEqual([]);
  });

  it("按 limit 截断", () => {
    const notes = Array.from({ length: 10 }, () => note(AN));
    expect(findConcordance(AN, [score("s1", "甲", notes)], { limit: 3 })).toHaveLength(3);
  });

  it("跨曲谱命中，countScores 数的是曲谱数", () => {
    const hits = findConcordance(AN, [
      score("s1", "甲", [note(AN), note(AN)]),
      score("s2", "乙", [note(AN)], [], "我的"),
    ]);
    expect(hits).toHaveLength(3);
    expect(countScores(hits)).toBe(2);
    expect(hits.some((hit) => hit.source === "我的")).toBe(true);
  });
});
