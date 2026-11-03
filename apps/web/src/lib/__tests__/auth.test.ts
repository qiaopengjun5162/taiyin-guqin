import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const KEY = "taiyin.session";

/** jsdom 原生的 localStorage：隐私模式用例会整体替换它，用完必须还回去。 */
const realLocalStorage = window.localStorage;

/** 存一个会话对象；刻意不经过被测代码，避免「自己写自己读」的自证循环。 */
function seed(value: unknown) {
  window.localStorage.setItem(KEY, JSON.stringify(value));
}

beforeEach(() => {
  // 被测模块有进程内兜底状态（memorySession / snapshot），
  // 不重置会让「未登录返回 null」这类断言受上个用例污染。
  vi.resetModules();
  window.localStorage.clear();
});

afterEach(() => {
  // 先还原存储再清理：隐私模式用例把 localStorage 换成了没有 clear() 的替身
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: realLocalStorage,
  });
  window.localStorage.clear();
});

describe("auth: 登录态读写", () => {
  it("未登录返回 null", async () => {
    const { getStoredSession, getSessionToken, getCurrentUserId } = await import("@/lib/auth");
    expect(getStoredSession()).toBeNull();
    expect(getSessionToken()).toBe("");
    expect(getCurrentUserId()).toBeNull();
  });

  it("登录后能读出 token 与用户，登出即清空", async () => {
    const { setStoredSession, getStoredSession, getSessionToken, getCurrentUserId } =
      await import("@/lib/auth");
    setStoredSession({
      token: "tok-1",
      user: { id: "u-1", email: "a@b.com", display_name: "张琴友" },
    });

    expect(getSessionToken()).toBe("tok-1");
    expect(getCurrentUserId()).toBe("u-1");
    expect(window.localStorage.getItem(KEY)).toContain("tok-1");

    setStoredSession(null);
    expect(getStoredSession()).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  /**
   * 坏数据一律当未登录。
   *
   * localStorage 是用户可改、旧版本也可能留下残缺对象的地方；
   * 与其让后面每个调用点各自判空，不如在入口一次性挡掉。
   */
  it("存储里的坏数据当作未登录（不抛错）", async () => {
    const { getStoredSession } = await import("@/lib/auth");

    window.localStorage.setItem(KEY, "{not json");
    expect(getStoredSession()).toBeNull();

    seed({ token: "tok", user: { email: "a@b.com" } }); // 缺 user.id
    expect(getStoredSession()).toBeNull();

    seed({ token: "", user: { id: "u" } }); // 空 token
    expect(getStoredSession()).toBeNull();

    seed({ user: { id: "u" } }); // 无 token
    expect(getStoredSession()).toBeNull();
  });

  it("缺昵称 / 邮箱时不报错（可选字段兜底为空串）", async () => {
    const { setStoredSession, getStoredSession } = await import("@/lib/auth");
    seed({ token: "t", user: { id: "u" } });
    const s = getStoredSession();
    expect(s?.user.email).toBe("");
    expect(s?.user.display_name).toBe("");
    setStoredSession(null);
  });

  it("没有昵称时用邮箱显示", async () => {
    const { displayNameOf } = await import("@/lib/auth");
    expect(displayNameOf({ id: "u", email: "a@b.com", display_name: "" })).toBe("a@b.com");
    expect(displayNameOf({ id: "u", email: "a@b.com", display_name: "琴友" })).toBe("琴友");
  });

  it("登录 / 登出会通知订阅者（界面靠它自动刷新）", async () => {
    const { setStoredSession, subscribeSession } = await import("@/lib/auth");
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);

    setStoredSession({ token: "t", user: { id: "u", email: "a@b.com", display_name: "" } });
    expect(listener).toHaveBeenCalledTimes(1);

    setStoredSession(null);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setStoredSession({ token: "t2", user: { id: "u", email: "a@b.com", display_name: "" } });
    expect(listener).toHaveBeenCalledTimes(2); // 退订后不再收到
    setStoredSession(null);
  });

  it("存储被禁（隐私模式）时退回内存，本次会话内登录态稳定", async () => {
    // 整体换成会抛错的替身；还原由 afterEach 负责（那里存了原生 localStorage）
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });

    const { setStoredSession, getSessionToken } = await import("@/lib/auth");
    setStoredSession({ token: "mem-tok", user: { id: "u", email: "a@b.com", display_name: "" } });
    expect(getSessionToken()).toBe("mem-tok");
    setStoredSession(null); // 清掉进程内兜底，避免污染后续用例
  });
});
