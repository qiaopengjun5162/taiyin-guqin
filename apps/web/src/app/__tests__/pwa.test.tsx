import { describe, it, expect, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { buildManifest } from "@/app/manifest";
import { PwaRegister, registerServiceWorker, serviceWorkerScope, serviceWorkerUrl } from "@/components/pwa-register";

const HERE = dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = readFileSync(resolve(HERE, "../../../public/sw.js"), "utf8");

// ─────────────────────────────────────────────────────────────
// manifest —— 路径必须随 basePath 走，否则 GitHub Pages 上装出来是个 404 图标
//
// 直接测 buildManifest(basePath)，不走 process.env：`NEXT_PUBLIC_*` 有被构建期
// 静态替换的可能，那种情况下基于环境变量的断言会假通过（改了路径也不红）。
// ─────────────────────────────────────────────────────────────

describe("PWA manifest", () => {
  it("根部署时 start_url / scope 是 /", () => {
    const m = buildManifest("");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
  });

  it("GitHub Pages 子路径时 start_url / scope 带前缀", () => {
    const m = buildManifest("/taiyin-guqin");
    expect(m.start_url).toBe("/taiyin-guqin/");
    expect(m.scope).toBe("/taiyin-guqin/");
  });

  it("所有图标路径都带 basePath（写死根路径会装出白屏图标）", () => {
    const m = buildManifest("/taiyin-guqin");
    expect(m.icons?.length).toBeGreaterThan(0);
    for (const icon of m.icons ?? []) {
      expect(icon.src).toMatch(/^\/taiyin-guqin\/icons\/.+\.png$/);
    }
  });

  it("必须有 maskable 图标（Android 会把图标裁成圆形）", () => {
    const m = buildManifest("/taiyin-guqin");
    const maskable = (m.icons ?? []).filter((i) => i.purpose === "maskable");
    expect(maskable).toHaveLength(1);
    expect(maskable[0].sizes).toBe("512x512");
  });

  it("standalone 显示模式 + 宣纸底色（冷启动不闪白）", () => {
    const m = buildManifest("");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#f5efe6");
    expect(m.theme_color).toBe("#1c1b1a");
  });
});

// ─────────────────────────────────────────────────────────────
// pwa-register —— 生产才注册、路径带 basePath、失败不影响页面
// ─────────────────────────────────────────────────────────────

describe("Service Worker 注册", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  });

  function installServiceWorker(register: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
  }

  it("URL / scope 都带 basePath", () => {
    expect(serviceWorkerUrl("/taiyin-guqin")).toBe("/taiyin-guqin/sw.js");
    // scope 少了尾斜杠会让作用域变成父目录，必须显式带
    expect(serviceWorkerScope("/taiyin-guqin")).toBe("/taiyin-guqin/");
  });

  it("根部署时是 /sw.js 与 /", () => {
    expect(serviceWorkerUrl("")).toBe("/sw.js");
    expect(serviceWorkerScope("")).toBe("/");
  });

  it("enabled=false 时不注册（dev 下 SW 缓存会和 HMR 打架）", async () => {
    const register = vi.fn();
    installServiceWorker(register);
    expect(await registerServiceWorker({ enabled: false })).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("浏览器不支持 serviceWorker 时返回 null", async () => {
    expect(await registerServiceWorker({ enabled: true })).toBeNull();
  });

  it("注册时用的路径与作用域正确", async () => {
    const reg = { scope: "/taiyin-guqin/" };
    const register = vi.fn().mockResolvedValue(reg);
    installServiceWorker(register);

    await expect(
      registerServiceWorker({ enabled: true, basePath: "/taiyin-guqin" }),
    ).resolves.toBe(reg);
    expect(register).toHaveBeenCalledWith("/taiyin-guqin/sw.js", { scope: "/taiyin-guqin/" });
  });

  it("注册抛异常时吞掉，不能影响页面（Safari 无痕模式会抛）", async () => {
    const register = vi.fn().mockRejectedValue(new Error("SecurityError"));
    installServiceWorker(register);
    await expect(registerServiceWorker({ enabled: true })).resolves.toBeNull();
  });

  it("PwaRegister 挂载后触发注册且不渲染内容", async () => {
    const register = vi.fn().mockResolvedValue({});
    installServiceWorker(register);

    const { container } = render(<PwaRegister enabled />);
    expect(container.innerHTML).toBe("");
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });
});

