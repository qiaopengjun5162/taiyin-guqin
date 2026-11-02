/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { EXAMPLE_SCORES, findExampleScore } from "../example-scores";
import { isComplete } from "../jianzi";
import { jianziToFrequency, jianziToJianpu } from "../jianzi-pitch";

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

  /**
   * 示例谱同时写了「简谱数字」与「减字」——两者描述同一个音，必须一致。
   *
   * 历史上就因为基准按 1=F1 记（整谱低一个八度）、外加几条指法根本出不了
   * 标注的那个音，导致界面写 6、弹出来是 5，错得毫无提示。
   * 这里钉成硬约束：以后加曲子或调指法，跑一次就知道哪条对不上。
   */
  describe("简谱标注与减字同源", () => {
    const OCTAVE_SEMITONES: Record<string, number> = {
      "": 0, "·": 12, "··": 24, ",": -12, ",,": -24,
    };
    const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

    for (const score of EXAMPLE_SCORES) {
      it(`${score.title}：每条减字都出得了标注的音`, () => {
        const problems: string[] = [];
        score.notes.forEach((note, i) => {
          if (!note.jianzi) return;
          const derived = jianziToJianpu(note.jianzi);
          if (!derived) {
            problems.push(`#${i} 减字推算不出音高`);
            return;
          }
          if (derived.number !== note.jianpuNumber || derived.octave !== note.jianpuOctave) {
            problems.push(
              `#${i} 标注 ${note.jianpuNumber}${note.jianpuOctave}，减字实际 ${derived.number}${derived.octave}`,
            );
            return;
          }
          // 记号相同还不够：徽位是纯律，可能落在两个记号之间。
          // 偏差超过三分之一半音（30 音分）说明这个指法并不真在这个音上。
          const freq = jianziToFrequency(note.jianzi);
          if (freq == null) return;
          const target =
            41 +
            DEGREE_SEMITONES[Number(note.jianpuNumber) - 1] +
            (OCTAVE_SEMITONES[note.jianpuOctave] ?? 0);
          const midi = 69 + 12 * Math.log2(freq / 440);
          const gap = Math.abs(midi - target);
          if (gap > 0.3) {
            problems.push(`#${i} 音高偏 ${(gap * 100).toFixed(0)} 音分`);
          }
        });
        expect(problems).toEqual([]);
      });
    }
  });
});
