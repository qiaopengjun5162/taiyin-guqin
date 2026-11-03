import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getStoredApiBase,
  setStoredApiBase,
  clearStoredApiBase,
  subscribeApiBase,
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
