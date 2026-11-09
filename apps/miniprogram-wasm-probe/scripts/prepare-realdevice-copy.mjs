#!/usr/bin/env node
/**
 * 生成「真机验证副本」：把探针工程复制到 /tmp，换上真 AppID，再在副本里自跑严格预检。
 *
 * 为什么要有这个脚本：
 * 真机预览不接受游客 AppID，而仓库必须继续保留 touristappid（不把测试号写进 git）。
 * 手工做法是 cp -R + 用编辑器改 project.config.json —— 容易漏改、容易复用上次的旧副本
 * （2026-11-07 那份 /tmp 副本就缺 lib/ 和三个新页面，直接导入会踩莫名其妙的坑）。
 *
 * 为什么漂移预检要在这里做：
 * 副本里没有 apps/web，compare 不到仓库产物；源码指纹也失效（副本里没有 Cargo.toml）。
 * 所以「这份 wasm 是不是当前核心」必须在复制前、在仓库里判一次。
 *
 * 用法：
 *   node apps/miniprogram-wasm-probe/scripts/prepare-realdevice-copy.mjs --appid wx1234567890abcdef
 *   node ... --appid wx... --out ~/taiyin-probe-realdevice --force
 *
 * 退出码：0 成功；1 预检/自检失败；2 参数不合法；3 目标目录已存在。
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspect as inspectWasmSync } from "./verify-wasm-sync.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_ROOT = resolve(HERE, "..");
const DEFAULT_OUT = "/tmp/taiyin-probe-realdevice";
const APPID_RE = /^wx[0-9a-f]{16}$/;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function parseArgs(argv) {
  const opts = { appid: "", out: DEFAULT_OUT, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--appid") opts.appid = String(argv[++i] ?? "").trim();
    else if (a === "--out") opts.out = String(argv[++i] ?? "").trim();
    else if (a === "--force") opts.force = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("--")) {
      console.error(`未知参数：${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function usage() {
  console.log(`生成小程序真机验证副本

用法：
  node apps/miniprogram-wasm-probe/scripts/prepare-realdevice-copy.mjs --appid wx<16位十六进制> [--out DIR] [--force]

参数：
  --appid   必填。真 AppID，形如 wx1234567890abcdef（不能是 touristappid）
  --out     输出目录，默认 ${DEFAULT_OUT}
  --force   目标目录已存在时覆盖

做完之后：开发者工具「导入项目」→ 选这个目录 → 扫码预览。`);
}

function fail(msg, code) {
  console.error(`\n✗ ${msg}`);
  process.exit(code);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  usage();
  process.exit(0);
}

// ── 1. 参数校验 ───────────────────────────────────────────────────
if (!opts.appid) fail("缺少 --appid。真机预览不接受游客号，请填真 AppID。", 2);
if (opts.appid === "touristappid") {
  fail("--appid 不能是 touristappid（游客号过不了真机预览校验）。", 2);
}
if (!APPID_RE.test(opts.appid)) {
  fail(`AppID 格式不对：${opts.appid}\n  应为 wx + 16 位小写十六进制，例如 wx1234567890abcdef`, 2);
}

const out = isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out);

// ── 2. 复制前：仓库侧漂移预检 ─────────────────────────────────────
const drift = inspectWasmSync().filter((r) => r.level === "FAIL");
if (drift.length) {
  console.error("\n✗ 探针产物与当前核心不一致，先重建再复制（否则真机验的是旧二进制）：");
  for (const r of drift) console.error(`  · ${r.name}\n      ${r.detail}`);
  fail("修法：just rebuild-probe-wasm", 1);
}

// ── 3. 目标目录 ──────────────────────────────────────────────────
if (existsSync(out)) {
  const entries = readdirSync(out);
  if (entries.length && !opts.force) {
    fail(
      `目标目录已存在且非空：${out}\n` +
        "  上一次的旧副本可能缺目录/缺新页面，别直接复用。\n" +
        "  要么加 --force 覆盖，要么用 --out 换个路径。",
      3,
    );
  }
}

// ── 4. 复制（排除 .workbuddy / node_modules；保留 scripts 供副本内自检）──
const SKIP = new Set([".workbuddy", "node_modules", ".git"]);
cpSync(PROBE_ROOT, out, {
  recursive: true,
  force: true,
  filter: (src) => {
    const name = src.split("/").pop() ?? "";
    return !SKIP.has(name);
  },
});

// ── 5. 写 appid ──────────────────────────────────────────────────
const cfgPath = resolve(out, "project.config.json");
let cfg;
try {
  cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
} catch (e) {
  fail(`副本里的 project.config.json 无法解析：${e.message}`, 1);
}
const beforeAppid = cfg.appid;
cfg.appid = opts.appid;
// 换个工程名，避免开发者工具按名字复用旧工程的本地缓存（设置/编译产物）
cfg.projectname = "taiyin-realdevice";
writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");

// ── 6. 回读断言 ──────────────────────────────────────────────────
const check = JSON.parse(readFileSync(cfgPath, "utf8"));
if (check.appid !== opts.appid) fail("写入 AppID 失败（回读不一致）", 1);

const wasmPath = resolve(out, "wasm/taiyin_core_bg.wasm");
if (!existsSync(wasmPath)) fail("副本里缺 wasm/taiyin_core_bg.wasm", 1);
const wasmBuf = readFileSync(wasmPath);
if (wasmBuf.subarray(0, 4).toString("hex") !== "0061736d") {
  fail("副本里的 wasm 魔数非法", 1);
}

// ── 7. 副本内严格预检 ────────────────────────────────────────────
console.log(`副本已生成：${out}`);
console.log(`  AppID    ${beforeAppid} → ${opts.appid}`);
console.log(`  wasm     ${kb(wasmBuf.length)}，sha256 ${sha256(wasmBuf).slice(0, 12)}…`);
console.log("\n在副本里跑严格预检…\n");

const r = spawnSync(process.execPath, [resolve(out, "scripts/precheck-real-device.mjs"), "--strict"], {
  cwd: out,
  encoding: "utf8",
});
process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
if (r.status !== 0) {
  fail(
    `副本自检未通过（退出码 ${r.status ?? "?"}）。副本保留在 ${out} 供排查。`,
    1,
  );
}

// ── 8. 下一步 ────────────────────────────────────────────────────
const tail = opts.appid.slice(-4);
console.log(`\nPREPARED ${out}`);
console.log(`  （AppID 尾号 ${tail}，只在副本里，仓库仍是 touristappid）`);
console.log("\n接下来三步：");
console.log("  1. 微信开发者工具 → 导入项目 → 目录填上面的路径（AppID 会自动带出）");
console.log("  2. 模拟器里点三个入口，自检面板应显示 PASS · 链路跑通");
console.log("  3. 右上「预览」→ 手机扫码，按 REAL-DEVICE-CHECKLIST.md 第六节点 5 项");
console.log("\n若「预览」是灰的：设置 → 安全设置 → 打开「服务端口」。");
