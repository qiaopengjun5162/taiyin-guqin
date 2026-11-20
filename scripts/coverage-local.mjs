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
 * 2. 打印 `--lib` 口径下的零命中文件，但**必须区分两种成因**（见下）。
 *
 * ## ⚠️ 零命中 ≠ 真实缺口（2026-11-19 修正）
 *
 * 第一版脚本把「零命中文件」直接标成真实缺口，这是错的，会让人去写重复测试。
 * 实测反例：`favorites.rs` 在 `--lib` 口径下 0%，但在 `--workspace`（含集成测试）下
 * 是 **97.06%（99/102）** —— 它由 `tests/favorites.rs` 的 8 条集成测试完整覆盖，
 * 只是 `--lib` 本来就不跑 `tests/`。
 *
 * 所以脚本改为：对每个零命中文件先跑一次全量覆盖率（`--workspace`，需数据库），
 * 按全量数字给出结论——
 * - 全量也接近 0 → **真实缺口**；
 * - 全量有覆盖 → **只是 lib 口径不跑它**，不是缺口。
 *
 * 全量跑不起来（没有数据库）时，如实说「无法判定」，不猜。
 *
 * 用法：
 *   node scripts/coverage-local.mjs          # lib 口径 + 零命中归因
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

/** 跑一次覆盖率，返回 lcov 文本。`full` 为 true 时含集成测试（需数据库）。 */
function runCoverage(dir, full) {
  const lcov = join(dir, full ? "all.info" : "lib.info");
  const args = ["llvm-cov", "nextest"];
  if (!full) args.push("--lib");
  else args.push("--workspace", "--no-fail-fast");
  args.push("--lcov", "--output-path", lcov);

  try {
    execFileSync("cargo", args, {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, CARGO_INCREMENTAL: "0" },
      /*
       * 全量口径要连数据库。没数据库时 nextest 不会立刻失败，而是卡在连接上，
       * 实测能阻塞到外层的 10 分钟超时——那比「跑不成」更糟：用户以为脚本挂了。
       * 给一个明确的墙钟上限，超时就如实归因为「无法判定」。
       */
      timeout: full ? 240_000 : 600_000,
      killSignal: "SIGKILL",
    });
    return readFileSync(lcov, "utf8");
  } catch {
    return null;
  }
}

/**
 * 零命中文件的归因。
 *
 * 只用 `--lib` 的数字会把「由集成测试覆盖的服务端模块」误报成缺口。
 * 拿全量覆盖率复核：全量也低才是真缺口。
 */
export function attributeZeroHits(zeroFiles, fullFiles) {
  return zeroFiles.map((file) => {
    if (fullFiles === null) {
      return { file, verdict: "unknown", detail: "全量覆盖率未跑成（需要数据库），无法判定" };
    }
    const v = fullFiles.get(file);
    if (!v || v.found === 0) {
      return { file, verdict: "unknown", detail: "全量报告里没有这个文件" };
    }
    const pct = (v.hit / v.found) * 100;
    return pct < 5
      ? { file, verdict: "real-gap", detail: `全量也只有 ${pct.toFixed(1)}%（${v.hit}/${v.found}）` }
      : { file, verdict: "lib-only", detail: `全量 ${pct.toFixed(1)}%（${v.hit}/${v.found}）——由集成测试覆盖，不是缺口` };
  });
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), "taiyin-cov-"));

  try {
    if (!JSON_OUT) console.log("正在跑本机覆盖率（会编译一次，慢）…\n");
    const libText = runCoverage(dir, false);
    if (!libText) {
      console.error("✗ lib 覆盖率没跑成，检查 cargo llvm-cov 是否可用。");
      process.exitCode = 1;
      return;
    }

    const files = summarizeLcov(libText);
    let hit = 0;
    let found = 0;
    const rows = [];
    for (const [file, v] of [...files].sort((a, b) => a[0].localeCompare(b[0]))) {
      hit += v.hit;
      found += v.found;
      const pct = v.found === 0 ? 100 : (v.hit / v.found) * 100;
      rows.push({ file, hit: v.hit, found: v.found, percent: Number(pct.toFixed(2)) });
    }
    const total = found === 0 ? 100 : (hit / found) * 100;
    const zero = rows.filter((r) => r.hit === 0).map((r) => r.file);

    // 只有存在零命中文件时才值得再跑一次全量（它慢且需要数据库）
    let attribution = [];
    if (zero.length > 0) {
      if (!JSON_OUT) console.log(`\n发现 ${zero.length} 个 lib 口径零命中文件，跑全量覆盖率复核成因…\n`);
      const fullText = runCoverage(dir, true);
      attribution = attributeZeroHits(zero, fullText ? summarizeLcov(fullText) : null);
    }

    if (JSON_OUT) {
      console.log(
        JSON.stringify(
          {
            total: Number(total.toFixed(2)),
            hit,
            found,
            rows,
            zeroHitFiles: attribution,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log("本机覆盖率（macOS aarch64，--lib 口径）");
    console.log(`  行覆盖 ${total.toFixed(2)}%  (${hit}/${found})`);
    console.log("");
    console.log("⚠️  这个数字**不能**用来判 CI 的 75% 闸门：");
    console.log("   同一份代码在 Linux x86_64 上是 ~84%（可执行行少约 1/3）。");
    console.log("   本机多出来的行全部命中 0 次，是分母差异，不是没测到。");
    console.log("   判定覆盖率是否退步，以 CI 的 coverage job 为准。");
    console.log("");

    if (attribution.length === 0) {
      console.log("没有零命中文件。");
    } else {
      const real = attribution.filter((a) => a.verdict === "real-gap");
      const libOnly = attribution.filter((a) => a.verdict === "lib-only");
      const unknown = attribution.filter((a) => a.verdict === "unknown");

      if (real.length > 0) {
        console.log("真实缺口（全量口径下也没被覆盖）：");
        for (const a of real) console.log(`  - ${a.file}  ${a.detail}`);
        console.log("");
      }
      if (libOnly.length > 0) {
        console.log("只是 --lib 不跑它，不是缺口（已由集成测试覆盖）：");
        for (const a of libOnly) console.log(`  - ${a.file}  ${a.detail}`);
        console.log("");
      }
      if (unknown.length > 0) {
        console.log("无法判定：");
        for (const a of unknown) console.log(`  - ${a.file}  ${a.detail}`);
        console.log("");
      }
    }

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