// ─────────────────────────────────────────────────────────────
// public/sw.js —— 用真源码在沙箱里跑，逐条验证缓存策略
//
// 为什么值得为这个文件写测试：它不在 src/ 下，覆盖率工具根本看不见它，
// 但它一旦写错（比如把 HTML 也 cache-first），用户会被永久钉在旧版本上，
// 而现象是"白屏/点不动"，极难排查。所以宁可多写这层。
// ─────────────────────────────────────────────────────────────

/** SW 里用到的事件形状（只声明我们真正碰的几个字段） */
type SwEvent = {
  request?: { url: string; method: string; mode: string };
  waitUntil?: (p: Promise<unknown>) => void;
  respondWith?: (p: Promise<unknown>) => void;
};

type Listener = (event: SwEvent) => void;

/** 带 spy 的事件：测试要读 respondWith 的调用参数 */
type EventSpy = SwEvent & { respondWith: Mock };

class FakeResponse {
  body: string;
  status: number;
  ok: boolean;
  constructor(body = "", init: { status?: number } = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status });
  }
}

class FakeRequest {
  url: string;
  method: string;
  mode: string;
  constructor(input: string, init: { method?: string; mode?: string } = {}) {
    // 与浏览器一致：相对路径按 SW 所在的 /taiyin-guqin/sw.js 解析
    this.url = new URL(input, "https://example.com/taiyin-guqin/sw.js").href;
    this.method = init.method ?? "GET";
    this.mode = init.mode ?? "no-cors";
  }
}

function createSwHarness(initialEntries: string[] = []) {
  const listeners: Record<string, Listener> = {};
  const store = new Map<string, string>();

  const norm = (input: unknown): string => {
    if (typeof input === "string") {
      return new URL(input, "https://example.com/taiyin-guqin/sw.js").href;
    }
    return (input as { url?: string })?.url ?? String(input);
  };

  for (const key of initialEntries) store.set(key, "cached");

  const cache = {
    put: vi.fn(async (req: unknown, res: { body: string }) => {
      store.set(norm(req), res.body);
    }),
    add: vi.fn(async (req: unknown) => {
      store.set(norm(req), "precached");
    }),
    match: vi.fn(async (req: unknown) => {
      const hit = store.get(norm(req));
      return hit === undefined ? undefined : new FakeResponse(hit);
    }),
    keys: vi.fn(async () => [...store.keys()].map((url) => ({ url }))),
    delete: vi.fn(async (key: unknown) => {
      const k = typeof key === "string" ? norm(key) : (key as { url: string }).url;
      return store.delete(k);
    }),
  };

  const cachesApi = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["taiyin-pwa-v1", "some-old-cache"]),
    delete: vi.fn(async () => true),
  };

  const self = {
    location: new URL("https://example.com/taiyin-guqin/sw.js"),
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };

  const fetchMock = vi.fn(async () => new FakeResponse("network", { status: 200 }));

  // 用 Function 而不是 eval：避免污染本模块作用域，注入点也一目了然
  const run = new Function("self", "caches", "fetch", "Request", "Response", "URL", SW_SOURCE);
  run(self, cachesApi, fetchMock, FakeRequest, FakeResponse, URL);

  return { listeners, store, cache, cachesApi, self, fetchMock };
}

function navigateEvent(url: string): EventSpy {
  return {
    request: { url, method: "GET", mode: "navigate" },
    respondWith: vi.fn(),
  };
}

function assetEvent(url: string, method = "GET", mode = "no-cors"): EventSpy {
  return {
    request: { url, method, mode },
    respondWith: vi.fn(),
  };
}

