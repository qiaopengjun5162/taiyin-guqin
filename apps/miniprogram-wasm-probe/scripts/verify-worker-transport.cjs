/**
 * 微信 Worker 传输层校验器（在 Node 里模拟微信 Worker 运行时）。
 *
 * 真机验证抓到过两个**只在微信运行时暴露**的坑，Node 适配层校验器
 * （verify-adapter.mjs）因为自己造 postMessage/onMessage 而完全挡不住：
 *
 *   1. 小程序 Worker 里没有标准 Web Worker 的 `self`，全局暴露的是 `worker`。
 *      写 `self.onmessage = ...` 会报
 *      "Cannot set properties of undefined (setting 'onmessage')"，Worker 直接崩。
 *   2. Worker 内 `worker.onMessage` 回调收到的是 `{ message }`，不是 `{ data }`。
 *      不转换的话适配层拿到 undefined，请求永远不回。
 *
 * 做法：注入微信语义的 `worker` 全局 + WXWebAssembly 替身（底层走标准
 * WebAssembly、读真实 .wasm 产物），直接 require **真 Worker 入口**，
 * 跑一次完整的消息往返。
 *
 * 它不能证明 WXWebAssembly 在真机上的路径解析 / 基础库行为——那些只有模拟器能证。
 * 但它能挡住「改回 self」「把 res.message 写成 e.data」这类回归。
 *
 * 用法: node scripts/verify-worker-transport.cjs
 */
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const probeRoot = resolve(__dirname, "..");
const outbox = [];
let workerHandler = null;
let selfOnMessageSet = false;

// ── 微信 Worker 语义的全局对象 ──
global.worker = {
  onMessage(handler) {
    workerHandler = handler;
  },
  postMessage(msg) {
    outbox.push(msg);
  },
};

// 故意也放一个 self：如果入口错误地选了 self，这个探针会亮起来
global.self = {
  set onmessage(fn) {
    selfOnMessageSet = true;
    this._h = fn;
  },
  get onmessage() {
    return this._h;
  },
  postMessage(msg) {
    outbox.push(msg);
  },
};

// ── WXWebAssembly 替身：路径取真实文件，实例化走标准 WebAssembly ──
global.WXWebAssembly = {
  instantiate(path, imports) {
    const abs = resolve(probeRoot, path.replace(/^\//, ""));
    const bytes = readFileSync(abs);
    return WebAssembly.instantiate(bytes, imports).then((r) => ({
      module: r.module,
      instance: r.instance,
    }));
  },
};

let failed = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

// 直接加载真 Worker 入口。若它又写回 self.onmessage / 找不到全局，这里会抛。
try {
  require(resolve(probeRoot, "workers/wasm-worker.js"));
} catch (e) {
  console.error("Worker 入口加载失败:", e && e.message ? e.message : e);
  process.exit(1);
}

const waitFor = async (predicate, timeoutMs = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
};

async function main() {
  console.log("== Worker 全局对象 ==");
  check("用的是 worker.onMessage（微信语义）", typeof workerHandler === "function");
  check("没有退回到 self.onmessage（标准 Web Worker 语义）", selfOnMessageSet === false);
  if (typeof workerHandler !== "function") {
    console.log("\n传输层没接上，后续消息往返无法进行（详见上面两项）");
    process.exit(1);
  }

  // 等 wasm 实例化 + finalize 完成（serve 内部是 Promise 链）
  await new Promise((r) => setTimeout(r, 150));

  console.log("== 消息往返：主线程 → Worker → 主线程 ==");
  // 微信 Worker 内回调参数是 { message }，不是 { data }
  workerHandler({ message: { id: 1, fn: "get_jianzi_variant_groups", args: [] } });
  const got1 = await waitFor(() => outbox.some((m) => m.id === 1));
  const reply1 = outbox.find((m) => m.id === 1);
  check("请求收到回复（id=1）", got1, JSON.stringify(outbox).slice(0, 200));
  check("回复成功且带非空结果", !!reply1 && reply1.ok === true && typeof reply1.result === "string" && reply1.result.length > 2,
    reply1 ? JSON.stringify(reply1).slice(0, 160) : "无回复");

  console.log("== 真实计算（分句） ==");
  workerHandler({
    message: {
      id: 2,
      fn: "split_phrases_to_json",
      args: [JSON.stringify({ units: [8, 8, 8, 16, 8, 8] })],
    },
  });
  const got2 = await waitFor(() => outbox.some((m) => m.id === 2));
  const reply2 = outbox.find((m) => m.id === 2);
  check("分句请求收到回复（id=2）", got2);
  let split = null;
  if (reply2 && reply2.ok) {
    try { split = JSON.parse(reply2.result); } catch { /* 下面断言会报 */ }
  }
  check(
    "句界闭区间正确（0..3 / 4..5）",
    !!split && Array.isArray(split.phrases) && split.phrases.length === 2 &&
      split.phrases[0].start === 0 && split.phrases[0].end === 3 &&
      split.phrases[1].start === 4 && split.phrases[1].end === 5,
    JSON.stringify(split),
  );

  console.log("== 初始化失败广播 ==");
  const broadcast = outbox.find((m) => m.id === null || m.id === undefined);
  check("没有初始化失败广播", !broadcast, broadcast ? JSON.stringify(broadcast).slice(0, 160) : "");

  console.log(failed === 0 ? "\n全部通过（微信 Worker 传输层成立）" : `\n${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("校验器自身出错:", e);
  process.exit(1);
});
