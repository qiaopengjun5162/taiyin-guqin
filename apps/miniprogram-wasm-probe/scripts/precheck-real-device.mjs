#!/usr/bin/env node
/**
 * 小程序「真机前」静态预检 —— 把不用真机就能排掉的雷先排掉。
 *
 * 边界（别把这个脚本当成真机验证）：
 *   它只算静态事实：AppID、打包体积、WASM 合法性、workers 声明、基础库版本。
 *   iOS/Android 真机、WXWebAssembly 真机可用性、WXML 排版、性能、低版本基础库
 *   仍必须开微信开发者工具 GUI + 真手机实跑，见 REAL-DEVICE-CHECKLIST.md。
 *
 * 用法（任意 cwd 都可，用脚本自身位置定位工程根）：
 *   node apps/miniprogram-wasm-probe/scripts/precheck-real-device.mjs
 *   node .../precheck-real-device.mjs --strict   # 真机出发前跑：AppID 必须已换
 *
 * 退出码：默认模式遇 FAIL 才非 0；WARN 不阻塞（仓库态 touristappid 是刻意保留的）。
 *         --strict 下 touristappid 升级为 FAIL。
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const MAIN_PACKAGE_LIMIT = 2 * 1024 * 1024; // 微信主包 2MB
const rows = [];

const add = (level, name, detail) => rows.push({ level, name, detail });

// ── 1. 配置文件可解析 ────────────────────────────────────────────────
let appJson, projCfg;
try {
  appJson = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
  projCfg = JSON.parse(readFileSync(join(root, "project.config.json"), "utf8"));
  add("PASS", "app.json / project.config.json 可严格解析", "");
} catch (e) {
  add("FAIL", "配置文件解析", e.message);
  report();
}

// ── 2. AppID：真机的头号拦路虎 ───────────────────────────────────────
const appid = String(projCfg.appid || "");
if (!appid || appid === "touristappid") {
  add(
    strict ? "FAIL" : "WARN",
    "AppID 是游客号 touristappid",
    strict
      ? "真机预览必须先换成真 AppID；仓库刻意保留游客号，请在 /tmp 副本里改，别提交"
      : "仓库态刻意保留（不把测试号写进 git）。真机前照 REAL-DEVICE-CHECKLIST.md 第 1 步做副本并替换",
  );
} else {
  add("PASS", "AppID 非游客号", appid);
}

// ── 3. 打包体积（按 packOptions.ignore 排除，算实际上传字节）─────────
const ignored = new Set(
  (projCfg.packOptions?.ignore || [])
    .filter((x) => x.type === "folder" || x.type === "file")
    .map((x) => String(x.value).replace(/^\.\//, "").replace(/\/$/, "")),
);
let total = 0;
let biggest = { size: 0, path: "" };
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = relative(root, join(dir, e.name));
    if (ignored.has(rel.split("/")[0]) || rel.startsWith(".git")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) {
      const s = statSync(p).size;
      total += s;
      if (s > biggest.size) biggest = { size: s, path: rel };
    }
  }
};
walk(root);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
if (total > MAIN_PACKAGE_LIMIT) {
  add("FAIL", "主包体积超 2MB", `${kb(total)} > ${kb(MAIN_PACKAGE_LIMIT)}；需分包或裁剪`);
} else {
  add("PASS", "主包体积在 2MB 内", `${kb(total)}（排除 ${[...ignored].join(", ") || "无"}）`);
}
add("INFO", "最大单文件", `${biggest.path} = ${kb(biggest.size)}`);

// ── 4. WASM 文件合法 + 大小 ──────────────────────────────────────────
const wasmPath = join(root, "wasm", "taiyin_core_bg.wasm");
if (!existsSync(wasmPath)) {
  add("FAIL", "wasm/taiyin_core_bg.wasm 不存在", "");
} else {
  const buf = readFileSync(wasmPath);
  const magic = buf.subarray(0, 4).toString("hex");
  if (magic !== "0061736d") add("FAIL", "WASM 头非法", `magic=${magic}，应为 0061736d`);
  else add("PASS", "WASM 二进制合法", `${kb(buf.length)}，magic=0061736d`);
  if (buf.length > 1024 * 1024) add("WARN", "WASM 超过 1MB", "真机实例化耗时/内存需实机观察");
}

// ── 5. workers 声明与目录 ────────────────────────────────────────────
const workerDir = appJson.workers;
if (!workerDir) add("FAIL", "app.json 未声明 workers", "WXWebAssembly 只能在 Worker 内用");
else if (!existsSync(join(root, workerDir))) add("FAIL", `workers 目录 ${workerDir} 不存在`, "");
else add("PASS", "workers 已声明且目录存在", String(workerDir));

// ── 6. 基础库版本（真机低版本是未验边界）────────────────────────────
const libVersion = projCfg.libVersion || projCfg.setting?.libVersion;
if (!libVersion) {
  add("WARN", "未固定基础库版本 libVersion", "开发者工具会用最新；真机须补测低版本基础库是否有 WXWebAssembly");
} else {
  add("PASS", "基础库版本已固定", String(libVersion));
}

// ── 7. 页面文件齐全 ──────────────────────────────────────────────────
const missing = [];
for (const page of appJson.pages || []) {
  for (const ext of ["wxml", "js", "json", "wxss"]) {
    if (!existsSync(join(root, `${page}.${ext}`))) missing.push(`${page}.${ext}`);
  }
}
if (missing.length) add("FAIL", "页面文件缺失", missing.join(", "));
else add("PASS", "页面四件套齐全", `${(appJson.pages || []).length} 个页面`);

function report() {
  const icon = { PASS: "✓", WARN: "!", FAIL: "✗", INFO: "·" };
  console.log(`小程序真机前静态预检${strict ? "（--strict）" : ""}`);
  console.log("─".repeat(60));
  for (const r of rows) {
    console.log(`${icon[r.level]} [${r.level}] ${r.name}${r.detail ? `\n      ${r.detail}` : ""}`);
  }
  console.log("─".repeat(60));
  const c = (lv) => rows.filter((r) => r.level === lv).length;
  console.log(`汇总：PASS ${c("PASS")} / WARN ${c("WARN")} / FAIL ${c("FAIL")}`);
  console.log("边界：本脚本不替代真机。WXML 排版、WXWebAssembly 真机可用性、性能、低版本基础库仍需 GUI 实跑。");
  process.exit(c("FAIL") > 0 ? 1 : 0);
}

report();
