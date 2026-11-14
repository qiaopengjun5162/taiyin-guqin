/**
 * 探针兜底逻辑的变异验证 —— 新版要绿、退回旧版要红。
 *
 * 真机验证最怕的不是报错，而是「一直转圈」。这四件事只在微信运行时才暴露，
 * 所以各跑「当前实现」与「内存里退回旧版」两份，确认校验真的抓得住：
 *
 *   A. instantiateFn 同步抛错时，loadWasm 必须返回 rejected promise，而不是同步 throw
 *      （旧写法会让整个 Worker 脚本在 serve 注册监听之前就崩，主线程永远等不到消息）
 *   B. 初始化失败的 id=null 广播到达时，正在等待的请求要立刻失败，不能被丢掉
 *   C. Worker 永不回应时，探针页必须在超时后给出 FAIL，不能一直 RUNNING
 *   D. Worker 永不回应时，lib/wasm-client.js 的 call 也必须在超时后 reject
 *      （「查音位」页走这个 client，以前没有超时，Worker 被回收就永久转圈）
 *
 * C 用真实 12 秒口径（约 13 秒）；D 通过 createSession({ timeoutMs }) 注入 60ms，
 * 不必跟着干等。跑法：node scripts/verify-guards.cjs
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const apiSrc = fs.readFileSync(path.join(ROOT, "workers/wasm-api.js"), "utf8");
const pageSrc = fs.readFileSync(path.join(ROOT, "pages/index/index.js"), "utf8");
const clientSrc = fs.readFileSync(path.join(ROOT, "lib/wasm-client.js"), "utf8");

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log("  ✓ " + label);
  } else {
    console.log("  ✗ " + label + (detail ? " — " + detail : ""));
    failures++;
  }
}

// 用隔离的 CJS 环境加载 wasm-api 源码，glue 用 stub，避免碰真 wasm
function loadApi(source) {
  const module = { exports: {} };
  const stubGlue = {
    __wbg_get_imports: () => ({ wbg: {} }),
    __wbg_init_memory: () => {},
    __wbg_finalize_init: () => {},
  };
  const fakeRequire = (name) => {
    if (String(name).indexOf("wasm-glue") >= 0) return stubGlue;
    throw new Error("unexpected require: " + name);
  };
  new Function("require", "module", "exports", source)(fakeRequire, module, module.exports);
  return module.exports;
}

function runPage(source, label, broadcast, waitMs, expectedVerdict, expectTimeoutMsg) {
  return new Promise((resolve) => {
    let page = null;
    let workerHandler = null;
    const sandbox = {
      Page: (o) => {
        o.setData = function (patch) { Object.assign(this.data, patch); };
        page = o;
      },
      wx: {
        createWorker: () => ({
          onMessage: (h) => { workerHandler = h; },
          postMessage: () => {},
          terminate: () => {},
        }),
      },
      setTimeout, clearTimeout, Promise, JSON, Error, String, Number, Object, console,
    };
    vm.runInNewContext(source, sandbox, { filename: "index.js" });
    page.onLoad();
    if (broadcast && workerHandler) {
      workerHandler({ id: null, ok: false, error: "wasm 加载失败: WXWebAssembly 未定义" });
    }
    setTimeout(() => {
      check(label + "：verdict = " + expectedVerdict, page.data.verdict === expectedVerdict,
        "实得 " + page.data.verdict + " / " + page.data.errorMsg);
      if (expectTimeoutMsg) {
        check(label + "：失败原因带阶段与排查提示", /12 秒内没回应/.test(page.data.errorMsg || ""));
      }
      resolve();
    }, waitMs);
  });
}

// 用隔离环境加载 lib/wasm-client.js，桩 wx.createWorker 可控「回不回消息」。
// mode: silent（不回） / reply（立刻回） / destroy（调用后立刻销毁）。
// 传短 timeoutMs 避免像 C 那样干等 12 秒。
function runClient(source, timeoutMs, observeMs, mode) {
  return new Promise((resolve) => {
    let handler = null;
    const mod = { exports: {} };
    const sandbox = {
      module: mod,
      exports: mod.exports,
      require: () => { throw new Error("wasm-client 不应 require 任何模块"); },
      wx: {
        createWorker: () => ({
          onMessage: (h) => { handler = h; },
          postMessage: () => {},
          terminate: () => {},
        }),
      },
      setTimeout, clearTimeout, Promise, Error, Object, String, Array, Number, console,
    };
    try {
      vm.runInNewContext(source, sandbox, { filename: "wasm-client.js" });
    } catch (e) {
      // 解析/环境崩溃必须显式报红，不能让它伪装成「旧版不 settle」的通过。
      check("D：wasm-client 在桩里能正常加载", false, String((e && e.message) || e));
      resolve({ settled: null, errMsg: "" });
      return;
    }
    if (!mod.exports || typeof mod.exports.createSession !== "function") {
      check("D：wasm-client 导出 createSession", false, "导出缺失");
      resolve({ settled: null, errMsg: "" });
      return;
    }
    const session = mod.exports.createSession({ timeoutMs: timeoutMs });
    let settled = null;
    let errMsg = "";
    session.call("translate_jianpu_to_jianzi", ["{}"])
      .then(() => { settled = "resolved"; })
      .catch((e) => { settled = "rejected"; errMsg = String((e && e.message) || e); });
    if (mode === "reply" && handler) {
      handler({ id: 1, ok: true, result: "[]" });
    }
    if (mode === "destroy") {
      session.destroy();
    }
    setTimeout(() => resolve({ settled: settled, errMsg: errMsg }), observeMs);
  });
}

const boom = () => { throw new Error("WXWebAssembly 未定义"); };

// ---- A ----
console.log("== A. instantiateFn 同步抛错 ==");
(function () {
  const api = loadApi(apiSrc);
  let threwSync = false;
  let p;
  try {
    p = api.loadWasm(boom, "/wasm/x.wasm");
  } catch (e) {
    threwSync = true;
  }
  check("新版：没有同步抛出", !threwSync);
  check("新版：返回的是 Promise", !!p && typeof p.then === "function");
  if (p && p.catch) p.catch(() => {});
})();

(function () {
  const oldSrc = apiSrc.replace(
    /return Promise\.resolve\(\)\s*\.then\(function \(\) \{\s*return instantiateFn\(wasmPath, imports\);\s*\}\)/,
    "return Promise.resolve(instantiateFn(wasmPath, imports))",
  );
  if (oldSrc === apiSrc) {
    console.log("  ✗ 变异替换没命中，A 的变异验证无效");
    failures++;
    return;
  }
  const api = loadApi(oldSrc);
  let threwSync = false;
  try {
    const p = api.loadWasm(boom, "/wasm/x.wasm");
    if (p && p.catch) p.catch(() => {});
  } catch (e) {
    threwSync = true;
  }
  check("旧版：确实同步抛出（说明修复抓得住这个坑）", threwSync);
})();

// ---- B：广播到达时正在等待的请求 ----
console.log("== B. 主线程接住初始化失败广播 ==");
const broadcastOldSrc = pageSrc.replace(
  "        var isBroadcast = msg.id === null || msg.id === undefined;\n        if (!isBroadcast && msg.id !== p.id) return;",
  "        if (msg.id !== p.id) return;",
);
const tasks = [
  runPage(pageSrc, "新版", true, 300, "FAIL", false),
  broadcastOldSrc === pageSrc
    ? (console.log("  ✗ 变异替换没命中，B 的变异验证无效"), failures++, Promise.resolve())
    : runPage(broadcastOldSrc, "旧版", true, 300, "PENDING", false),
];

// ---- C：Worker 永不回应（约 13 秒） ----
console.log("== C. Worker 永不回应时的超时兜底（约 13 秒） ==");
const timeoutOldSrc = pageSrc.replace(
  "var PROBE_TIMEOUT_MS = 12000;",
  "var PROBE_TIMEOUT_MS = 99999999;",
);
tasks.push(runPage(pageSrc, "新版", false, 12600, "FAIL", true));
tasks.push(
  timeoutOldSrc === pageSrc
    ? (console.log("  ✗ 变异替换没命中，C 的变异验证无效"), failures++, Promise.resolve())
    : runPage(timeoutOldSrc, "旧版", false, 12600, "PENDING", false),
);

// ---- D：lib/wasm-client.js 的 Worker 永不回应（60ms 短超时） ----
console.log("== D. wasm-client 会话超时兜底（约 0.2 秒） ==");
const clientOldSrc = clientSrc.replace(
  /pending\[id\]\.timer = setTimeout\(function \(\) \{[\s\S]*?\}, timeoutMs\);/,
  "pending[id].timer = null; /* 变异：退回无超时版本 */",
);
tasks.push(runClient(clientSrc, 60, 200, "silent").then((r) => {
  check("D 新版：Worker 不回应时 call 会 reject", r.settled === "rejected", "实得 " + r.settled);
  check("D 新版：失败原因带耗时与排查提示",
    /秒内没回应/.test(r.errMsg) && /Worker 被回收/.test(r.errMsg), r.errMsg);
}));
tasks.push(runClient(clientSrc, 60, 200, "reply").then((r) => {
  check("D 新版：正常往返 resolve", r.settled === "resolved", "实得 " + r.settled);
}));
tasks.push(runClient(clientSrc, 60, 200, "destroy").then((r) => {
  check("D 新版：destroy 后不残留迟到 reject（timer 已清）", r.settled === null,
    "实得 " + r.settled);
}));
tasks.push(
  clientOldSrc === clientSrc
    ? (console.log("  ✗ 变异替换没命中，D 的变异验证无效"), failures++, Promise.resolve())
    : runClient(clientOldSrc, 60, 200, "silent").then((r) => {
        check("D 旧版：确实永远不 settle（说明修复抓得住这个坑）", r.settled === null,
          "实得 " + r.settled);
      }),
);

Promise.all(tasks).then(() => {
  console.log("");
  if (failures > 0) {
    console.log("变异验证失败：" + failures + " 项");
    process.exit(1);
  }
  console.log("全部通过：四处兜底都抓得住（新版绿、退回旧版红）");
  // 变异版把超时常量调到极大，timer 会挂在 event loop 上；显式退出
  process.exit(0);
});
