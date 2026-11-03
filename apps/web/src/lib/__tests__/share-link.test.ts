/**
 * 分享链接纯逻辑：解析 `?score=` 与构造直达链接。
 *
 * 重点覆盖 basePath（GitHub Pages 部署在 /taiyin-guqin 下）、
 * 已有 query/hash 的清理，以及空值 / 编码边界。
 */
import { describe, it, expect } from "vitest";
import { buildScoreShareUrl, readSharedScoreId } from "../share-link";

describe("readSharedScoreId", () => {
  it("取出 ?score= 的 id", () => {
    expect(readSharedScoreId("?score=abc-123")).toBe("abc-123");
  });

  it("没有 score 参数时返回 null", () => {
    expect(readSharedScoreId("")).toBeNull();
    expect(readSharedScoreId("?foo=1&bar=2")).toBeNull();
  });

  it("空串 / 纯空白视为没有", () => {
    expect(readSharedScoreId("?score=")).toBeNull();
    expect(readSharedScoreId("?score=%20%20")).toBeNull();
  });

  it("容忍与其它参数并存，并去掉首尾空白", () => {
    expect(readSharedScoreId("?a=1&score=%20xyz%20&b=2")).toBe("xyz");
  });
});

describe("buildScoreShareUrl", () => {
  it("保留 origin 与 basePath，只带 ?score=", () => {
    expect(buildScoreShareUrl("abc", "https://example.github.io/taiyin-guqin/")).toBe(
      "https://example.github.io/taiyin-guqin/?score=abc",
    );
  });

  it("清掉已有的 query 与 hash，避免把调试参数/锚点带进分享", () => {
    expect(buildScoreShareUrl("abc", "https://h/taiyin-guqin/?foo=1&x=2#bar")).toBe(
      "https://h/taiyin-guqin/?score=abc",
    );
  });

  it("id 做 URL 编码", () => {
    expect(buildScoreShareUrl("a b&c", "https://h/p/")).toBe("https://h/p/?score=a+b%26c");
  });

  it("无 href 且无 window 时退化为相对链接", () => {
    const url = buildScoreShareUrl("abc");
    expect(url).toMatch(/score=abc/);
  });
});
