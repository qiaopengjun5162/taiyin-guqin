/**
 * 真启动服务的领域端点冒烟（HTTP 层，不是 oneshot）。
 *
 * 用法：
 *   just dev:server                        # 另开一个终端把服务跑起来（默认 :3001）
 *   node scripts/smoke-domain-http.mjs     # 默认打 http://127.0.0.1:3001
 *   node scripts/smoke-domain-http.mjs --base http://127.0.0.1:3101
 *   node scripts/smoke-domain-http.mjs --no-wasm --no-size --no-ratelimit
 *
 * 为什么需要它（而不是再加几条 oneshot 用例）：
 * oneshot 直接调用 Router，**不经过** `main()` 里那几层真实装配——全局限流
 * `GovernorLayer`、`DefaultBodyLimit`、CORS、`ConnectInfo` 注入、优雅停机。
 * 路由层全绿只能证明「handler 逻辑对」，证明不了「部署起来能用」。
 * 2026-11-21 首次真服务实测就抓到：`rapid-parse` 坏请求体返回 200（其余 10 个
 * 端点 400），客户端 `if (res.ok)` 会当成解析成功。这类差异 oneshot 永远看不见，
 * 因为它不在 handler 里，在「handler 与真实 HTTP 之间」。
 *
 * 校验：
 *  1. /health 200
 *  2. 15 个端点：200 + `application/json` + body 可解析
 *  3. **与 WASM 产物逐字节一致**（默认开）——「App / 小程序拿到与网页同一份逻辑」
 *     这句话到底成立不成立，只有把两边输出摆在一起比才知道
 *  4. 方法不对 → 405 且 `Allow` 头写明正确方法
 *  5. 坏请求体 / 空体 → 400 且错误体仍是 JSON（不能静默 200）
 *  6. 请求体上限真的生效：6 MiB → 413（`--no-size` 跳过；会花 6 MiB 流量）
 *  7. 全局限流头存在，且 15 连发不被 429——证明这组端点**没有**挂到 translate
 *     限流（1/s burst 5）上；真挂上了第 6 个请求就会 429
 *
 * 前置：服务要起得来（需要 Postgres）。默认配置 GLOBAL_RATE_BURST=60，
 * 本脚本总请求数约 57 个，够用；把 burst 调到 20 以下会让第 7 项误报，
 * 那种情况加 `--no-ratelimit`。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && args[at + 1] && !args[at + 1].startsWith("--")) return args[at + 1];
  return fallback;
};

const BASE = opt("base", process.env.BASE ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const CHECK_WASM = !flag("no-wasm");
const CHECK_SIZE = !flag("no-size");
const CHECK_RATELIMIT = !flag("no-ratelimit");

let failures = 0;
let checks = 0;
function check(name, cond, detail = "") {
  checks++;
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function info(msg) {
  console.log(`info ${msg}`);
}

const STATE = { toneType: "按", leftFinger: "大", hui: "九", rightAction: "勹", stringNumber: "四" };
const NOTES_2 = [{ id: "a" }, { id: "b" }];
const LINKED = [
  { id: "a", lianmei: { kind: "同声", headId: "a" } },
  { id: "b", lianmei: { kind: "同声", headId: "a" } },
];

/** 15 个端点：HTTP 侧的方法 + 载荷，以及对应的 WASM 导出名。 */
const ENDPOINTS = [
  { path: "/api/v1/jianzi/rapid-parse", method: "POST", body: { input: "djg4", tone: "按" }, wasm: "parse_rapid_input" },
  { path: "/api/v1/jianzi/rapid-slots", method: "GET", wasm: "get_rapid_slots" },
  { path: "/api/v1/jianzi/encode-batch", method: "POST", body: { notes: [{ toneType: "散", rightAction: "勾", stringNumber: "三", leftFinger: null, hui: null, fen: null, slide: null }] }, wasm: "encode_jianzi_batch" },
  { path: "/api/v1/jianzi/decode-batch", method: "POST", body: { text: "sg3" }, wasm: "decode_jianzi_batch" },
  { path: "/api/v1/jianpu/parse", method: "POST", body: { input: "5_ 6. 0" }, wasm: "parse_jianpu" },
  { path: "/api/v1/pitch/jianzi", method: "POST", body: { stringNumber: 4, toneType: "按", hui: 9 }, wasm: "jianzi_pitch" },
  { path: "/api/v1/explain/jianzi", method: "POST", body: { state: STATE }, wasm: "explain_jianzi" },
  { path: "/api/v1/jianzi/text", method: "POST", body: { state: STATE }, wasm: "jianzi_to_text" },
  { path: "/api/v1/jianzi/parse", method: "POST", body: { text: "大九勾四" }, wasm: "parse_jianzi_text" },
  { path: "/api/v1/lianmei/normalize", method: "POST", body: { notes: [{ id: "a", lianmei: { kind: "同声", headId: "gone" } }, { id: "b" }] }, wasm: "normalize_lianmei" },
  { path: "/api/v1/lianmei/groups", method: "POST", body: { notes: LINKED }, wasm: "lianmei_groups" },
  { path: "/api/v1/lianmei/relation", method: "POST", body: { freqA: 440, freqB: 880 }, wasm: "lianmei_relation" },
  { path: "/api/v1/lianmei/link", method: "POST", body: { notes: NOTES_2, headIndex: 0, kind: "同声" }, wasm: "link_lianmei" },
  { path: "/api/v1/lianmei/clear", method: "POST", body: { notes: LINKED, index: 0 }, wasm: "clear_lianmei" },
  { path: "/api/v1/lianmei/options", method: "GET", wasm: "get_lianmei_options" },
];

