#!/usr/bin/env node
/**
 * 小程序 WASM 探针 —— 一键跑全部七个校验器。
 *
 * 为什么要这一个入口：校验器分散在 scripts/ 下，本地和 CI 各写七行容易漏，
 * 漏掉一个就等于「改坏了没人知道」。以后挂 CI 只需一行：
 *   node apps/miniprogram-wasm-probe/scripts/verify-all.mjs
 *
 * 用法：node scripts/verify-all.mjs（任意 cwd 都可以，用脚本自身位置定位工程根）
 * 退出码：全绿 0；任一校验器失败、崩溃或超时 → 1。
 *
 * 覆盖边界（别把这个脚本当成「小程序产品验证」）：
 * 它校验的是**本地可复现**的部分 —— 适配层逻辑、Worker 消息协议、兜底分支、
 * 页面数据链路与行为、工程静态约束、真机前静态预检（含产物同源）。
 * 真机 iOS/Android、包体积、性能、低版本基础库、WXML 排版仍需开发者工具实跑。
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const checks = [
  {
    name: "适配层：真 wasm 二进制 + 导出函数",
    file: "scripts/verify-adapter.mjs",
  },
  {
    name: "Worker 传输层：微信 worker 语义往返",
    file: "scripts/verify-worker-transport.cjs",
  },
  {
    name: "兜底变异验证：三处静默失败",
    file: "scripts/verify-guards.cjs",
  },
  {
    name: "页面数据链路：真 wasm 产出 → 映射渲染",
    file: "scripts/verify-pages.mjs",
  },
  {
    name: "页面行为：桩运行时跑真 wasm（点击/记录/解码）",
    file: "scripts/verify-page-logic.cjs",
  },
  {
    name: "工程静态校验：编译期约束",
    file: "scripts/lint-project.mjs",
  },
  {
    // 默认模式（不带 --strict）：仓库永远是 touristappid，strict 会红，
    // 所以 CI 只跑默认模式。--strict 留给 /tmp 真机副本。
    name: "真机前静态预检：AppID / 体积 / WASM / 产物同源",
    file: "scripts/precheck-real-device.mjs",
  },
];

const rows = [];
for (const c of checks) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [resolve(root, c.file)], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd();
  const ok = r.status === 0 && !r.error && !r.signal;
  rows.push({
    ...c,
    ok,
    ms: Date.now() - started,
    reason: r.error?.message ?? r.signal ?? `exit=${r.status}`,
    out,
  });
}

console.log("=== 小程序 WASM 探针 · 校验汇总 ===");
for (const r of rows) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}  (${r.ms}ms, ${r.file})`);
  if (r.ok) {
    // 绿灯只留每个校验器的收尾行，CI 日志不刷屏
    for (const line of r.out.split("\n").filter(Boolean).slice(-2)) {
      console.log(`    ${line.trim()}`);
    }
  } else {
    console.log(`    原因: ${r.reason}`);
    if (r.out) {
      console.log(
        r.out
          .split("\n")
          .map((l) => `    | ${l}`)
          .join("\n"),
      );
    }
  }
}

const failed = rows.filter((r) => !r.ok).length;
console.log(
  failed === 0
    ? `\n全部 ${rows.length} 个校验器通过`
    : `\n${failed}/${rows.length} 个校验器未通过`,
);
process.exit(failed === 0 ? 0 : 1);
