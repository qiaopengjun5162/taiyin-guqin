/**
 * `isBackendUnreachable` 的判据边界。
 *
 * 这个函数决定「后端连不上时降级存本机」，所以它**错在两个方向都很难看**：
 * - 判宽了：真实缺陷（读 undefined 引发的 TypeError）被当成断网，错误被吞掉，
 *   用户以为存到本机了，其实什么都没存——2026-11-18 真踩过一次。
 * - 判窄了：断网时不敢降级，辛苦打的一段谱直接弹错误框。
 *
 * 之前只有 50% 行 / 30% 分支覆盖，等于「宽度」那一半没人守。这里按浏览器
 * 实际抛出的文案把边界钉死，并显式列出**不许**被判成断网的输入。
 *
 * 注意：四种「连不上」的文案分别来自 Chrome/Edge（Failed to fetch）、
 * Firefox（NetworkError）、Safari（Load failed）、React Native 壳（Network request failed），
 * 不是同一个浏览器里的四种情况——所以四条都得有。
 */
import { describe, it, expect } from "vitest";
import { isBackendUnreachable } from "@/lib/net-error";

describe("isBackendUnreachable · 该降级的", () => {
  it("超时（AbortError）算连不上：后端在但太慢，同样可以存本机", () => {
    expect(isBackendUnreachable(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it.each([
    ["Chrome / Edge", "Failed to fetch"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["Safari", "Load failed"],
    ["React Native 壳", "Network request failed"],
  ])("%s 的断网文案被判成连不上", (_browser, message) => {
    expect(isBackendUnreachable(new TypeError(message))).toBe(true);
  });

  it("文案大小写不影响判定（不同浏览器的首字母并不统一）", () => {
    expect(isBackendUnreachable(new TypeError("FAILED TO FETCH"))).toBe(true);
  });
});

describe("isBackendUnreachable · 不该降级的", () => {
  it("读 undefined 引发的 TypeError 是代码 bug，必须原样抛出去", () => {
    // 这条是 2026-11-18 的事故回放：判据曾写成「instanceof TypeError 即断网」，
    // 测试替身返回 undefined 触发的 TypeError 被吞成「网络问题」。
    const bug = new TypeError("Cannot read properties of undefined (reading 'id')");
    expect(isBackendUnreachable(bug)).toBe(false);
  });

  it("空的 TypeError 不算断网（没有文案就没有证据）", () => {
    expect(isBackendUnreachable(new TypeError(""))).toBe(false);
  });

  it("普通 Error 即便文案像断网也不算：只认 TypeError，不加宽", () => {
    expect(isBackendUnreachable(new Error("Failed to fetch"))).toBe(false);
  });

  it("非 Abort 的 DOMException 不算断网", () => {
    expect(isBackendUnreachable(new DOMException("quota", "QuotaExceededError"))).toBe(false);
  });

  it("只是长得像 AbortError 的对象不算：必须真是 DOMException 实例", () => {
    expect(isBackendUnreachable({ name: "AbortError", message: "aborted" })).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["字符串", "Failed to fetch"],
    ["数字", 404],
  ])("非错误值（%s）不算断网", (_label, value) => {
    expect(isBackendUnreachable(value)).toBe(false);
  });
});
