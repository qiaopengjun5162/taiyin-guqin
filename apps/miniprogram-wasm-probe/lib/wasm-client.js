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
 *
 * 为什么必须自己带超时：pages/index 的探针页自带 12 秒超时，但走这个 client
 * 的「查音位」页以前没有。微信切后台可能回收 Worker，此时 postMessage 不报错、
 * 消息也永远不会回来；没有超时的话 Promise 永远 pending，页面 loading 不复位，
 * 连「失败」都判不出来。这里补上与探针页同口径的兜底（默认 12 秒，可按
 * createSession({ timeoutMs }) 覆盖，测试用短值避免干等）。
 */

var DEFAULT_TIMEOUT_MS = 12000;

function createSession(options) {
  if (typeof wx === "undefined" || !wx.createWorker) {
    throw new Error("createSession 需在微信小程序运行环境调用（wx.createWorker 不存在）");
  }
  var opts = options || {};
  var timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
    ? opts.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  var worker = wx.createWorker("workers/wasm-worker.js");
  var nextId = 1;
  var pending = {};

  // 所有出口都走这里：清 timer、摘掉 pending、只结算一次。
  // 分开写 resolve/reject 容易漏掉 clearTimeout，迟到的超时会把已成功的请求改成失败。
  function settle(id, err, result) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (p.timer) {
      clearTimeout(p.timer);
      p.timer = null;
    }
    if (err) {
      p.reject(err);
    } else {
      p.resolve(result);
    }
  }

  worker.onMessage(function (msg) {
    if (!msg) return;
    // 初始化失败的广播：id 为 null/undefined，让所有等待中的请求立刻失败。
    if (msg.id === null || msg.id === undefined) {
      var err = new Error(msg.error || "wasm 初始化失败");
      Object.keys(pending).forEach(function (k) {
        settle(k, err);
      });
      return;
    }
    if (msg.ok) {
      settle(msg.id, null, msg.result);
    } else {
      settle(msg.id, new Error(msg.error || "wasm 调用失败"));
    }
  });

  function call(fn, args) {
    return new Promise(function (resolve, reject) {
      var id = nextId;
      nextId = nextId + 1;
      pending[id] = { resolve: resolve, reject: reject, timer: null };
      pending[id].timer = setTimeout(function () {
        settle(id, new Error(
          "Worker " + (timeoutMs / 1000) + " 秒内没回应（" + fn + "）。常见原因：" +
          "切后台后 Worker 被回收、基础库过低、WXWebAssembly 不可用、" +
          "/wasm/ 路径没打进包里。请重新进入页面或点「重新探测」。"
        ));
      }, timeoutMs);
      worker.postMessage({ id: id, fn: fn, args: Array.isArray(args) ? args : [] });
    });
  }

  function destroy() {
    // 丢弃所有未完成请求，避免 onUnload 后回调打到已卸载的页面；
    // 同时清掉它们的 timer，否则页面卸载后定时器仍会触发并访问已失效的状态。
    Object.keys(pending).forEach(function (k) {
      var p = pending[k];
      if (p && p.timer) clearTimeout(p.timer);
      delete pending[k];
    });
    worker.terminate();
  }

  return { call: call, destroy: destroy };
}

module.exports = { createSession };
