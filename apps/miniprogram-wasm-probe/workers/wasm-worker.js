/**
 * 小程序 Worker 入口：用 WXWebAssembly 加载 taiyin-core，走消息协议。
 *
 * 注意：.wasm **必须放在 worker 目录之外**（workers/ 目录只打包 .js，
 * 非 .js 文件会被忽略，是微信的既定行为）。所以路径是 /wasm/...。
 */
const api = require("./wasm-api.js");

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
    // Worker 全局的 postMessage
    self.postMessage(msg);
  },
  onMessage: function (handler) {
    self.onmessage = function (e) {
      handler(e);
    };
  },
});
