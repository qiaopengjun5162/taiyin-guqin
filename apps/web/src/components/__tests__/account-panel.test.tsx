/**
 * @vitest-environment jsdom
 *
 * 社区账号面板：登录 / 注册 / 登出，以及会话失效时的自动纠正。
 *
 * 最有价值的是最后一条「会话已失效」——服务端会话存库、可能过期或被别处吊销，
 * 界面若不主动校验，就会一直显示「已登录」，用户一点保存却收到 403，
 * 完全不知道发生了什么。这类 bug 只有靠「打开页面就自动发现」才能避免。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AccountPanel } from "../account-panel";
import { clearStoredSession } from "@/lib/auth";

afterEach(cleanup);

const USER = { id: "u-1", email: "qin@you.com", display_name: "张琴友" };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** 按 URL 分派：账号面板会打 /auth/login、/auth/logout、/auth/me 三个端点。 */
function routeFetch(handlers: Record<string, { body: unknown; status?: number }>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) throw new Error(`未预期的请求：${url}`);
    const h = handlers[key];
    return jsonResponse(h.body, h.status ?? 200);
  });
}

function seedSession() {
  window.localStorage.setItem(
    "taiyin.session",
    JSON.stringify({ token: "tok", user: USER }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // auth 模块有进程内兜底（隐私模式下用），光清 localStorage 清不掉它：
  // 上一个用例的登录态会漏到下一个，表现为「明明没登录却显示已登录」。
  clearStoredSession();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  // 重置用例会往 URL 上写 ?reset_token=，不清的话会漏进后面的用例
  //（挂载时读 URL 直接跳重置表单）。
  window.history.pushState({}, "", "/");
});

describe("AccountPanel 社区账号", () => {
  it("未登录时展示登录表单，并如实说明边界（不做邮箱验证 / 可自助找回）", () => {
    render(<AccountPanel />);
    expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
    expect(screen.getByLabelText("口令")).toBeInTheDocument();
    expect(screen.getByText(/不做邮箱验证/)).toBeInTheDocument();
    expect(screen.getByText(/自助找回/)).toBeInTheDocument();
    expect(screen.getByText(/管理员重置/)).toBeInTheDocument();
  });

  it("登录成功：显示昵称与登出入口，并记住会话", async () => {
    fetchMock = routeFetch({ "/auth/login": { body: { user: USER, token: "tok-1" } } });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "qin@you.com" } });
    fireEvent.change(screen.getByLabelText("口令"), { target: { value: "longenough" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(screen.getByText(/已登录：张琴友/)).toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem("taiyin.session") ?? "{}").token).toBe(
      "tok-1",
    );
  });

  it("没有昵称时用邮箱显示", async () => {
    fetchMock = routeFetch({
      "/auth/login": { body: { user: { ...USER, display_name: "" }, token: "t" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "qin@you.com" } });
    fireEvent.change(screen.getByLabelText("口令"), { target: { value: "longenough" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(screen.getByText(/已登录：qin@you\.com/)).toBeInTheDocument());
  });

  /** 口令太短在前端就挡掉：省一次往返，也让用户当场知道哪儿不对。 */
  it("口令不足 8 位：本地提示且不发请求", async () => {
    render(<AccountPanel />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "qin@you.com" } });
    fireEvent.change(screen.getByLabelText("口令"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("口令至少 8 位"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * 后端刻意对「邮箱不存在」与「口令不对」返回同一句话（防账号枚举），
   * 界面必须原样展示，不能自作聪明改成更「友好」的措辞。
   */
  it("登录失败：原样展示后端文案", async () => {
    fetchMock = routeFetch({
      "/auth/login": { body: { error: "邮箱或口令不对" }, status: 401 },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "qin@you.com" } });
    fireEvent.change(screen.getByLabelText("口令"), { target: { value: "wrongpassword" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("邮箱或口令不对"));
    expect(window.localStorage.getItem("taiyin.session")).toBeNull();
  });

  it("切到注册：多出昵称一栏，按钮变「注册」", () => {
    render(<AccountPanel />);
    fireEvent.click(screen.getByText("没有账号？注册"));
    expect(screen.getByLabelText("昵称")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "注册" })).toBeInTheDocument();
  });

  it("已登录时点登出：清掉本地会话并回到登录表单", async () => {
    seedSession();
    fetchMock = routeFetch({ "/auth/logout": { body: { ok: true } } });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    fireEvent.click(screen.getByRole("button", { name: "登出" }));

    await waitFor(() => expect(screen.getByLabelText("邮箱")).toBeInTheDocument());
    expect(window.localStorage.getItem("taiyin.session")).toBeNull();
  });

  /**
   * 会话在服务端可能已过期 / 被别处登出。打开页面就该发现，
   * 而不是等用户点保存收到 403 才暴露。
   */
  it("会话已失效：打开页面自动回到未登录", async () => {
    seedSession();
    fetchMock = routeFetch({
      "/auth/me": { body: { error: "未登录或登录已过期" }, status: 401 },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    await waitFor(() => expect(screen.getByLabelText("邮箱")).toBeInTheDocument());
    expect(window.localStorage.getItem("taiyin.session")).toBeNull();
  });

  it("会话有效时保持已登录", async () => {
    seedSession();
    fetchMock = routeFetch({ "/auth/me": { body: USER } });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText(/已登录：张琴友/)).toBeInTheDocument();
  });

  it("忘了口令：填邮箱寄链接，提示统一话术（不泄露是否注册过）", async () => {
    fetchMock = routeFetch({ "/auth/forgot-password": { body: { ok: true } } });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    fireEvent.click(screen.getByRole("button", { name: "忘了口令？" }));
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "qin@you.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "寄重置链接" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/auth/forgot-password");
    expect(JSON.parse(String(init.body))).toEqual({ email: "qin@you.com" });
    // 后端不区分注册与否，提示也必须是同一句话——「该邮箱未注册」就是枚举漏洞
    expect(
      await screen.findByText(/如果这个邮箱注册过/),
    ).toBeInTheDocument();
  });

  it("邮件链接 (?reset_token=) 直达重置表单，设完新口令回登录", async () => {
    window.history.pushState({}, "", "/?reset_token=tok-abc");
    fetchMock = routeFetch({ "/auth/reset-password": { body: { ok: true } } });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    // 直接就是重置表单，令牌已自动带上，不逼用户抄令牌
    fireEvent.change(await screen.findByLabelText("新口令"), {
      target: { value: "brand-new-5678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "设为新口令" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/auth/reset-password");
    expect(JSON.parse(String(init.body))).toEqual({
      token: "tok-abc",
      new_password: "brand-new-5678",
    });
    expect(await screen.findByText(/口令已改/)).toBeInTheDocument();
    // 回到登录表单
    expect(screen.getByLabelText("口令")).toBeInTheDocument();
  });

  it("重置失败（链接无效）：原样展示后端文案", async () => {
    window.history.pushState({}, "", "/?reset_token=expired-token");
    fetchMock = routeFetch({
      "/auth/reset-password": {
        body: { error: "链接无效或已过期，请重新申请找回" },
        status: 400,
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountPanel />);

    fireEvent.change(await screen.findByLabelText("新口令"), {
      target: { value: "brand-new-5678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "设为新口令" }));

    expect(
      await screen.findByText(/链接无效或已过期/),
    ).toBeInTheDocument();
  });
});
