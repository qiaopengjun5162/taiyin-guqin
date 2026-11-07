/**
 * 小程序端 WASM 调用客户端 —— 复用探针验证过的 WXWebAssembly 链路。
 *
 * 协议与 workers/wasm-api.js 完全一致：
 *   主线程 → Worker: { id, fn: "函数名", args: [...] }
 *   Worker → 主线程: { id, ok: true, result } | { id, ok: false, error }
 *                 广播错误用 id: null（初始化失败时），需让所有等待中的请求失败，
 *                 而不是一直转圈。
 *
 * 用法（每个页面 onLoad 建一个 session，onUnload 销毁）：
 *   const session = createSession();
 *   session.call("translate_jianpu_to_jianzi", [jsonString])
 *     .then(res => ...)
 *     .catch(err => ...);
 *   // onUnload:
 *   session.destroy();
 */

function createSession() {
  if (typeof wx === "undefined" || !wx.createWorker) {
    throw new Error("createSession 需在微信小程序运行环境调用（wx.createWorker 不存在）");
  }
  const worker = wx.createWorker("workers/wasm-worker.js");
  let nextId = 1;
  const pending = {};

  worker.onMessage(function (msg) {
    if (!msg) return;
    // 初始化失败的广播：id 为 null/undefined，让所有等待中的请求立刻失败。
    if (msg.id === null || msg.id === undefined) {
      const err = new Error(msg.error || "wasm 初始化失败");
      Object.keys(pending).forEach(function (k) {
        const p = pending[k];
        if (p) {
          delete pending[k];
          p.reject(err);
        }
      });
      return;
    }
    const p = pending[msg.id];
    if (!p) return; // 不是本 session 关心的请求（理论上不会，id 唯一）
    delete pending[msg.id];
    if (msg.ok) {
      p.resolve(msg.result);
    } else {
      p.reject(new Error(msg.error || "wasm 调用失败"));
    }
  });

  function call(fn, args) {
    return new Promise(function (resolve, reject) {
      const id = nextId;
      nextId = nextId + 1;
      pending[id] = { resolve: resolve, reject: reject };
      worker.postMessage({ id: id, fn: fn, args: Array.isArray(args) ? args : [] });
    });
  }

  function destroy() {
    // 丢弃所有未完成请求，避免 onUnload 后回调打到已卸载的页面。
    Object.keys(pending).forEach(function (k) {
      delete pending[k];
    });
    worker.terminate();
  }

  return { call: call, destroy: destroy };
}

module.exports = { createSession };
