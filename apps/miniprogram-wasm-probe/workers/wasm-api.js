/**
 * 小程序 WASM 适配层 —— 用 WXWebAssembly 加载 wasm-bindgen 产物。
 *
 * 这个文件是**真 Worker 与 Node 校验共用的同一份代码**：
 * 加载函数 `instantiateFn` 是注入的，小程序里传 WXWebAssembly.instantiate，
 * Node 校验里传一个由标准 WebAssembly 支撑的替身。这样「适配逻辑对不对」
 * 可以在没有微信开发者工具的机器上先证一遍，剩下的不确定性只在
 * WXWebAssembly 本身（需真机/模拟器验证）。
 *
 * 消息协议（主线程 ↔ Worker）：
 *   → { id, fn: "split_phrases_to_json", args: ["{...}"] }
 *   ← { id, ok: true, result: "..." } | { id, ok: false, error: "..." }
 *
 * 为什么必须走 Worker：小程序主线程没有标准 `WebAssembly` 全局，
 * 官方的 `WXWebAssembly` **只在 Worker 内可用**（基础库 v2.15.0+）。
 */

const glue = require("./wasm-glue.js");

/**
 * 创建一次性的 WASM 会话。
 *
 * @param {(path: string, imports: object) => Promise<{module: any, instance: any}>} instantiateFn
 * @param {string} wasmPath 代码包内 .wasm 路径（WXWebAssembly 只认字符串路径）
 */
function loadWasm(instantiateFn, wasmPath) {
  const imports = glue.__wbg_get_imports();
  glue.__wbg_init_memory(imports);

  // 必须以 Promise 链包住 instantiateFn：它在「WXWebAssembly 未定义」这类情况下
  // 是**同步抛错**，直接写 Promise.resolve(instantiateFn(...)) 会让整个 Worker
  // 脚本在 serve 注册监听之前就崩掉——症状是主线程永远等不到任何消息。
  return Promise.resolve()
    .then(function () {
      return instantiateFn(wasmPath, imports);
    })
    .then((result) => {
      if (!result || !result.instance) {
        throw new Error("instantiate 未返回 instance（拿到的不是 {module, instance}）");
      }
      // finalize_init 内部会把 instance.exports 挂到胶水的模块级变量上，
      // 再跑 __wbindgen_start。之后那 9 个函数才真正可用。
      glue.__wbg_finalize_init(result.instance, result.module);
      return glue;
    });
}

/** 按名字调用胶水导出的函数；fn 不存在时报错而不是静默返回 undefined。 */
function call(fn, args) {
  const target = glue[fn];
  if (typeof target !== "function") {
    throw new Error(`wasm 没有导出 ${fn}`);
  }
  return target.apply(null, Array.isArray(args) ? args : []);
}

/**
 * 把 Worker 的消息往返接到 WASM 上。
 *
 * @param {(instantiateFn: any, path: string) => Promise<any>} _unused 保留位
 * @param {object} opts
 * @param {string} opts.wasmPath
 * @param {(msg: object) => void} opts.postMessage
 * @param {(fn: Function) => void} opts.onMessage  注册消息回调
 * @param {any} opts.instantiateFn
 */
function serve(opts) {
  const { wasmPath, postMessage, onMessage, instantiateFn } = opts;
  let ready = loadWasm(instantiateFn, wasmPath);
  let initError = null;

  // 初始化失败要让调用方拿到错误，不能吞掉——吞掉的症状是「点了没反应」。
  // 广播一条 id=null 给主线程做即时提示；同时把错误记下来，
  // 保证**之后**发来的每个请求也能立刻拿到明确原因（广播可能早于请求到达）。
  ready.catch((e) => {
    initError = `wasm 加载失败: ${e && e.message ? e.message : e}`;
    postMessage({ id: null, ok: false, error: initError });
  });

  onMessage(function (msg) {
    const data = msg && msg.data !== undefined ? msg.data : msg;
    if (!data || data.id === undefined) return;

    if (initError) {
      postMessage({ id: data.id, ok: false, error: initError });
      return;
    }

    ready.then(
      function () {
        try {
          const result = call(data.fn, data.args);
          postMessage({ id: data.id, ok: true, result: result === undefined ? null : result });
        } catch (e) {
          postMessage({ id: data.id, ok: false, error: String((e && e.message) || e) });
        }
      },
      function (e) {
        postMessage({ id: data.id, ok: false, error: String((e && e.message) || e) });
      },
    );
  });

  return ready;
}

module.exports = { loadWasm, call, serve, glue };
