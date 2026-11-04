import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 账号链路的 API 层测试。
 *
 * 重点不是「请求发出去了」，而是**钥匙有没有带对**——
 * 账号这条腿接没接上，全看请求头里有没有 Bearer；认领能不能成功，
 * 全看 Bearer 和 x-owner-token 是不是同时都在。这两件事错了，
 * 服务端一律 403，而界面上只显示一句「操作失败」，极难定位。
 */

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "",
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

const USER = { id: "u-1", email: "qin@you.com", display_name: "张琴友" };

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("api: 注册 / 登录 / 登出", () => {
  it("注册：POST 到 /auth/register，成功后记住会话", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    fetchMock.mockResolvedValue(jsonResponse({ user: USER, token: "tok-1" }));

    await api.registerAccount("qin@you.com", "longenough", "张琴友");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/register");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({
      email: "qin@you.com",
      password: "longenough",
      display_name: "张琴友",
    });
    expect(auth.getSessionToken()).toBe("tok-1");
  });

  it("登录：POST 到 /auth/login 并记住会话；不填昵称就不传该字段", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    fetchMock.mockResolvedValue(jsonResponse({ user: USER, token: "tok-2" }));

    await api.loginAccount("qin@you.com", "longenough");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/login");
    expect(JSON.parse(options.body).display_name).toBeUndefined();
    expect(auth.getSessionToken()).toBe("tok-2");
  });

  it("登录失败：不吞掉后端原话（后端刻意不区分邮箱不存在与口令错）", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "邮箱或口令不对" }, { status: 401 }),
    );

    await expect(api.loginAccount("a@b.com", "wrong")).rejects.toThrow("邮箱或口令不对");
    expect(auth.getSessionToken()).toBe(""); // 失败不该留下半个登录态
  });

  /**
   * 登出必须「网络失败也照样清本地」。
   * 后端一挂就把用户困在已登录状态里出不来，是最难受的一类 bug。
   */
  it("登出：后端报错也要清掉本地登录态", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "tok", user: USER });
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(api.logoutAccount()).rejects.toThrow("network down");
    expect(auth.getStoredSession()).toBeNull();
  });

  it("登出：带上 Bearer 让服务端能删掉会话行", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "tok-del", user: USER });
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.logoutAccount();

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer tok-del");
  });
});

describe("api: 会话校验", () => {
  it("未登录时 /auth/me 不发请求", async () => {
    const api = await import("@/lib/api");
    await expect(api.fetchCurrentUser()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * 会话过期 / 被别处吊销时后端返回 401。
   * 这里必须顺手清掉本地登录态——否则界面一直显示「已登录」，
   * 用户一点保存却收到 403，完全不知道发生了什么。
   */
  it("会话失效（401）时清掉本地登录态", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "expired", user: USER });
    fetchMock.mockResolvedValue(jsonResponse({ error: "未登录或登录已过期" }, { status: 401 }));

    await expect(api.fetchCurrentUser()).resolves.toBeNull();
    expect(auth.getStoredSession()).toBeNull();
  });

  it("会话有效时返回当前用户", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "ok", user: USER });
    fetchMock.mockResolvedValue(jsonResponse(USER));

    await expect(api.fetchCurrentUser()).resolves.toEqual(USER);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer ok");
  });
});

describe("api: 账号即所有权", () => {
  /** 登录后发布的谱要带上 Bearer——服务端靠它把谱记到账号名下。 */
  it("登录后发布：请求头同时带 Bearer 与本机凭证", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "tok-pub", user: USER });
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "s1", title: "流水", notes: [], tuning: "zhengdiao" }),
    );

    await api.createScore("流水", []);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer tok-pub");
    expect(options.headers["x-owner-token"]).toBeTruthy();
  });

  /** 没登录时行为不变：只带本机凭证，不能因为加了账号就破坏老路径。 */
  it("未登录时发布：只带本机凭证（老路径不受影响）", async () => {
    const api = await import("@/lib/api");
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "s1", title: "流水", notes: [], tuning: "zhengdiao" }),
    );

    await api.createScore("流水", []);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers["x-owner-token"]).toBeTruthy();
  });

  /**
   * 认领必须两把钥匙都在：登录态（证明你是谁）+ 原凭证（证明这首谱当初是你发的）。
   * 少了凭证，任何人注册一下就能把别人的谱认领走。
   */
  it("认领旧谱：同时带登录态与原凭证", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "tok-claim", user: USER });
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "s9", title: "平沙", tuning: "zhengdiao", owner_user_id: "u-1" }),
    );

    const claimed = await api.claimScore("s9");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/scores/s9/claim");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer tok-claim");
    expect(options.headers["x-owner-token"]).toBeTruthy();
    expect(claimed.owner_user_id).toBe("u-1");
  });
});

