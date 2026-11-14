#!/usr/bin/env node
/*
 * 项目家底统计：可复跑、零依赖、只读。
 *
 *   node scripts/measure-codebase.mjs
 *
 * 为什么需要它：docs/overview.md「代码规模」表是带日期的快照，但原文没给
 * 统计命令。同事复核时只要口径差一点，就会数出完全不同的结果并误判文档错，
 * 例如：
 *   - 只数各 crate 的 src 目录会得到 12,112 行，文档口径是 crates 下全部 .rs
 *     （含 tests / examples）；
 *   - macOS 的 BSD grep 不认 \s 与 \b，'^[[:space:]]*#\[test\]' 这类写法
 *     若写成 '^\s*#\[test\]' 会一条都数不到；
 *   - 「组件」按顶层 *.tsx 数是 28，递归含子目录与测试文件是 56。
 * 口径写死在这里，路径由 import.meta.url 定位，与当前工作目录无关。
 *
 * 刻意不设硬阈值、不接 CI：规模快照本来就允许随开发滞后，硬闸门会逼着
 * 每加一个测试就改十处文档，反而诱发漂移。真正必须钉死的对外字形数字
 * 另有闸门：apps/web/src/lib/glyph-inventory.test.ts。
 * 唯一会 exit 1 的情况是脚本自己失效（目录不存在 / 某项数出 0）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, predicate, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, predicate, out);
    else if (stat.isFile() && predicate(path)) out.push(path);
  }
  return out;
}

/** 与 `wc -l` 一致：数换行符，而不是 split 后的数组长度。 */
function lineCount(path) {
  const text = readFileSync(path, "utf8");
  return (text.match(/\n/g) ?? []).length;
}

function sumLines(files) {
  return files.reduce((total, path) => total + lineCount(path), 0);
}

function countMatches(text, regex) {
  return (text.match(regex) ?? []).length;
}

// ---- Rust：crates 下全部 .rs（含 src / tests / examples）----
const rustFiles = walk(join(ROOT, "crates"), (p) => p.endsWith(".rs"));
const rustTexts = rustFiles.map((p) => readFileSync(p, "utf8"));
const rustLines = sumLines(rustFiles);
const rustTestAttrs = rustTexts.reduce(
  (n, text) => n + countMatches(text, /^\s*#\[test\]/gm),
  0,
);
const rustTokioTests = rustTexts.reduce(
  (n, text) => n + countMatches(text, /^\s*#\[tokio::test\b/gm),
  0,
);

// ---- 前端：apps/web/src 下全部 .ts / .tsx ----
const webSrc = join(ROOT, "apps", "web", "src");
const webFiles = walk(webSrc, (p) => /\.tsx?$/.test(p));
const webLines = sumLines(webFiles);
const testFiles = webFiles.filter((p) => /\.test\.tsx?$/.test(p));
const staticCases = testFiles.reduce(
  (n, p) =>
    n +
    countMatches(readFileSync(p, "utf8"), /(^|[^A-Za-z0-9_])(it|test)\(/gm),
  0,
);
const parameterized = testFiles.reduce(
  (n, p) =>
    n + countMatches(readFileSync(p, "utf8"), /(^|[^A-Za-z0-9_])(it|test)\.each/gm),
  0,
);
// 「组件」口径：components 目录顶层、排除测试文件。
const components = readdirSync(join(webSrc, "components")).filter(
  (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"),
).length;
// 「页面」口径：app 路由目录下所有 page.tsx。
const pages = walk(join(webSrc, "app"), (p) => p.endsWith(`${sep}page.tsx`)).length;

// ---- 后端路由：routes.rs 里的 .route( / .route_service( 调用 ----
const routesText = readFileSync(
  join(ROOT, "crates", "taiyin-server", "src", "routes.rs"),
  "utf8",
);
const routes = countMatches(routesText, /\.(route|route_service)\(/g);

const metrics = [
  ["Rust 行数", rustLines, "crates 下全部 .rs，含 tests / examples"],
  ["Rust #[test]", rustTestAttrs, "行首属性，含 cfg(test) 模块内"],
  ["Rust #[tokio::test]", rustTokioTests, "含带参数形式"],
  ["Rust 测试属性合计", rustTestAttrs + rustTokioTests, ""],
  ["前端行数", webLines, "apps/web/src 下全部 .ts / .tsx"],
  ["前端组件", components, "components 顶层 *.tsx，排除测试"],
  ["前端页面", pages, "app 下 page.tsx"],
  ["前端测试文件", testFiles.length, "src 下 *.test.ts / *.test.tsx"],
  ["前端静态用例", staticCases, "it( / test( 调用点"],
  ["参数化入口", parameterized, "it.each / test.each，CI 会展开成多条"],
  ["后端路由", routes, "routes.rs 的 .route( / .route_service("],
];

const labelWidth = Math.max(...metrics.map(([label]) => label.length));
console.log(`仓库：${ROOT}`);
console.log(`统计口径：见 scripts/measure-codebase.mjs 文件头\n`);
for (const [label, value, note] of metrics) {
  console.log(
    `${label.padEnd(labelWidth)}  ${String(value).padStart(7)}${note ? `   ${note}` : ""}`,
  );
}
console.log(
  `\n合计 ${(rustLines + webLines).toLocaleString("en-US")} 行 / ` +
    `${(rustTestAttrs + rustTokioTests + staticCases).toLocaleString("en-US")} 条静态测试`,
);
console.log(
  "\n提示：CI 的 `Tests N passed` 是实际执行数（参数化用例展开后更多），" +
    "与上面的静态调用点计数口径不同，不能直接拿来判文档错。\n" +
    "docs/overview.md 的代码规模表是 2026-11-12 快照，按规矩保留；" +
    "当前值以本脚本输出为准。",
);

const broken = metrics.filter(([, value]) => !Number.isFinite(value) || value <= 0);
if (broken.length > 0) {
  console.error(`\n统计失效（可能路径变了或口径不适用）：${broken.map(([l]) => l).join(", ")}`);
  process.exit(1);
}
