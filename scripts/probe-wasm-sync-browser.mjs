#!/usr/bin/env node
/**
 * S2 可行性实测：静态导出产物里，WASM 能不能「同步初始化 + 同步调用」。
 *
 * 背景：P-1 里 S2（启动预加载 + 同步 getter）最大的未知量不是 `initSync` 存不存在，
 * 而是「Next.js 静态导出后，浏览器按 basePath 取到 glue + wasm，能否同步编译并调用」。
 * 2026-11-15 只在 Node 里验过；本脚本在真实 Chromium + `apps/web/dist/` 上补齐，
 * 顺带量出首屏要付的时间成本（fetch / compile / initSync / 9 个调用）。
 *
 * 用法：cd apps/web && pnpm build      # 先产出 dist/
 *       node scripts/probe-wasm-sync-browser.mjs
 *       node scripts/probe-wasm-sync-browser.mjs --json
 *
 * 依赖：根 package.json 已声明 playwright；不新增依赖、不联网、不接 CI。
 * 只读：不改任何源码，只起一个临时 HTTP 服务把 dist/ 按 basePath 映射出来。
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps/web/dist");
const BASE = "/taiyin-guqin";
const GLUE_URL = `${BASE}/wasm/taiyin_core.js`;
const WASM_URL = `${BASE}/wasm/taiyin_core_bg.wasm`;
const ROUNDS = 3;
const AS_JSON = process.argv.includes("--json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** 每个导出的最小合法输入；无参函数传空串（JS 多余参数会被忽略）。 */
const INPUTS = {
  translate_jianpu_to_jianzi: JSON.stringify({ number: 5, octave: 0 }),
  translate_jianpu_sequence_to_jianzi: JSON.stringify({ notes: [{ number: 5, octave: 0 }] }),
  arrange_jianpu_sequence_to_jianzi: JSON.stringify({ notes: [{ number: 5, octave: 0 }] }),
  split_phrases_to_json: JSON.stringify({ units: [8, 8, 16, 8] }),
  get_jianzi_dictionary: JSON.stringify({ query: "" }),
  analyze_jianzi_frequency: JSON.stringify({ notes: [] }),
  get_jianzi_variant_groups: "",
  encode_jianzi_batch: JSON.stringify({ notes: [{ toneType: "散", rightAction: "勾", stringNumber: "三" }] }),
  decode_jianzi_batch: JSON.stringify({ text: "sg3 | st5" }),
};

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function readDist(rel) {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = join(DIST, safe);
  if (!file.startsWith(DIST)) return null;
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

// 一个极简同源页面：只用来加载 wasm 资源，避免真实页面的 hydrate 噪声。
const PROBE_HTML =
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>wasm sync probe</title></head><body></body></html>";

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/__probe__") {
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(PROBE_HTML);
    return;
  }
  if (!pathname.startsWith(BASE)) {
    res.writeHead(404).end("not found");
    return;
  }
  let rel = pathname.slice(BASE.length) || "/index.html";
  if (rel === "/") rel = "/index.html";
  const body = await readDist(rel);
  if (!body) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(rel)] ?? "application/octet-stream" });
  res.end(body);
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

