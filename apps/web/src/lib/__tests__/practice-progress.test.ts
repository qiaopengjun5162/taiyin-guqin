/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TEMPO_LADDER,
  clearedCount,
  isCleared,
  nearestTempo,
  nextTempo,
  nextUnclearedIndex,
  readProgress,
  recordTempo,
  scoreProgressKey,
  writeProgress,
  type PhraseProgress,
} from "../practice-progress";

const KEY = scoreProgressKey(null, "花非花", 12);

describe("档位", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("等距 0.1：再快一档永远指同一件事", () => {
    expect(TEMPO_LADDER).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    for (let i = 1; i < TEMPO_LADDER.length; i++) {
      expect(TEMPO_LADDER[i] - TEMPO_LADDER[i - 1]).toBeCloseTo(0.1, 6);
    }
  });

  it("下一档从第一个更大的算起——旧数据 0.75 要跳 0.8，不能退回 0.7", () => {
    expect(nextTempo(0.6)).toBe(0.7);
    expect(nextTempo(0.75)).toBe(0.8);
    expect(nextTempo(1)).toBeNull();
    expect(nextTempo(1.2)).toBeNull();
  });

  it("1× 才算到原速", () => {
    expect(isCleared(1)).toBe(true);
    expect(isCleared(0.99)).toBe(false);
    expect(isCleared(0)).toBe(false);
  });

  it("把旧倍率吸附回档位", () => {
    expect(nearestTempo(0.74)).toBe(0.7);
    expect(nearestTempo(0.76)).toBe(0.8);
    expect(nearestTempo(3)).toBe(1);
  });
});

describe("谱的身份", () => {
  it("社区 id 优先，没有就用 local；曲名两端空格不算数", () => {
    expect(scoreProgressKey("abc", "花非花", 12)).toBe("abc|花非花|12");
    expect(scoreProgressKey(null, " 花非花 ", 12)).toBe("local|花非花|12");
  });

  it("音数变了就是另一份进度——谱改了，旧成绩不许挂在新的句上", () => {
    expect(scoreProgressKey(null, "花非花", 12)).not.toBe(
      scoreProgressKey(null, "花非花", 13),
    );
  });
});

describe("读写", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("没记过等于空", () => {
    expect(readProgress(KEY)).toEqual({});
  });

  it("存进去能读回来", () => {
    writeProgress(KEY, { "0-3-4": 0.8 });
    expect(readProgress(KEY)).toEqual({ "0-3-4": 0.8 });
  });

  it("内容坏了当没练过，而不是抛错让页面白屏", () => {
    window.localStorage.setItem(`taiyin.practiceProgress.v1:${KEY}`, "not json");
    expect(readProgress(KEY)).toEqual({});
    window.localStorage.setItem(`taiyin.practiceProgress.v1:${KEY}`, "[1,2]");
    expect(readProgress(KEY)).toEqual({});
    window.localStorage.setItem(
      `taiyin.practiceProgress.v1:${KEY}`,
      JSON.stringify({ good: 0.6, bad: "0.8", zero: 0, nan: null }),
    );
    expect(readProgress(KEY)).toEqual({ good: 0.6 });
  });
});

describe("记录成绩", () => {
  it("只升不降：今天手冷没走到 0.8×，不该把昨天的记录抹掉", () => {
    const first = recordTempo({}, "s1", 0.8);
    expect(recordTempo(first, "s1", 0.6)).toBe(first); // 没变就返回同一个对象
    expect(recordTempo(first, "s1", 0.9)).toEqual({ s1: 0.9 });
  });

  it("没过原速的句子不计数，过了一起算", () => {
    const progress: PhraseProgress = { a: 1, b: 0.9, c: 1 };
    expect(clearedCount(["a", "b", "c"], progress)).toBe(2);
  });

  it("下一句从谱面顺序里找第一个没过的；全过了就没有下一句", () => {
    expect(nextUnclearedIndex(["a", "b", "c"], { a: 1, b: 0.7, c: 1 })).toBe(1);
    expect(nextUnclearedIndex(["a", "b"], { a: 1, b: 1 })).toBeNull();
    expect(nextUnclearedIndex([], {})).toBeNull();
  });
});