/** 原始请求：不重试。用来观察**真实的**限流行为（429 是数据，不是噪声）。 */
async function rawCall(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

let retries = 0;

/**
 * 带 429 退避重试的请求（除「限流隔离」那一项之外都用它）。
 *
 * 为什么用重试而不是「先等预算回血」：探测请求本身也吃预算，轮询等预算
 * 等于用请求换请求——实测剩余 13 → 12 → 11，永远等不满，最后还得跑，
 * 于是 50 条用例全红在 429 上，把「服务被刷过」误报成「端点全坏」。
 * 这里按 GCRA 的回血节奏（默认 2/s）退避重试，代价只是慢一点，
 * 换来的是功能结论永远可信。重试次数会在结尾如实打印。
 */
async function call(method, path, body, headers = {}) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = await rawCall(method, path, body, headers);
    if (r.status !== 429) return r;
    retries++;
    const retryAfter = Number(r.headers.get("retry-after") ?? 0);
    await new Promise((res) => setTimeout(res, Math.max(600, retryAfter * 1000 + 150)));
  }
  return rawCall(method, path, body, headers); // 真被限死了就如实交出 429
}

// ── 0. 服务在不在 ──────────────────────────────
let health;
try {
  health = await call("GET", "/health");
  check("health: 200", health.status === 200, `status=${health.status}`);
} catch (e) {
  console.error(`\n连不上 ${BASE}（${e.message}）。先把服务跑起来：`);
  console.error("  cargo build -p taiyin-server && ./target/debug/taiyin-server");
  process.exit(2);
}

if (CHECK_RATELIMIT) {
  const limit = health.headers.get("x-ratelimit-limit");
  const remaining = health.headers.get("x-ratelimit-remaining");
  if (!limit) {
    check("全局限流头存在", false, "响应里没有 x-ratelimit-* 头——GovernorLayer 可能没挂上");
  } else {
    info(`全局限流 limit=${limit} remaining=${remaining ?? "?"}（本脚本约 55 个请求；预算不够会自动退避重试，只是慢）`);
  }
}

// ── 1. 限流隔离：这组端点**没有**挂到 translate 限流（1/s、burst 5）上 ──
//
// 必须用 rawCall：这一项要观察的就是「会不会 429」，退避重试会把现象抹平。
// 也因此要放在最前面——全局限流是第一个吃预算的闸门，等前面几十个请求跑完，
// 剩下的预算不足以区分「挂错限流层」与「预算耗尽」。
if (CHECK_RATELIMIT) {
  const first = await rawCall("POST", "/api/v1/pitch/jianzi", { stringNumber: 4, toneType: "按", hui: 9 });
  const remaining = Number(first.headers.get("x-ratelimit-remaining") ?? NaN);

  if (first.status === 429 || (!Number.isNaN(remaining) && remaining < 20)) {
    info(`跳过 15 连发：剩余预算 ${Number.isNaN(remaining) ? "?" : remaining}，分不清「挂错限流」与「预算耗尽」`);
  } else {
    const statuses = [first.status];
    for (let i = 1; i < 15; i++) {
      const r = await rawCall("POST", "/api/v1/pitch/jianzi", { stringNumber: 4, toneType: "按", hui: 9 });
      statuses.push(r.status);
    }
    // 只看前 9 个：translate 限流是 burst 5，真挂上了第 6 个必红；
    // 后面若因为全局预算耗尽而出 429，那是「预算」不是「挂错」，不判红。
    check(
      "前 9 连发无 429（未挂在 translate 限流上）",
      statuses.slice(0, 9).every((s) => s === 200),
      `statuses=${statuses.join(",")}`,
    );
  }
}