describe("api: 收藏跟账号走", () => {
  /**
   * 收藏必须是登录态下的操作：服务端没登录直接 401。
   * 这里盯的是「请求有没有带 Bearer」——少带这条腿，界面点星星必然失败。
   */
  it("收藏：PUT 到该谱的 favorite 子路径，并带登录态", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "tok-fav", user: USER });
    fetchMock.mockResolvedValue(jsonResponse({ favorited: true }));

    await api.favoriteScore("s1");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/scores/s1/favorite");
    expect(options.method).toBe("PUT");
    expect(options.headers.Authorization).toBe("Bearer tok-fav");
  });

  it("取消收藏：同一路径用 DELETE（服务端靠方法区分，别新开一个 /unfavorite）", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    auth.setStoredSession({ token: "tok-unfav", user: USER });
    fetchMock.mockResolvedValue(jsonResponse({ favorited: false }));

    await api.unfavoriteScore("s1");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/scores/s1/favorite");
    expect(options.method).toBe("DELETE");
    expect(options.headers.Authorization).toBe("Bearer tok-unfav");
  });

  /** 后端少给 `ids` 字段时退化成空数组：让界面画不出星标，而不是崩在 `.map` 上。 */
  it("收藏 id 集合：正常解析；字段缺失时退化为空数组", async () => {
    const api = await import("@/lib/api");

    fetchMock.mockResolvedValueOnce(jsonResponse({ ids: ["a", "b"] }));
    await expect(api.listFavoriteIds()).resolves.toEqual(["a", "b"]);

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(api.listFavoriteIds()).resolves.toEqual([]);
  });

  /** 收藏列表也要分页：总数在响应头里，读不到就会一直显示「加载更多」。 */
  it("我的收藏分页：解析 x-total-count", async () => {
    const api = await import("@/lib/api");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "",
      headers: new Headers({ "x-total-count": "7" }),
      json: async () => [
        {
          id: "s1",
          title: "流水",
          tuning: "zhengdiao",
          created_at: "2026-11-01T00:00:00Z",
          updated_at: "2026-11-01T00:00:00Z",
        },
      ],
    } as unknown as Response);

    const page = await api.listFavoritesPage({ limit: 50, offset: 0 });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/favorites?limit=50&offset=0");
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(7);
  });
});

describe("api: 找回口令", () => {
  it("申请找回：POST /auth/forgot-password，不留下登录态", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.requestPasswordReset("qin@you.com");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/forgot-password");
    expect(JSON.parse(options.body)).toEqual({ email: "qin@you.com" });
    // 找回 ≠ 登录：接口只寄信，不产生会话
    expect(auth.getSessionToken()).toBe("");
  });

  it("凭令牌重置：POST /auth/reset-password，成功后也不自动登录", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.resetPasswordWithToken("tok-abc", "brand-new-5678");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/reset-password");
    expect(JSON.parse(options.body)).toEqual({
      token: "tok-abc",
      new_password: "brand-new-5678",
    });
    // 改密后旧会话都被踢，服务端也不发新会话——用户用新口令正常登录
    expect(auth.getSessionToken()).toBe("");
  });
});

describe("api: 找回口令", () => {
  it("申请找回：POST /auth/forgot-password，不留下登录态", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.requestPasswordReset("qin@you.com");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/forgot-password");
    expect(JSON.parse(options.body)).toEqual({ email: "qin@you.com" });
    // 找回 ≠ 登录：接口只寄信，不产生会话
    expect(auth.getSessionToken()).toBe("");
  });

  it("凭令牌重置：POST /auth/reset-password，成功后也不自动登录", async () => {
    const api = await import("@/lib/api");
    const auth = await import("@/lib/auth");
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.resetPasswordWithToken("tok-abc", "brand-new-5678");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/reset-password");
    expect(JSON.parse(options.body)).toEqual({
      token: "tok-abc",
      new_password: "brand-new-5678",
    });
    // 改密后旧会话都被踢，服务端也不发新会话——用户用新口令正常登录
    expect(auth.getSessionToken()).toBe("");
  });
});
