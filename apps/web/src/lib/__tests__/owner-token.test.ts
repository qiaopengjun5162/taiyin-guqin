/**
 * 所有权凭证：本机发布者的「密码」。
 *
 * 它决定两件事——服务端认不认你能改删；本机保存时是更新还是新建。
 * 所以稳定性是硬要求：同一次会话里连取两次必须是同一个值，
 * 否则第一次发布带 A、第二次改带 B，服务端 403，用户会以为功能坏了。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOwnerToken,
  rememberMyScore,
  forgetMyScore,
  isMyScore,
  resetOwnerTokenCache,
} from "@/lib/owner-token";

const TOKEN_KEY = "taiyin.ownerToken";
const IDS_KEY = "taiyin.myScoreIds";

describe("owner-token · 凭证", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetOwnerTokenCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("首次调用生成并持久化，同一会话内保持稳定", () => {
    const first = getOwnerToken();
    expect(first).not.toBe("");
    expect(getOwnerToken()).toBe(first);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe(first);
  });

  it("已存在凭证时直接复用（换页面不换身份）", () => {
    window.localStorage.setItem(TOKEN_KEY, "existing-token");
    expect(getOwnerToken()).toBe("existing-token");
  });

  it("存储被禁时退回进程内凭证，仍保证本次会话稳定", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const first = getOwnerToken();
    expect(first).not.toBe("");
    expect(getOwnerToken()).toBe(first);
  });
});

describe("owner-token · 我发布的谱", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetOwnerTokenCache();
  });

  it("记住后可查，重复记住不产生重复项", () => {
    rememberMyScore("a");
    rememberMyScore("a");
    expect(isMyScore("a")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(IDS_KEY) ?? "[]")).toEqual(["a"]);
  });

  it("未记住的 id 判为不是我的", () => {
    expect(isMyScore("nope")).toBe(false);
  });

  it("删除后不再是我的", () => {
    rememberMyScore("a");
    forgetMyScore("a");
    expect(isMyScore("a")).toBe(false);
  });

  it("空 id 不写入（避免脏数据）", () => {
    rememberMyScore("");
    expect(window.localStorage.getItem(IDS_KEY)).toBeNull();
  });

  it("存储里是坏 JSON 时当作没有记录，不抛错", () => {
    window.localStorage.setItem(IDS_KEY, "{not json");
    expect(isMyScore("a")).toBe(false);
    // 仍能继续记录（覆盖坏值）
    rememberMyScore("b");
    expect(isMyScore("b")).toBe(true);
  });
});

/**
 * 随机源降级：老浏览器 / 非安全上下文可能没有 `crypto.randomUUID`。
 * 任何一层缺失都必须还能生成「非空且稳定」的凭证——否则发布直接 401/403。
 */
describe("owner-token · 随机源降级", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetOwnerTokenCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("无 randomUUID 时用 getRandomValues 生成十六进制串", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      },
    });

    expect(getOwnerToken()).toBe("ab".repeat(16));
  });

  it("连 getRandomValues 都没有时仍生成非空凭证", () => {
    vi.stubGlobal("crypto", {});

    const token = getOwnerToken();

    expect(token).not.toBe("");
    expect(token).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});
