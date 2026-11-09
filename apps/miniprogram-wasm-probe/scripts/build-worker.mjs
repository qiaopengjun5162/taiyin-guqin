/**
 * 把 wasm-bindgen 生成的 ESM 胶水转成小程序 Worker 能用的 CommonJS，
 * 并把产物同步进探针工程，同时记录一份「这份二进制从哪来」的来源清单。
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
 * 为什么还要写 wasm-provenance.json：
 * 2026-11-08 的 commit d6aebff 改了根 Cargo.toml 的 release profile（lto/strip/opt-level），
 * web 产物从 276,675 掉到 231,388 字节，但探针里的 wasm 没跟着重建——
 * 导出函数名两边完全一样，所以「导出集对比」根本发现不了这种漂移。
 * 来源清单记下「源码 + 构建配置」的指纹，就能抓到「源码/profile 变了但产物没重建」。
 *
 * 用法: node apps/miniprogram-wasm-probe/scripts/build-worker.mjs
 *       （也可 `just rebuild-probe-wasm`：先 build-wasm 再跑本脚本）
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 仓库根（脚本位于 apps/miniprogram-wasm-probe/scripts）。 */
export const REPO_ROOT = resolve(HERE, "../../..");
/** wasm-bindgen 生成的 ESM 胶水，唯一输入源。 */
export const GLUE_SRC = resolve(REPO_ROOT, "apps/web/public/wasm/taiyin_core.js");
/** 与 web 站点共用的同一份 wasm 二进制。 */
export const WASM_SRC = resolve(REPO_ROOT, "apps/web/public/wasm/taiyin_core_bg.wasm");
/** 来源清单，被 verify-wasm-sync 读取。放在 scripts/ 下，不进微信包（packOptions.ignore 排除该目录）。 */
export const PROVENANCE_PATH = resolve(HERE, "wasm-provenance.json");

const OUT_DIR = resolve(HERE, "../workers");
const WASM_OUT_DIR = resolve(HERE, "../wasm");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * 纯转换：ESM 胶水 → 小程序 Worker 可 require 的 CJS。
 * 不碰文件系统，供 verify-wasm-sync 复用（保证「校验的转换」就是「构建的转换」）。
 *
 * @param {string} src 胶水源码
 * @returns {{ code: string, fnNames: string[], warnings: string[] }}
 */
export function transformGlue(src) {
  const warnings = [];
  const fnNames = [];

  // 1) 公开函数去掉 export 前缀（`export function foo(` → `function foo(`）
  let code = src.replace(/^export function (\w+)\(/gm, (_m, name) => {
    fnNames.push(name);
    return `function ${name}(`;
  });

  // 2) 尾部的 export 语句整个换掉
  const tailRe = /export \{ initSync \};\s*\nexport default __wbg_init;\s*$/;
  if (!tailRe.test(code)) {
    throw new Error("胶水尾部结构变了（找不到 `export { initSync };`），转换脚本要跟着改");
  }
  code = code.replace(tailRe, "");

  // 3) `import.meta.url` 在 CJS 里是语法错误。`__wbg_init` 的 fetch 加载路径
  //    小程序用不到（我们走 WXWebAssembly.instantiate），把这处引用抹平即可。
  const before = code;
  code = code.replace(
    /new URL\('taiyin_core_bg\.wasm', import\.meta\.url\)/g,
    "null /* 小程序不走 fetch 加载 */",
  );
  if (code === before) warnings.push("没找到 import.meta.url 引用，胶水版本可能变了");

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

  return { code: code + exportsBlock, fnNames, warnings };
}

/** 读 wasm 的导出表（名称 + 类型），用于清单记录与差异诊断。 */
export function wasmExports(buf) {
  const mod = new WebAssembly.Module(buf);
  return WebAssembly.Module.exports(mod).map((e) => ({ name: e.name, kind: e.kind }));
}

/** 公开函数名：排除 `__wbindgen_*` 内部钩子与 `memory` 等非函数导出。 */
export const publicExportNames = (exports) =>
  exports
    .filter((e) => e.kind === "function" && !e.name.startsWith("__") && e.name !== "memory")
    .map((e) => e.name)
    .sort();

const SKIP_DIRS = new Set(["target", "pkg", "node_modules", ".git"]);

function walkSources(dir, out) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkSources(p, out);
    else if (e.isFile()) out.push(p);
  }
}