let browser;
try {
  // 产物完整性（缺 build 时给明确提示，别报一堆浏览器错误）
  const glueSrc = await readDist("/wasm/taiyin_core.js");
  const wasmBuf = await readDist("/wasm/taiyin_core_bg.wasm");
  if (!glueSrc || !wasmBuf) {
    fail("缺少 apps/web/dist/wasm/ 产物，先跑 `cd apps/web && pnpm build`");
  }
  if (!/initSync/.test(glueSrc.toString("utf8"))) {
    fail("glue 里没有 initSync，S2 前提不成立");
  }

  browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--no-sandbox"] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });
  await page.goto(`${origin}/__probe__`, { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(
    async ({ glueUrl, wasmUrl, inputs, rounds }) => {
      const timings = [];
      let funcs = [];
      let wasmBytes = 0;
      let hasInitSync = false;
      let streamingCompileMs = null;

      const glue = await import(/* webpackIgnore: true */ glueUrl);
      hasInitSync = typeof glue.initSync === "function";
      // 业务导出 = 带 _ 或全小写下划线的函数，排除 default / initSync / __wbindgen 内部符号。
      funcs = Object.keys(glue).filter(
        (k) => typeof glue[k] === "function" && !k.startsWith("__") && k !== "default" && k !== "initSync",
      );

      for (let i = 0; i < rounds; i++) {
        const t0 = performance.now();
        const resp = await fetch(wasmUrl);
        const bytes = await resp.arrayBuffer();
        wasmBytes = bytes.byteLength;
        const t1 = performance.now();
        const module = await WebAssembly.compile(bytes);
        const t2 = performance.now();
        glue.initSync({ module });
        const t3 = performance.now();
        for (const name of Object.keys(inputs)) {
          if (typeof glue[name] === "function") glue[name](inputs[name]);
        }
        const t4 = performance.now();
        timings.push({
          fetch: +(t1 - t0).toFixed(2),
          compile: +(t2 - t1).toFixed(2),
          initSync: +(t3 - t2).toFixed(2),
          calls: +(t4 - t3).toFixed(2),
        });
      }

      // 流式编译：S2 落地时应优先用 compileStreaming(fetch(..))，少一次全量内存拷贝。
      try {
        const s0 = performance.now();
        const sm = await WebAssembly.compileStreaming(fetch(wasmUrl));
        glue.initSync({ module: sm });
        streamingCompileMs = +(performance.now() - s0).toFixed(2);
      } catch (e) {
        streamingCompileMs = `失败: ${String(e).slice(0, 80)}`;
      }

      // 同步性判据：每个业务函数都返回字符串，且不是 Promise。
      const calls = [];
      for (const name of funcs) {
        const input = Object.prototype.hasOwnProperty.call(inputs, name) ? inputs[name] : "{}";
        try {
          const r = glue[name](input);
          calls.push({
            name,
            isPromise: r instanceof Promise,
            type: typeof r,
            length: typeof r === "string" ? r.length : null,
            head: typeof r === "string" ? r.slice(0, 60) : "",
          });
        } catch (e) {
          calls.push({ name, error: String(e).slice(0, 120) });
        }
      }
      return { timings, funcs, calls, wasmBytes, hasInitSync, streamingCompileMs };
    },
    { glueUrl: GLUE_URL, wasmUrl: WASM_URL, inputs: INPUTS, rounds: ROUNDS },
  );

  const avg = (k) =>
    +(out.timings.reduce((s, t) => s + t[k], 0) / out.timings.length).toFixed(2);
  const summary = {
    wasmBytes: out.wasmBytes,
    glueBytes: glueSrc.length,
    exportedFunctions: out.funcs.length,
    hasInitSync: out.hasInitSync,
    avgMs: {
      fetch: avg("fetch"),
      compile: avg("compile"),
      initSync: avg("initSync"),
      nineCalls: avg("calls"),
      total: +(avg("fetch") + avg("compile") + avg("initSync")).toFixed(2),
    },
    compileStreamingMs: out.streamingCompileMs,
    syncCalls: out.calls.filter((c) => !c.error).length,
    asyncOrFailed: out.calls.filter((c) => c.error || c.isPromise || c.type !== "string"),
    pageErrors,
  };

  const ok =
    out.hasInitSync &&
    out.funcs.length >= 9 &&
    summary.syncCalls === out.funcs.length &&
    summary.asyncOrFailed.length === 0;
  summary.verdict = ok ? "PASS" : "FAIL";

  if (AS_JSON) {
    console.log(JSON.stringify({ ...summary, rounds: out.timings, calls: out.calls }, null, 2));
  } else {
    console.log(`静态产物：glue ${summary.glueBytes} B / wasm ${summary.wasmBytes} B / 导出 ${summary.exportedFunctions} 个`);
    console.log(`initSync 存在：${summary.hasInitSync}`);
    console.log(`\n首屏成本（${ROUNDS} 轮均值，ms）：`);
    console.log(`  fetch ${summary.avgMs.fetch} + compile ${summary.avgMs.compile} + initSync ${summary.avgMs.initSync} = ${summary.avgMs.total}`);
    console.log(`  9 个函数同步调用合计 ${summary.avgMs.nineCalls}`);
    console.log(`  compileStreaming(fetch) 全程 ${summary.compileStreamingMs}`);
    console.log(`\n同步调用：${summary.syncCalls}/${out.funcs.length} 返回字符串且非 Promise`);
    for (const c of out.calls) {
      console.log(`  ${c.error ? "✗" : "✓"} ${c.name.padEnd(40)} ${c.error ?? `${c.length} 字  ${c.head}`}`);
    }
    if (pageErrors.length) console.log(`\n页面错误：${pageErrors.join(" / ")}`);
    console.log(`\n结论：${summary.verdict} —— 静态导出产物里 S2 的同步初始化${ok ? "可用" : "不成立"}`);
  }
  if (!ok) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
