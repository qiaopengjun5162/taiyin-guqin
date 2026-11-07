/**
 * 小程序工程静态校验（不依赖微信开发者工具）。
 *
 * 覆盖原生工程约束里能靠读文件确定的问题：JSON 严格性、pages 完整性、
 * lazyCodeLoading、浏览器 API 禁用、WXML 表达式禁区、.wasm 位置。
 *
 * 它**不能**替代开发者工具的编译与真机验证——那些要 IDE。
 *
 * 用法: node scripts/lint-project.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

let failed = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

// ── 1. JSON 严格：能被 JSON.parse 就没有注释与尾逗号 ──
console.log("== JSON 严格性 ==");
for (const f of ["app.json", "project.config.json", "sitemap.json"]) {
  const p = join(root, f);
  if (!existsSync(p)) {
    check(`${f} 存在`, false);
    continue;
  }
  try {
    JSON.parse(readFileSync(p, "utf8"));
    check(`${f} 可严格解析`, true);
  } catch (e) {
    check(`${f} 可严格解析`, false, e.message);
  }
}

// ── 2. app.json 结构 ──
console.log("== app.json 结构 ==");
let appJson = null;
try {
  appJson = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
} catch {
  /* 上面已报 */
}
if (appJson) {
  check("pages 非空", Array.isArray(appJson.pages) && appJson.pages.length > 0);
  check("lazyCodeLoading=requiredComponents", appJson.lazyCodeLoading === "requiredComponents");

  for (const page of appJson.pages || []) {
    const wxml = join(root, `${page}.wxml`);
    const js = join(root, `${page}.js`);
    check(`页面 ${page} 的 .wxml 存在`, existsSync(wxml));
    check(`页面 ${page} 的 .js 存在`, existsSync(js));
    // 引用完整性：wxml 里 wx:if 等不会引用文件，但 usingComponents 会
    const pageJsonPath = join(root, `${page}.json`);
    if (existsSync(pageJsonPath)) {
      try {
        const pj = JSON.parse(readFileSync(pageJsonPath, "utf8"));
        for (const comp of Object.keys(pj.usingComponents || {})) {
          const ref = pj.usingComponents[comp];
          const cand = join(root, `${ref}.wxml`);
          check(`组件 ${comp} → ${ref} 存在`, existsSync(cand) || existsSync(join(root, `${ref}.js`)));
        }
      } catch (e) {
        check(`${page}.json 可解析`, false, e.message);
      }
    }
  }
}

// ── 2b. Worker 声明 ──
// 这是真机编译才暴露过的坑：app.json 不写 workers，Worker 目录根本不会被打包，
// 运行时报 "module 'workers/wasm-worker.js' is not defined"，主线程随后 12s 超时。
console.log("== Worker 声明 ==");
if (appJson) {
  // ⚠️ 必须把 lib/ 一起扫：Worker 创建已收进 lib/wasm-client.js，
  // 只扫 pages 会让「app.json 没声明 workers」这条守卫静默失效（假绿）。
  const scanDirs = [join(root, "pages"), join(root, "lib")];
  const pageSrc = (appJson.pages || [])
    .map((p) => {
      const f = join(root, `${p}.js`);
      return existsSync(f) ? readFileSync(f, "utf8") : "";
    })
    .concat(
      scanDirs
        .filter((d) => existsSync(d))
        .flatMap((d) =>
          readdirSync(d)
            .filter((n) => n.endsWith(".js"))
            .map((n) => readFileSync(join(d, n), "utf8")),
        ),
    )
    .join("\n");
  const entries = [...pageSrc.matchAll(/wx\.createWorker\(\s*["']([^"']+)["']/g)].map(
    (m) => m[1],
  );
  if (entries.length > 0) {
    const workerRoot =
      typeof appJson.workers === "string" ? appJson.workers : appJson.workers?.path;
    check(
      "app.json 声明了 workers 目录（不声明则 Worker 代码不打包）",
      typeof workerRoot === "string" && workerRoot.length > 0,
      `workers=${JSON.stringify(appJson.workers)}`,
    );
    for (const entry of entries) {
      const inside =
        workerRoot && (entry === workerRoot || entry.startsWith(`${workerRoot}/`));
      check(`Worker 入口 ${entry} 在声明的 workers 目录内`, !!inside);
      check(`Worker 入口 ${entry} 文件存在`, existsSync(join(root, entry)));
    }
  } else {
    check("页面未使用 wx.createWorker，跳过", true);
  }
}

// ── 3. 浏览器 API 禁用 ──
console.log("== 禁用浏览器 API ==");
const jsFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "scripts" || name === ".workbuddy") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith(".js")) jsFiles.push(p);
  }
})(root);

const banned = [/\bdocument\./, /\bwindow\./, /\blocalStorage\b/, /\bfetch\s*\(/, /\bimport\.meta\b/];
for (const f of jsFiles) {
  const src = readFileSync(f, "utf8");
  const hits = banned.filter((re) => re.test(src)).map((re) => re.source);
  // workers/wasm-glue.js 是生成物，且只在 Worker 里跑，不查它
  const rel = f.slice(root.length + 1);
  if (rel === join("workers", "wasm-glue.js")) {
    check(`${rel}（生成物）跳过浏览器 API 检查`, true);
    continue;
  }
  check(`${rel} 无浏览器 API`, hits.length === 0, hits.join(", "));
}

// ── 4. WXML 表达式禁区 ──
console.log("== WXML 表达式 ==");
const wxmlFiles = [];
(function walkW(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".workbuddy") continue;
    const st = statSync(p);
    if (st.isDirectory()) walkW(p);
    else if (name.endsWith(".wxml")) wxmlFiles.push(p);
  }
})(root);

for (const f of wxmlFiles) {
  const src = readFileSync(f, "utf8");
  // 只查 {{ }} 表达式内部
  const exprs = [...src.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]);
  const bad = exprs.filter((e) => /\?\.|\?\?|=>|\(/.test(e));
  check(
    `${f.slice(root.length + 1)} 表达式无 ?. / ?? / 箭头 / 函数调用`,
    bad.length === 0,
    bad.join(" | ").slice(0, 80),
  );
}

// ── 5. .wasm 必须在 worker 目录之外 ──
console.log("== wasm 位置 ==");
const workersDir = join(root, "workers");
const wasmInWorkers = existsSync(workersDir)
  ? readdirSync(workersDir).filter((n) => n.endsWith(".wasm"))
  : ["(workers 目录不存在)"];
check("workers/ 目录内没有 .wasm（微信只打包 .js）", wasmInWorkers.length === 0, wasmInWorkers.join(","));
check("wasm/taiyin_core_bg.wasm 存在", existsSync(join(root, "wasm", "taiyin_core_bg.wasm")));

// worker 引用的 .wasm 路径要真存在
const workerSrc = readFileSync(join(workersDir, "wasm-worker.js"), "utf8");
const m = workerSrc.match(/wasmPath:\s*["']([^"']+)["']/);
if (m) {
  const rel = m[1].replace(/^\//, "");
  check(`worker 引用的 ${m[1]} 真实存在`, existsSync(join(root, rel)));
} else {
  check("worker 里能读到 wasmPath", false);
}

console.log(failed === 0 ? "\n静态校验全部通过" : `\n${failed} 项不通过`);
process.exit(failed === 0 ? 0 : 1);
