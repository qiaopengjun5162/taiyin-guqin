#!/usr/bin/env node
/**
 * WASM 产物新鲜度闸门：提交进 git 的 `.wasm` 必须与 Rust 源码同步。
 *
 * ## 为什么需要
 *
 * `apps/web/wasm/` 与 `apps/web/public/wasm/` 是**提交进仓库**的产物
 * （小程序探针与部分 CI 步骤直接复用，见 `.gitignore` 白名单）。
 * 这带来一个安静的失效模式：
 *
 *   改了 `crates/taiyin-core/src/**` → 忘记 `just build-wasm` →
 *   前端测试仍跑**旧** `.wasm` → 全绿。
 *
 * 2026-11-17 的连打解析器迁移就撞到过这个窗口：Rust 逻辑已改，
 * 但没重建产物时，跑真实 WASM 的用例测的是旧行为。CI 因为每次都重建
 * 所以不会绿得可疑，但**本地**会。这个脚本把「本地也能发现」补上。
 *
 * ## 判据
 *
 * 不看 mtime（git clone 后全变、不可靠），看**内容指纹**：
 * 把产物哈希写进 `wasm-manifest.json`，与源码树哈希比对。
 * 源码哈希只覆盖 `crates/taiyin-core` 下会进入 wasm 的文件
 * （`.rs` / `Cargo.toml`），排除 `pkg/` 与本文件自身。
 *
 * ## 用法
 *
 *   node scripts/verify-wasm-fresh.mjs           # 校验，过期则退出码 1
 *   node scripts/verify-wasm-fresh.mjs --write   # 重建后写回清单（just build-wasm 会调）
 *
 * 本脚本**只读**源码；`--write` 只写 `wasm-manifest.json`。
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_DIR = join(ROOT, "crates/taiyin-core");
const MANIFEST = join(ROOT, "crates/taiyin-core/wasm-manifest.json");
const ARTIFACTS = [
  "apps/web/wasm/taiyin_core_bg.wasm",
  "apps/web/public/wasm/taiyin_core_bg.wasm",
];

/** 递归收集参与编译的源文件（排除构建产物目录）。 */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "pkg" || entry === "target" || entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSources(full, out);
    } else if (/\.(rs|toml)$/.test(entry) && !/wasm-manifest\.json$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 源码树指纹：按路径排序后逐个哈希，保证可重现。 */
function sourceFingerprint() {
  const files = collectSources(CORE_DIR).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(CORE_DIR, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return { fingerprint: hash.digest("hex"), fileCount: files.length };
}

function sha256File(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function buildManifest() {
  const { fingerprint, fileCount } = sourceFingerprint();
  const artifacts = {};
  for (const rel of ARTIFACTS) {
    artifacts[rel] = sha256File(join(ROOT, rel));
  }
  return { sourceFingerprint: fingerprint, sourceFileCount: fileCount, artifacts };
}

function main() {
  const write = process.argv.includes("--write");

  if (write) {
    const manifest = buildManifest();
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`✓ 已写入 ${relative(ROOT, MANIFEST)}（源码 ${manifest.sourceFileCount} 个文件）`);
    return 0;
  }

  let recorded;
  try {
    recorded = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    console.log(
      "✗ 缺少 crates/taiyin-core/wasm-manifest.json。\n" +
        "  先跑 `just build-wasm`（它会重建产物并写回清单），再提交。",
    );
    return 1;
  }

  const current = buildManifest();
  let failed = 0;

  if (current.sourceFingerprint !== recorded.sourceFingerprint) {
    console.log(
      "✗ Rust 源码已变更，但提交的 .wasm 还是旧的：\n" +
        `   记录 ${recorded.sourceFingerprint.slice(0, 12)}（${recorded.sourceFileCount} 个文件）\n` +
        `   当前 ${current.sourceFingerprint.slice(0, 12)}（${current.sourceFileCount} 个文件）\n` +
        "   请运行 `just build-wasm` 重建并提交产物与清单。\n" +
        "   ⚠ 不重建的话，本地跑真实 WASM 的测试测的是旧逻辑——会「绿得很可疑」。",
    );
    failed += 1;
  }

  for (const rel of ARTIFACTS) {
    if (!current.artifacts[rel]) {
      console.log(`✗ 产物缺失：${rel}（运行 just build-wasm）`);
      failed += 1;
      continue;
    }
    if (current.artifacts[rel] !== recorded.artifacts?.[rel]) {
      console.log(
        `✗ 产物内容与清单不符：${rel}\n` +
          "   产物被重建但没更新清单，或产物本身被手改过。运行 `just build-wasm` 重新同步。",
      );
      failed += 1;
    }
  }

  if (failed === 0) {
    console.log("✓ wasm 产物与 Rust 源码同步");
    return 0;
  }
  return 1;
}

process.exit(main());
