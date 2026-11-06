/**
 * 把 wasm-bindgen 生成的 ESM 胶水转成小程序 Worker 能用的 CommonJS。
 *
 * 为什么需要转换：
 * - 小程序 Worker 走 CommonJS `require`，没有 ES module 的 `export`
 * - 胶水的 `__wbg_init` 里用了 `import.meta.url`，在 CJS 里是**语法错误**
 *   （不是运行时错误，文件根本加载不了）
 * - 小程序主线程没有标准 `WebAssembly`，不能走 `fetch` + `instantiateStreaming`
 *   那条加载路径，要用 `WXWebAssembly.instantiate(代码包路径, imports)` 自己接
 *
 * 转换是纯文本的、确定性的：同样的输入必得同样的输出。改胶水版本后重跑本脚本，
 * 别手改生成物。
 *
 * 用法: node scripts/build-worker.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const glueSrc = resolve(repoRoot, "apps/web/public/wasm/taiyin_core.js");
const wasmSrc = resolve(repoRoot, "apps/web/public/wasm/taiyin_core_bg.wasm");
const outDir = resolve(here, "../workers");
const wasmOutDir = resolve(here, "../wasm");

let src = readFileSync(glueSrc, "utf8");

// 1) 公开函数去掉 export 前缀（`export function foo(` → `function foo(`）
const fnNames = [];
src = src.replace(/^export function (\w+)\(/gm, (m, name) => {
  fnNames.push(name);
  return `function ${name}(`;
});

// 2) 尾部的 export 语句整个换掉
const tailRe = /export \{ initSync \};\s*\nexport default __wbg_init;\s*$/;
if (!tailRe.test(src)) {
  throw new Error("胶水尾部结构变了（找不到 `export { initSync };`），转换脚本要跟着改");
}
src = src.replace(tailRe, "");

// 3) `import.meta.url` 在 CJS 里是语法错误。`__wbg_init` 的 fetch 加载路径
//    小程序用不到（我们走 WXWebAssembly.instantiate），把这处引用抹平即可。
const before = src;
src = src.replace(/new URL\('taiyin_core_bg\.wasm', import\.meta\.url\)/g, "null /* 小程序不走 fetch 加载 */");
if (src === before) {
  console.warn("warn: 没找到 import.meta.url 引用，胶水版本可能变了");
}

// 4) 追加导出：既给小程序 Worker 用，也让 Node 校验脚本能 require 到内部钩子
const exportsBlock = `
// ── 由 scripts/build-worker.mjs 生成，勿手改 ──
module.exports = {
${fnNames.map((n) => `  ${n},`).join("\n")}
  initSync,
  init: __wbg_init,
  // 以下三个是 wasm-bindgen 的内部钩子，给 WXWebAssembly 加载路径用：
  // get_imports 拿 import 对象 → instantiate 之后 finalize_init 收尾。
  __wbg_get_imports,
  __wbg_init_memory,
  __wbg_finalize_init,
};
`;

mkdirSync(outDir, { recursive: true });
mkdirSync(wasmOutDir, { recursive: true });
writeFileSync(resolve(outDir, "wasm-glue.js"), src + exportsBlock, "utf8");
copyFileSync(wasmSrc, resolve(wasmOutDir, "taiyin_core_bg.wasm"));

console.log("生成 workers/wasm-glue.js，导出:", fnNames.length, "个函数");
console.log("复制 wasm/taiyin_core_bg.wasm");
