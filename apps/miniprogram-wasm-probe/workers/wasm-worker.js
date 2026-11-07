/**
 * 小程序 Worker 入口：用 WXWebAssembly 加载 taiyin-core，走消息协议。
 *
 * 注意：.wasm **必须放在 worker 目录之外**（workers/ 目录只打包 .js，
 * 非 .js 文件会被忽略，是微信的既定行为）。所以路径是 /wasm/...。
 */
const api = require("./wasm-api.js");

// ⚠️ 小程序 Worker 不是标准 Web Worker：没有 `self`。
// 微信在 Worker 上下文里全局暴露的是 `worker`，用 worker.onMessage / worker.postMessage，
// 且回调拿到的是 { message }，不是标准 Web Worker 的 { data }。
// 写 self.onmessage 会在真机报 "Cannot set properties of undefined (setting 'onmessage')"。
const workerGlobal =
  typeof worker !== "undefined"
    ? worker
    : typeof self !== "undefined"
      ? self
      : null;
if (!workerGlobal) throw new Error("找不到 Worker 全局对象（worker / self 都没有）");

api.serve({
  wasmPath: "/wasm/taiyin_core_bg.wasm",
  instantiateFn: function (path, imports) {
    // WXWebAssembly.instantiate 与标准 WebAssembly.instantiate 类似，
    // 区别只在第一个参数是「代码包内字符串路径」而不是字节。
    // 缺这个全局时不要让它变成 ReferenceError 把 Worker 打崩，给一句可诊断的话。
    if (typeof WXWebAssembly === "undefined") {
      throw new Error("WXWebAssembly 未定义：需在 Worker 内使用，且基础库 ≥ 2.15.0");
    }
    return WXWebAssembly.instantiate(path, imports);
  },
  postMessage: function (msg) {
    workerGlobal.postMessage(msg);
  },
  onMessage: function (handler) {
    if (typeof workerGlobal.onMessage === "function") {
      // 小程序 Worker：回调参数是 { message }，转成适配层期望的 { data }
      workerGlobal.onMessage(function (res) {
        handler({ data: res && res.message !== undefined ? res.message : res });
      });
    } else {
      // 标准 Web Worker（本地 Node 校验器等场景）
      workerGlobal.onmessage = function (e) {
        handler(e);
      };
    }
  },
});
