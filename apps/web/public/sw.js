/*
 * 太音 Service Worker —— 只为两件事存在：
 *   1. 二次打开秒开（首屏要拉 1.1MB 减字字体 + 270KB WASM + 1.4MB 模板索引，走缓存后几乎零等待）；
 *   2. 断网还能看谱、翻页、读已验证过的曲谱（练琴时手机没信号是常态）。
 *
 * 策略选择的原则：**宁可少缓存，不可卡在旧版本**。
 * 一个写坏的 SW 比没有 SW 更糟——它会把用户永久钉在某次部署上，而用户不知道原因。
 * 所以这里刻意做了三处保守取舍：
 *
 *   a) 导航请求（HTML）用 network-first。在线永远先要新 HTML；
 *      只有断网时才退回缓存。这样新版本一发，用户下次打开就是新的。
 *   b) 只有**带内容哈希**的 `/_next/static/` 用 cache-first——那些 URL 变了内容才会变，
 *      缓存一次可以永远用。
 *   c) 字体 / wasm / 图标 / 数据这些**URL 不变、内容会变**的资源用
 *      stale-while-revalidate：先给缓存（快），同时在后台拉新的（下次生效）。
 *      如果对它们用 cache-first，字体换版本后老用户会一直看旧字形，且永远不会自愈。
 *
 * 缓存上限用"按插入顺序淘汰"硬压着（Cache API 没有 LRU 也没有时间戳），
 * 目的是防止跨多次部署无限膨胀，不是做精确淘汰。
 */

const CACHE_NAME = "taiyin-pwa-v1";
const MAX_ENTRIES = 120;

/** 安装时预取的骨架。失败不阻断安装（离线首启也要能装上）。 */
const CORE_ASSETS = [
  "./",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

/** 带哈希、内容不可变的资源 → cache-first */
const HASHED_ASSET = /\/_next\/static\//;

/** URL 稳定、内容会变的资源 → stale-while-revalidate */
const STABLE_ASSET = /\/(fonts|wasm|icons|data)\//;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // allSettled：某个资源 404 不该让整次安装失败（否则永远装不上）
      await Promise.allSettled(
        CORE_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" }))),
      );
      // 立刻接管，配合 network-first 不会让用户看到旧页面
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** 超出上限时按插入顺序删最旧的（Cache API keys() 返回插入顺序） */
async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) {
    await cache.delete(keys[i]);
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      await trimCache(cache);
    }
    return response;
  } catch {
    // 断网：先找这个 URL 的缓存，再退回起点页（SPA 只有一张 HTML）
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match("./");
    if (shell) return shell;
    return new Response("离线，且这份内容没有缓存。", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
    trimCache(cache).catch(() => {});
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);

  const refresh = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
        trimCache(cache).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (hit) return hit; // 有缓存立刻给，刷新在后台进行
  const response = await refresh;
  if (response) return response;
  return new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // 只处理 GET。POST/PUT 等一律不碰（发布曲谱、登录都在这类请求上）。
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // 跨源（后端 API、外链音频、统计）不进缓存：
  // 缓存别人的接口既没有收益，还会把带鉴权的响应留在磁盘上。
  if (url.origin !== self.location.origin) return;
  // http(s) 之外的协议（chrome-extension: 等）直接放过
  if (!url.protocol.startsWith("http")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (HASHED_ASSET.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (STABLE_ASSET.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // 其余同源 GET（比如分享链接解析出来的临时资源）走浏览器默认行为
});
