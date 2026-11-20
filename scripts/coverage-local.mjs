#!/usr/bin/env node
/**
 * 本机 Rust 覆盖率的「平台差异」提示。
 *
 * ## 问题
 *
 * CI 用 `cargo llvm-cov nextest --lib --fail-under-lines 75` 作闸门。
 * 本机照抄这条命令会**假红**：macOS aarch64 的 llvm 把更多行（含 `#[cfg(test)]` 区段）
 * 归为可执行行，分母变大、百分比被摊薄，于是一个 84% 的项目在本地显示 51%。
 *
 * 2026-11-19 追查结论（证据留在 CLAUDE.md「覆盖率」节）：
 * - 本机与 CI **实际执行的代码完全相同**：在 CI 的可执行行集合上，逐行命中数一致
 *   （9,233 / 9,626 行）；
 * - 本机多出的 1,667 行**全部命中 0 次**，纯粹是分母差异；
 * - 另有一类 region→line 归因差异（同一函数的相邻行，一边记 14 万次、一边记 0）。
 *
 * ## 这里做什么
 *
 * 不试图伪造一个「和 CI 一样」的数字——那需要 CI 的 llvm 与目标平台，本地做不到。
 * 只做两件确定的事：
 * 1. 跑真实覆盖率，打印本机数字，并**明确标注它不能用于判定阈值**；
 * 2. 打印「零命中文件」清单——这是本机数字里**唯一可靠的部分**，
 *    因为「这行一次都没跑过」在任何平台上都成立。
 *
 * 用法：
 *   node scripts/coverage-local.mjs          # 只打印报告
 *   node scripts/coverage-local.mjs --json   # 机器可读
 *
 * 退出码恒为 0（诊断工具，不是闸门）。覆盖率闸门只有 CI 那一条。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");

/** 从 lcov 汇总每文件的 (hit, found)。 */
export function summarizeLcov(text) {
  const files = new Map();
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      cur = line.slice(3).replace(/^.*\/crates\//, "crates/");
      files.set(cur, { hit: 0, found: 0 });
    } else if (line.startsWith("LH:") && cur) {
      files.get(cur).hit += Number(line.slice(3));
    } else if (line.startsWith("LF:") && cur) {
      files.get(cur).found += Number(line.slice(3));
    }
  }
  return files;
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), "taiyin-cov-"));
  const lcov = join(dir, "lcov.info");

  try {
    if (!JSON_OUT) console.log("正在跑本机覆盖率（会编译一次，慢）…\n");
    execFileSync(
      "cargo",
      ["llvm-cov", "nextest", "--lib", "--lcov", "--output-path", lcov],
      { cwd: ROOT, stdio: JSON_OUT ? "pipe" : "inherit", env: { ...process.env, CARGO_INCREMENTAL: "0" } },
    );

    const files = summarizeLcov(readFileSync(lcov, "utf8"));
    let hit = 0;
    let found = 0;
    const zero = [];
    const rows = [];
    for (const [file, v] of [...files].sort((a, b) => a[0].localeCompare(b[0]))) {
      hit += v.hit;
      found += v.found;
      const pct = v.found === 0 ? 100 : (v.hit / v.found) * 100;
      rows.push({ file, hit: v.hit, found: v.found, percent: Number(pct.toFixed(2)) });
      if (v.hit === 0) zero.push(file);
    }
    const total = found === 0 ? 100 : (hit / found) * 100;

    if (JSON_OUT) {
      console.log(JSON.stringify({ total: Number(total.toFixed(2)), hit, found, rows, zeroHitFiles: zero }, null, 2));
      return;
    }

    console.log("本机覆盖率（macOS aarch64）");
    console.log(`  行覆盖 ${total.toFixed(2)}%  (${hit}/${found})`);
    console.log("");
    console.log("⚠️  这个数字**不能**用来判 CI 的 75% 闸门：");
    console.log("   同一份代码在 Linux x86_64 上是 ~84%（可执行行少约 1/3）。");
    console.log("   本机多出来的行全部命中 0 次，是分母差异，不是没测到。");
    console.log("   判定覆盖率是否退步，以 CI 的 coverage job 为准。");
    console.log("");
    if (zero.length > 0) {
      console.log("零命中文件（这部分在任何平台都成立，是真实缺口）：");
      for (const f of zero) console.log(`  - ${f}`);
    } else {
      console.log("没有零命中文件。");
    }
    console.log("");
    console.log("逐文件（本机口径，仅供找「哪些行没跑到」）：");
    console.log("  文件".padEnd(48) + "命中/可执行".padStart(14) + "  百分比");
    for (const r of rows) {
      console.log(`  ${r.file.padEnd(46)} ${String(r.hit + "/" + r.found).padStart(13)}  ${r.percent.toFixed(2)}%`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