describe("sw.js 缓存策略", () => {
  it("install 预取骨架并立即接管", async () => {
    const h = createSwHarness();
    let p: Promise<unknown> | undefined;
    h.listeners.install({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;

    expect(h.cache.add).toHaveBeenCalledTimes(3);
    expect(h.self.skipWaiting).toHaveBeenCalled();
  });

  it("activate 清掉旧版本缓存并 claim", async () => {
    const h = createSwHarness();
    let p: Promise<unknown> | undefined;
    h.listeners.activate({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;

    expect(h.cachesApi.delete).toHaveBeenCalledWith("some-old-cache");
    expect(h.cachesApi.delete).not.toHaveBeenCalledWith("taiyin-pwa-v1");
    expect(h.self.clients.claim).toHaveBeenCalled();
  });

  it("导航请求走 network-first：在线拿新 HTML 并写入缓存", async () => {
    const h = createSwHarness();
    const event = navigateEvent("https://example.com/taiyin-guqin/");
    h.listeners.fetch(event);

    const res = (await event.respondWith.mock.calls[0][0]) as FakeResponse;
    expect(res.body).toBe("network");
    expect(h.store.get("https://example.com/taiyin-guqin/")).toBe("network");
  });

  it("断网时导航退回缓存（练琴没网也能打开）", async () => {
    const h = createSwHarness(["https://example.com/taiyin-guqin/"]);
    h.fetchMock.mockRejectedValue(new Error("offline"));

    const event = navigateEvent("https://example.com/taiyin-guqin/");
    h.listeners.fetch(event);
    const res = (await event.respondWith.mock.calls[0][0]) as FakeResponse;
    expect(res.body).toBe("cached");
  });

  it("断网且没有该页缓存时退回起点页（SPA 只有一张 HTML）", async () => {
    const h = createSwHarness(["https://example.com/taiyin-guqin/"]);
    h.fetchMock.mockRejectedValue(new Error("offline"));

    const event = navigateEvent("https://example.com/taiyin-guqin/zidian");
    h.listeners.fetch(event);
    const res = (await event.respondWith.mock.calls[0][0]) as FakeResponse;
    expect(res.body).toBe("cached");
  });

  it("断网且完全没缓存时返回 503 而不是抛错", async () => {
    const h = createSwHarness();
    h.fetchMock.mockRejectedValue(new Error("offline"));

    const event = navigateEvent("https://example.com/taiyin-guqin/");
    h.listeners.fetch(event);
    const res = (await event.respondWith.mock.calls[0][0]) as FakeResponse;
    expect(res.status).toBe(503);
  });

  it("带哈希的 _next/static 走 cache-first：第二次不再请求网络", async () => {
    const h = createSwHarness();
    const url = "https://example.com/taiyin-guqin/_next/static/chunks/main-abc123.js";

    const first = assetEvent(url);
    h.listeners.fetch(first);
    await first.respondWith.mock.calls[0][0];
    expect(h.fetchMock).toHaveBeenCalledTimes(1);

    const second = assetEvent(url);
    h.listeners.fetch(second);
    const res = (await second.respondWith.mock.calls[0][0]) as FakeResponse;
    expect(res.body).toBe("network");
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("字体 / wasm 这类 URL 不变的资源走 stale-while-revalidate", async () => {
    const url = "https://example.com/taiyin-guqin/fonts/WangJiJianZiPuKaiTi.ttf";
    const h = createSwHarness([url]);

    const event = assetEvent(url);
    h.listeners.fetch(event);
    const res = (await event.respondWith.mock.calls[0][0]) as FakeResponse;
    // 先给缓存（快）
    expect(res.body).toBe("cached");
    // 但后台仍必须去拉新版本，否则字体换了永远自愈不了
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("缓存条目超上限时按插入顺序淘汰最旧的", async () => {
    const many = Array.from(
      { length: 120 },
      (_, i) => `https://example.com/taiyin-guqin/_next/static/c${i}.js`,
    );
    const h = createSwHarness(many);

    const url = "https://example.com/taiyin-guqin/_next/static/newest.js";
    const event = assetEvent(url);
    h.listeners.fetch(event);
    await event.respondWith.mock.calls[0][0];

    expect(h.store.size).toBe(120);
    expect(h.store.has(many[0])).toBe(false);
    expect(h.store.has(url)).toBe(true);
  });

  it("非 GET 请求完全不介入（发布曲谱、登录都走 POST）", async () => {
    const h = createSwHarness();
    const event = assetEvent("https://example.com/taiyin-guqin/api/scores", "POST");
    h.listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("跨源请求不缓存（后端 API 里带鉴权头）", async () => {
    const h = createSwHarness();
    const event = assetEvent("https://api.example.com/scores");
    h.listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("同源但不属于静态资源的 GET 交给浏览器默认行为", async () => {
    const h = createSwHarness();
    const event = assetEvent("https://example.com/taiyin-guqin/about");
    h.listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });
});
