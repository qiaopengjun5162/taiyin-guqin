/**
 * WASM 适配层的 Node 校验器。
 *
 * 它回答一个问题：**适配逻辑本身对不对**——即「拿到 imports → 实例化 →
 * finalize → 按名调用」这条链，能不能真的跑通我们的 wasm 产物。
 *
 * 做法：造一个 `WXWebAssembly` 语义的替身（底层用标准 WebAssembly，
 * 返回形状对齐 `{module, instance}`），喂给**与真 Worker 同一份**
 * `workers/wasm-api.js` 的 serve()，再走消息协议发请求。
 *
 * 它**不能**证明的是 WXWebAssembly 在微信运行时的坑（路径解析、
 * 基础库版本、Worker 生命周期）。那些只有模拟器/真机能证，别把
 * 这里的绿当成「小程序上跑通了」。
 *
 * 用法: node scripts/verify-adapter.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const probeRoot = resolve(here, "..");

const api = require(resolve(probeRoot, "workers/wasm-api.js"));

// ── WXWebAssembly 替身：路径取真实文件，实例化走标准 WebAssembly ──
const mockInstantiate = (path, imports) => {
  const abs = resolve(probeRoot, path.replace(/^\//, ""));
  const bytes = readFileSync(abs);
  return WebAssembly.instantiate(bytes, imports).then((r) => {
    // 标准 instantiate(bytes) 返回 {module, instance}，与 WXWebAssembly 对齐
    return { module: r.module, instance: r.instance };
  });
};

// ── 走与真 Worker 完全相同的 serve() 路径 ──
const inbox = [];
const outbox = [];
let ready;
ready = api.serve({
  wasmPath: "/wasm/taiyin_core_bg.wasm",
  instantiateFn: mockInstantiate,
  postMessage: (m) => outbox.push(m),
  onMessage: (handler) => {
    inbox.push(handler);
  },
});

const send = (msg) => inbox.forEach((h) => h({ data: msg }));
const pending = new Map();
let nextId = 1;

function rpc(fn, args) {
  const id = nextId++;
  return new Promise((resolveP, rejectP) => {
    pending.set(id, { resolve: resolveP, reject: rejectP });
    send({ id, fn, args });
    // serve() 的响应是异步 postMessage（挂在 ready 的 then 上），
    // 同步 drain 拿不到，会永久挂起。这里自轮询结算。
    const tick = () => {
      drain();
      if (pending.has(id)) setTimeout(tick, 5);
    };
    setTimeout(tick, 5);
  });
}

// 把 outbox 转成 Promise 结算
const drain = () => {
  while (outbox.length) {
    const m = outbox.shift();
    if (m.id === null) {
      // 初始化失败广播
      for (const p of pending.values()) p.reject(new Error(m.error));
      pending.clear();
      continue;
    }
    const p = pending.get(m.id);
    if (!p) continue;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error));
  }
};

async function main() {
  let failed = 0;
  const check = (name, cond, detail) => {
    if (cond) {
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  console.log("== 加载 ==");
  await ready;
  drain();
  check("wasm 加载并 finalize 成功", true);

  console.log("== 无参函数（get_jianzi_variant_groups） ==");
  const rawVariants = rpc("get_jianzi_variant_groups", []);
  // 结算要等消息进 outbox；serve() 是同步 postMessage，所以先发再 drain
  drain();
  const variantsStr = await rawVariants;
  const variants = JSON.parse(variantsStr);
  check("返回合法 JSON", typeof variants === "object" && variants !== null);
  check("非空结果", JSON.stringify(variants).length > 2, JSON.stringify(variants).slice(0, 60));

  console.log("== 真实计算（split_phrases_to_json） ==");
  // 句界是**闭区间**（end 含末音），与前端 phraseKey `0-2-3`（3 音、end=2）一致。
  // 单位：四分 = 8，二分 = 16。16 单位的音触发气口，气口长音属于它结束的那一句。
  // 这里 [8,8,8,16,  8,8] → 第 1 句 0..3（4 音，末音是二分），第 2 句 4..5（2 音）。
  const p = rpc("split_phrases_to_json", [JSON.stringify({ units: [8, 8, 8, 16, 8, 8] })]);
  drain();
  const split = JSON.parse(await p);
  check("返回 phrases 数组", Array.isArray(split.phrases), JSON.stringify(split));
  check("切出 2 句", split.phrases && split.phrases.length === 2, JSON.stringify(split.phrases));
  check(
    "句界闭区间正确（0..3 / 4..5）",
    split.phrases &&
      split.phrases[0].start === 0 &&
      split.phrases[0].end === 3 &&
      split.phrases[1].start === 4 &&
      split.phrases[1].end === 5,
    JSON.stringify(split.phrases),
  );

  // 再验一例：全短音不应切开（无气口）
  const p2 = rpc("split_phrases_to_json", [JSON.stringify({ units: [8, 8, 8] })]);
  drain();
  const one = JSON.parse(await p2);
  check(
    "无气口时整段一句（0..2）",
    one.phrases && one.phrases.length === 1 && one.phrases[0].start === 0 && one.phrases[0].end === 2,
    JSON.stringify(one.phrases),
  );

  console.log("== 错误路径（调用不存在的函数） ==");
  const bad = rpc("no_such_fn", []);
  drain();
  let badErr = null;
  try {
    await bad;
  } catch (e) {
    badErr = e.message;
  }
  check("报错而不是静默 undefined", /没有导出/.test(badErr || ""), String(badErr));

  console.log(failed === 0 ? "\n全部通过（适配层逻辑成立）" : `\n${failed} 项失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("校验器自身出错:", e);
  process.exit(1);
});