// CORS 预检：只记录不判红——白名单内容取决于部署配置（ALLOWED_ORIGINS）
{
  const r = await call("OPTIONS", "/api/v1/jianzi/rapid-parse", undefined, {
    origin: "https://example.com",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type",
  });
  info(
    `预检 OPTIONS ${r.status} acao=${r.headers.get("access-control-allow-origin") ?? "（未回，说明来源不在白名单）"} acam=${r.headers.get("access-control-allow-methods") ?? "-"}`,
  );
}

// 尾斜杠：Axum 严格匹配，App / 小程序拼 URL 时多一个 `/` 就是 404。
// 只记录：将来若改成重定向，这条不该判红。
{
  const r = await call("GET", "/api/v1/jianzi/rapid-slots/");
  info(`GET /api/v1/jianzi/rapid-slots/ → ${r.status}（严格匹配，客户端不要加尾斜杠）`);
}

// ── 2. 15 个端点：200 + JSON + 与 WASM 逐字节一致 ──
let wasm = null;
if (CHECK_WASM) {
  const wasmDir = join(here, "../apps/web/wasm");
  const jsPath = join(wasmDir, "taiyin_core.js");
  if (!existsSync(jsPath)) {
    info("跳过 WASM 对齐：apps/web/wasm 不存在（先 just build-wasm）");
  } else {
    const mod = await import(jsPath);
    await mod.default({ module_or_path: readFileSync(join(wasmDir, "taiyin_core_bg.wasm")) });
    wasm = mod;
  }
}

for (const ep of ENDPOINTS) {
  const r = await call(ep.method, ep.path, ep.body);
  const ct = r.headers.get("content-type") ?? "";
  let parsed = null;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    /* 留给下面的断言 */
  }
  check(`${ep.method} ${ep.path} → 200 JSON`, r.status === 200 && ct.includes("application/json") && parsed !== null, `status=${r.status} ct=${ct || "-"} body=${r.body.slice(0, 80)}`);

  if (wasm) {
    const expected =
      ep.method === "GET" ? wasm[ep.wasm]() : wasm[ep.wasm](JSON.stringify(ep.body));
    check(
      `  ↳ 与 WASM 逐字节一致`,
      r.body === expected,
      r.body === expected ? "" : `服务端=${r.body.slice(0, 120)} … WASM=${String(expected).slice(0, 120)}`,
    );
  }
}

// ── 3. 方法不对 → 405 且 Allow 写清正确方法 ──
//
// 抽 4 个代表抽样，不逐个打满 15：405 是**路由表**的性质（`method_not_allowed`
// 由 axum 统一处理），15 个各打一遍只多花 11 个限流预算、不多给信息。
// 预算（GLOBAL_RATE_BURST 默认 60）要留给后面的坏请求体与体积用例。
const METHOD_SAMPLE = [
  "/api/v1/jianzi/rapid-parse",
  "/api/v1/jianzi/rapid-slots",
  "/api/v1/jianpu/parse",
  "/api/v1/lianmei/options",
];
for (const path of METHOD_SAMPLE) {
  const ep = ENDPOINTS.find((e) => e.path === path);
  const wrong = ep.method === "GET" ? "POST" : "GET";
  const r = await call(wrong, ep.path, wrong === "POST" ? {} : undefined);
  const allow = r.headers.get("allow") ?? "";
  check(
    `${wrong} ${ep.path} → 405（Allow 含 ${ep.method}）`,
    r.status === 405 && allow.toUpperCase().includes(ep.method),
    `status=${r.status} allow=${allow || "-"}`,
  );
}

// ── 4. 坏请求体 → 400 且错误体是 JSON（这一条曾漏掉 rapid-parse）──
for (const ep of ENDPOINTS.filter((e) => e.method === "POST")) {
  const r = await call("POST", ep.path, "not json");
  let parsed = null;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    /* 断言里判 */
  }
  check(
    `坏 JSON ${ep.path} → 400 + JSON 原因`,
    r.status === 400 && typeof parsed?.error === "string" && parsed.error.length > 0,
    `status=${r.status} body=${r.body.slice(0, 100)}`,
  );
}