/**
 * 来源指纹：把「会影响 wasm 产物」的源码与构建配置一起哈希。
 *
 * 刻意排除 Cargo.lock —— 它近 50 次提交里改了 13 次（约 26%），
 * 把服务端依赖变更也算成漂移会让探针四分之一次提交假红。
 * 已知盲区：wasm-bindgen 已在 crates/taiyin-core/Cargo.toml 用 `=0.2.100` 精确钉死，
 * 传递依赖变更极少影响 wasm 输出。
 */
export function computeSourceFingerprint(repoRoot = REPO_ROOT) {
  const files = [
    resolve(repoRoot, "Cargo.toml"),
    resolve(repoRoot, "crates/taiyin-core/Cargo.toml"),
  ];
  walkSources(resolve(repoRoot, "crates/taiyin-core/src"), files);

  const inputs = files
    .filter((f) => existsSync(f))
    .map((f) => relative(repoRoot, f).split("\\").join("/"))
    .sort();

  const payload = inputs
    .map((rel) => `${rel}\u0000${sha256(readFileSync(resolve(repoRoot, rel)))}\n`)
    .join("");

  return { fingerprint: `sha256:${sha256(payload)}`, inputs };
}

const firstVersion = (text) => {
  const semver = text.match(/\d+\.\d+\.\d+/);
  if (semver) return semver[0];
  const tail = text.trim().match(/(\d+)\s*$/);
  return tail ? tail[1] : "unknown";
};

const toolVersion = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20_000 });
  if (r.error || r.status !== 0) return "unavailable";
  return firstVersion(`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n")[0] ?? "");
};

function describeMissing(p, hint) {
  return new Error(
    `找不到 ${relative(REPO_ROOT, p)}\n` +
      `  这一步需要 wasm-bindgen 产物先就位：${hint}\n` +
      `  完整重建：just rebuild-probe-wasm`,
  );
}

function main() {
  if (!existsSync(GLUE_SRC)) throw describeMissing(GLUE_SRC, "先跑 just build-wasm");
  if (!existsSync(WASM_SRC)) throw describeMissing(WASM_SRC, "先跑 just build-wasm");

  const src = readFileSync(GLUE_SRC, "utf8");
  const { code, fnNames, warnings } = transformGlue(src);
  for (const w of warnings) console.warn(`warn: ${w}`);

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(WASM_OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "wasm-glue.js"), code, "utf8");
  copyFileSync(WASM_SRC, resolve(WASM_OUT_DIR, "taiyin_core_bg.wasm"));

  const wasmBuf = readFileSync(WASM_SRC);
  const { fingerprint, inputs } = computeSourceFingerprint();
  const provenance = {
    schema: 1,
    note: "由 scripts/build-worker.mjs 生成，勿手改。不含时间戳，无变化重跑不会产生 diff。",
    sourceFingerprint: fingerprint,
    sourceInputs: inputs,
    wasm: { bytes: wasmBuf.length, sha256: sha256(wasmBuf) },
    glue: { bytes: Buffer.byteLength(code, "utf8"), sha256: sha256(code) },
    publicExports: publicExportNames(wasmExports(wasmBuf)),
    toolchain: {
      rustc: toolVersion("rustc", ["--version"]),
      wasmPack: toolVersion("wasm-pack", ["--version"]),
      wasmOpt: toolVersion("wasm-opt", ["--version"]),
    },
  };
  writeFileSync(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");

  console.log(`生成 workers/wasm-glue.js，导出: ${fnNames.length} 个函数`);
  console.log(
    `复制 wasm/taiyin_core_bg.wasm（${wasmBuf.length} 字节，sha256 ${provenance.wasm.sha256.slice(0, 12)}…）`,
  );
  console.log(`记录来源清单 scripts/wasm-provenance.json（${inputs.length} 个输入）`);
}

// 只有直接运行才执行主流程；被 import 时（verify-wasm-sync）只拿到纯函数。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
