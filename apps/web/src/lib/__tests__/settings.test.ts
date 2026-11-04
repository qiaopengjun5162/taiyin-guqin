import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getStoredApiBase,
  setStoredApiBase,
  clearStoredApiBase,
  subscribeApiBase,
  getStoredAuthor,
  setStoredAuthor,
  subscribeSettings,
  getServerApiBaseSnapshot,
  getServerAuthorSnapshot,
  MAX_AUTHOR_LENGTH,
} from "@/lib/settings";

describe("settings: 后端地址运行时配置", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("默认未配置时返回 null", () => {
    expect(getStoredApiBase()).toBeNull();
  });

  it("set 后可读回，且去掉首尾空白与结尾斜杠", () => {
    setStoredApiBase("https://guqin.example.com/");
    expect(getStoredApiBase()).toBe("https://guqin.example.com");
    setStoredApiBase("  https://x.test/  ");
    expect(getStoredApiBase()).toBe("https://x.test");
  });

  it("clear 后回到 null", () => {
    setStoredApiBase("https://guqin.example.com");
    clearStoredApiBase();
    expect(getStoredApiBase()).toBeNull();
  });

  it("空白值等价于清除", () => {
    setStoredApiBase("https://guqin.example.com");
    setStoredApiBase("   ");
    expect(getStoredApiBase()).toBeNull();
  });

  it("设置变更会通知订阅者，取消订阅后不再通知", () => {
    const listener = vi.fn();
    const unsub = subscribeApiBase(listener);
    setStoredApiBase("https://guqin.example.com");
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    setStoredApiBase("https://other.test");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("localStorage 读取抛错时不崩溃，退回 null", () => {
    const spy = vi.spyOn(window.localStorage, "getItem");
    spy.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getStoredApiBase()).toBeNull();
    spy.mockRestore();
  });
});

describe("settings: 打谱人署名", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("默认空串（匿名）", () => {
    expect(getStoredAuthor()).toBe("");
  });

  it("set 后可读回，并去掉首尾空白", () => {
    setStoredAuthor("  张百忍  ");
    expect(getStoredAuthor()).toBe("张百忍");
    expect(window.localStorage.getItem("taiyin.author")).toBe("张百忍");
  });

  it("按字符截断到上限，不把汉字截成半个", () => {
    setStoredAuthor("琴".repeat(MAX_AUTHOR_LENGTH + 5));
    const saved = getStoredAuthor();
    expect(Array.from(saved)).toHaveLength(MAX_AUTHOR_LENGTH);
    // 截断后仍是合法汉字，没有出现 U+FFFD 替换符
    expect(saved).not.toContain("\uFFFD");
  });

  it("只输入空白等价于清空（回到匿名）", () => {
    setStoredAuthor("张百忍");
    setStoredAuthor("   ");
    expect(getStoredAuthor()).toBe("");
    expect(window.localStorage.getItem("taiyin.author")).toBeNull();
  });

  it("读取抛错时不崩溃，退回空串", () => {
    const spy = vi.spyOn(window.localStorage, "getItem");
    spy.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getStoredAuthor()).toBe("");
    spy.mockRestore();
  });

  it("修改署名会通知订阅者", () => {
    const listener = vi.fn();
    const unsub = subscribeSettings(listener);
    setStoredAuthor("张三");
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    setStoredAuthor("李四");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("settings: 服务端 / 水合快照", () => {
  // SSR 与首帧客户端必须拿到同一个值，否则 React 会报 hydration mismatch，
  // 表现为整块设置面板重渲染、用户刚填的地址「闪一下又变回去」。
  it("恒为初始值：后端地址 null、署名空串", () => {
    expect(getServerApiBaseSnapshot()).toBeNull();
    expect(getServerAuthorSnapshot()).toBe("");
  });
});
