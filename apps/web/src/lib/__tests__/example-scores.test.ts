/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { EXAMPLE_SCORES, findExampleScore } from "../example-scores";
import { isComplete } from "../jianzi";

describe("example-scores", () => {
  it("contains at least one example", () => {
    expect(EXAMPLE_SCORES.length).toBeGreaterThan(0);
  });

  it("every example has a non-empty title and notes", () => {
    for (const score of EXAMPLE_SCORES) {
      expect(score.id).toBeTruthy();
      expect(score.title).toBeTruthy();
      expect(score.notes.length).toBeGreaterThan(0);
    }
  });

  it("every note has a complete jianzi state", () => {
    for (const score of EXAMPLE_SCORES) {
      for (const note of score.notes) {
        expect(isComplete(note.jianzi)).toBe(true);
      }
    }
  });

  it("findExampleScore returns the requested score", () => {
    const first = EXAMPLE_SCORES[0];
    expect(findExampleScore(first.id)).toBe(first);
    expect(findExampleScore("not-exist")).toBeUndefined();
  });

  it("花非花：主歌音符带歌词且前奏无词", () => {
    const score = findExampleScore("huafeihua");
    expect(score).toBeTruthy();
    const lyrics = score!.notes.map((n) => n.lyric ?? "");
    const withLyric = lyrics.filter(Boolean).length;
    expect(withLyric).toBeGreaterThan(20);
    // 前 10 音（引子+前奏）为器乐，无词
    expect(lyrics.slice(0, 10).every((l) => l === "")).toBe(true);
  });
});
