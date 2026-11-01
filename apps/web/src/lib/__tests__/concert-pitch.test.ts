import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONCERT_PITCH_DEFAULT,
  CONCERT_PITCH_MAX,
  CONCERT_PITCH_MIN,
  clampConcertPitch,
  getConcertPitch,
  getServerConcertPitch,
  resetConcertPitchCache,
  setConcertPitch,
  subscribeConcertPitch,
} from "../concert-pitch";

const KEY = "taiyin.concertPitch.v1";

describe("clampConcertPitch", () => {
  it("范围内原值返回（取整）", () => {
    expect(clampConcertPitch(425)).toBe(425);
    expect(clampConcertPitch(425.6)).toBe(426);
  });

  it("越界夹紧到上下限", () => {
    expect(clampConcertPitch(300)).toBe(CONCERT_PITCH_MIN);
    expect(clampConcertPitch(500)).toBe(CONCERT_PITCH_MAX);
  });

  it("非数字退回标准音高", () => {
    expect(clampConcertPitch(Number.NaN)).toBe(CONCERT_PITCH_DEFAULT);
    expect(clampConcertPitch(Number.POSITIVE_INFINITY)).toBe(CONCERT_PITCH_DEFAULT);
  });
});

describe("基准音持久化", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetConcertPitchCache();
  });

  it("默认 440", () => {
    expect(getConcertPitch()).toBe(440);
  });

  it("读取已存储的值", () => {
    window.localStorage.setItem(KEY, "430");
    resetConcertPitchCache();
    expect(getConcertPitch()).toBe(430);
  });

  it("存储值损坏时退回默认，不让播放崩掉", () => {
    window.localStorage.setItem(KEY, "abc");
    resetConcertPitchCache();
    expect(getConcertPitch()).toBe(CONCERT_PITCH_DEFAULT);
  });

  it("写入后即刻可读，并落盘", () => {
    expect(setConcertPitch(415)).toBe(415);
    expect(getConcertPitch()).toBe(415);
    expect(window.localStorage.getItem(KEY)).toBe("415");
  });

  it("写入越界值会被夹紧后再落盘", () => {
    setConcertPitch(999);
    expect(window.localStorage.getItem(KEY)).toBe(String(CONCERT_PITCH_MAX));
  });

  it("服务端快照恒为标准音高（避免水合不一致）", () => {
    setConcertPitch(400);
    expect(getServerConcertPitch()).toBe(CONCERT_PITCH_DEFAULT);
  });

  it("变更会通知订阅者，取消订阅后不再通知", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConcertPitch(listener);

    setConcertPitch(420);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setConcertPitch(430);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("localStorage 抛错时仍能在会话内生效", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(setConcertPitch(412)).toBe(412);
      expect(getConcertPitch()).toBe(412);
    } finally {
      spy.mockRestore();
    }
  });
});