// 空体同样要说人话（不能 500，也不能静默 200）
{
  const r = await call("POST", "/api/v1/jianpu/parse", "");
  check("空体 /jianpu/parse → 400", r.status === 400, `status=${r.status} body=${r.body.slice(0, 80)}`);
}

// ── 5. 请求体上限真在生效（6 MiB → 413）──
//
// 这一项要容忍「连接被提前重置」：服务在 body 还没收完时就判定超限并回 413、
// 关掉连接，于是客户端可能连响应都没读到（curl 能读到 413，Node/undici 多半
// 抛 write ECONNRESET）。对 App / 小程序来说这是**网络错误**而不是可读的 413，
// 所以两种结果都算「被拒绝」，但要分开说清楚——这是真服务才看得到的细节。
if (CHECK_SIZE) {
  // ── 计算预算（256 KiB / 2048 条 / 8192 字符）──
  // 这些载荷都远小于 5 MiB，所以过的不是 body_limit，而是 routes.rs 里的
  // check_compute_budget——闸门有没有真的接上，只有真服务上看得见。
  const note = {
    toneType: "散", rightAction: "勾", stringNumber: "三",
    leftFinger: null, hui: null, fen: null, slide: null,
  };
  const budgetCases = [
    ["encode-batch 2049 条 → 400", "/api/v1/jianzi/encode-batch", { notes: Array.from({ length: 2049 }, () => note) }, "单批最多"],
    ["decode-batch 2049 片段 → 400", "/api/v1/jianzi/decode-batch", { text: "sg3 ".repeat(2049) }, "单批最多"],
    ["简谱 8193 字符 → 400", "/api/v1/jianpu/parse", { input: "5 ".repeat(8193) }, "最多"],
    ["300 KiB padding → 400", "/api/v1/jianzi/decode-batch", { text: "sg3", padding: "x".repeat(300 * 1024) }, "上限"],
  ];
  for (const [name, path, body, keyword] of budgetCases) {
    const r = await call("POST", path, body);
    check(
      name,
      r.status === 400 && r.body.includes(keyword),
      `status=${r.status} body=${r.body.slice(0, 120)}`,
    );
  }
  const okBatch = await call("POST", "/api/v1/jianzi/encode-batch", {
    notes: Array.from({ length: 100 }, () => note),
  });
  check("100 条批量仍 200（预算没有误伤）", okBatch.status === 200, `status=${okBatch.status}`);

  // 限流层跑在体积检查**之前**（route_layer 包住整个路由），预算耗尽时
  // 6 MiB 请求先吃 429、根本轮不到 413。预算不够就跳过，别把顺序问题
  // 报成「体积上限失效」。
  const probe = await call("GET", "/health");
  const remaining = Number(probe.headers.get("x-ratelimit-remaining") ?? NaN);
  if (Number.isFinite(remaining) && remaining < 3) {
    info(`跳过体积用例：限流预算仅 ${remaining}，429 会盖住 413`);
  } else {
    const big = JSON.stringify({ input: "x".repeat(6 * 1024 * 1024) });
    const r = await rawCall("POST", "/api/v1/jianpu/parse", big).catch((e) => ({
      status: 0,
      headers: new Headers(),
      body: "",
      err: e?.cause?.code ?? e.name,
    }));
    check(
      "6 MiB 请求体被拒（413，或超限时报文被提前截断）",
      r.status === 413 || r.status === 0,
      `status=${r.status}${r.err ? ` err=${r.err}` : ""}`,
    );
    if (r.status === 0) {
      info("超限时服务直接断开连接，客户端读不到 413 的 body——App / 小程序要有「请求过大」的兜底文案");
    }
    const ok = JSON.stringify({ input: "5_ 6 0" });
    const r2 = await call("POST", "/api/v1/jianpu/parse", ok);
    check("小请求体仍 200（上限没有误伤）", r2.status === 200, `status=${r2.status}`);
  }
}

if (retries) info(`本次因 429 退避重试 ${retries} 次（预算不足，结果仍可信，只是慢）`);
console.log(`\n${checks - failures}/${checks} 项通过${failures ? `，${failures} 项失败` : "，全绿"}`);
if (failures) {
  console.error("提示：与 WASM 不一致时先确认产物不过期（just build-wasm && just verify-wasm）。");
  process.exit(1);
}
