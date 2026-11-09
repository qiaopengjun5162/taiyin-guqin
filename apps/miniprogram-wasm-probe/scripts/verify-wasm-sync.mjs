#!/usr/bin/env node
/**
 * 探针 WASM 与 web 产物「同源」校验 —— 专抓「改了核心/profile 却忘了重建探针」。
 *
 * 为什么需要它（真实事故）：
 * 2026-11-08 commit d6aebff 改了根 Cargo.toml 的 release profile
 * （lto=thin / strip / opt-level=z），web 产物 276,675 → 231,388 字节，
 * 但探针里的 wasm 没跟着重建。**两边 9 个公开导出名完全一样**，
 * 所以「导出集对比」这种判据当场就废了。真正能抓住它的是：
 *   ① 三份 wasm 字节相等（探针 / apps/web/public / apps/web/wasm）
 *   ② 源码 + 构建配置的指纹与清单记录一致
 *
 * 判据取舍：
 * - **不**和 CI 构建的 wasm 比字节。CI 用 linux + wasm-opt v130，本地是 v133，
 *   按字节比必然假红；且 CI 从不比对字节，字节一致性从来不是既有契约。
 * - 导出集只在「与清单不符」时判红，用来抓「换了个少函数的二进制」，
 *   不用来判断新鲜度。
 *
 * 降级：在 /tmp 副本里跑（没有 ../../.. 的 Cargo.toml、没有 apps/web）时，
 * 依赖仓库的那两项降级为 SKIP，不假红——副本只需要能过 --strict 预检。
 *
 * 用法：
 *   node apps/miniprogram-wasm-probe/scripts/verify-wasm-sync.mjs
 * 退出码：无 FAIL → 0，有 FAIL → 1。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROVENANCE_PATH,
  computeSourceFingerprint,
  publicExportNames,
  transformGlue,
  wasmExports,
} from "./build-worker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(HERE, "../../..");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const short = (s) => `${s.slice(0, 12)}…`;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/**
 * @param {{ probeRoot?: string, repoRoot?: string, provenancePath?: string }} [opts]
 * @returns {{ level: "PASS"|"WARN"|"FAIL"|"SKIP", name: string, detail: string }[]}
 */
export function inspect(opts = {}) {
  const probeRoot = opts.probeRoot ?? PROBE_ROOT;
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const provPath = opts.provenancePath ?? PROVENANCE_PATH;

  const probeWasm = resolve(probeRoot, "wasm/taiyin_core_bg.wasm");
  const glueOut = resolve(probeRoot, "workers/wasm-glue.js");

  const webPublic = resolve(repoRoot, "apps/web/public/wasm/taiyin_core_bg.wasm");
  const webAlt = resolve(repoRoot, "apps/web/wasm/taiyin_core_bg.wasm");
  const webGlue = resolve(repoRoot, "apps/web/public/wasm/taiyin_core.js");
  const rootCargo = resolve(repoRoot, "Cargo.toml");

  const rows = [];

  // ── 0. 前置：探针二进制必须存在 ──────────────────────────────────
  if (!existsSync(probeWasm)) {
    rows.push({
      level: "FAIL",
      name: "探针 wasm 不存在",
      detail: "wasm/taiyin_core_bg.wasm 缺失，跑 just rebuild-probe-wasm",
    });
    return rows;
  }
  const probeBuf = readFileSync(probeWasm);
  const probeSha = sha256(probeBuf);

  // ── 1. 三份字节同源（web 产物不在时降级 SKIP）──────────────────
  const copies = [
    ["探针", probeWasm],
    ["apps/web/public", webPublic],
    ["apps/web/wasm", webAlt],
  ].filter(([, p]) => existsSync(p));

  if (copies.length < 2) {
    rows.push({
      level: "SKIP",
      name: "与 web 产物同源",
      detail: "当前目录没有 apps/web 产物（/tmp 副本或稀疏检出），跳过",
    });
  } else {
    const groups = new Map();
    for (const [label, p] of copies) {
      const buf = readFileSync(p);
      const sha = sha256(buf);
      if (!groups.has(sha)) groups.set(sha, { bytes: buf.length, sha, labels: [] });
      groups.get(sha).labels.push(label);
    }
    if (groups.size === 1) {
      rows.push({
        level: "PASS",
        name: "与 web 产物同源",
        detail: `${kb(probeBuf.length)}，sha256 ${short(probeSha)}（${copies.length} 份字节相同）`,
      });
    } else {
      const parts = [...groups.values()]
        .map((g) => `${g.labels.join(" / ")} = ${kb(g.bytes)} (${short(g.sha)})`)
        .join(" ≠ ");
      rows.push({
        level: "FAIL",
        name: "与 web 产物不同源",
        detail: `${parts}\n      探针没跟上核心重建：跑 just rebuild-probe-wasm`,
      });
    }
  }

  // ── 2. 胶水是否等于「由当前 web 胶水转出来」────────────────────
  if (!existsSync(glueOut)) {
    rows.push({
      level: "FAIL",
      name: "workers/wasm-glue.js 缺失",
      detail: "跑 node apps/miniprogram-wasm-probe/scripts/build-worker.mjs 生成",
    });
  } else if (!existsSync(webGlue)) {
    rows.push({
      level: "SKIP",
      name: "Worker 胶水与当前源一致",
      detail: "当前目录没有 apps/web 胶水源（/tmp 副本或稀疏检出），跳过",
    });
  } else {
    const expected = transformGlue(readFileSync(webGlue, "utf8")).code;
    const actual = readFileSync(glueOut, "utf8");
    if (expected === actual) {
      rows.push({
        level: "PASS",
        name: "Worker 胶水与当前源一致",
        detail: `${kb(Buffer.byteLength(actual, "utf8"))}，转换可逐字节复现`,
      });
    } else {
      rows.push({
        level: "FAIL",
        name: "Worker 胶水与当前源不一致",
        detail: "workers/wasm-glue.js 不是由当前胶水转出来的：跑 just rebuild-probe-wasm",
      });
    }
  }

  // ── 3. 二进制与来源清单一致（sha + 导出集）──────────────────────
  if (!existsSync(provPath)) {
    rows.push({
      level: "FAIL",
      name: "来源清单缺失",
      detail: "scripts/wasm-provenance.json 不在：跑 node apps/miniprogram-wasm-probe/scripts/build-worker.mjs",
    });
  } else {
    let prov;
    try {
      prov = JSON.parse(readFileSync(provPath, "utf8"));
    } catch (e) {
      rows.push({ level: "FAIL", name: "来源清单无法解析", detail: e.message });
      prov = null;
    }
    if (prov) {
      const recorded = prov.wasm?.sha256;
      if (recorded !== probeSha) {
        rows.push({
          level: "FAIL",
          name: "二进制与来源清单不符",
          detail:
            `实际 ${kb(probeBuf.length)} (${short(probeSha)})\n` +
            `      清单 ${(prov.wasm?.bytes / 1024).toFixed(1)} KB (${short(recorded ?? "")})\n` +
            "      换了二进制却没更新清单：跑 node apps/miniprogram-wasm-probe/scripts/build-worker.mjs",
        });
      } else {
        let actualExports = [];
        try {
          actualExports = publicExportNames(wasmExports(probeBuf));
        } catch (e) {
          rows.push({ level: "FAIL", name: "wasm 无法实例化", detail: e.message });
        }
        const recordedExports = [...(prov.publicExports ?? [])].sort();
        const missing = recordedExports.filter((n) => !actualExports.includes(n));
        const extra = actualExports.filter((n) => !recordedExports.includes(n));
        if (missing.length || extra.length) {
          rows.push({
            level: "FAIL",
            name: "导出集与来源清单不符",
            detail: [
              missing.length ? `缺少: ${missing.join(", ")}` : "",
              extra.length ? `多出: ${extra.join(", ")}` : "",
              "重跑 build-worker.mjs 并确认 taiyin-core 导出未意外删减",
            ]
              .filter(Boolean)
              .join("\n      "),
          });
        } else {
          rows.push({
            level: "PASS",
            name: "二进制与来源清单一致",
            detail: `${short(probeSha)}，${actualExports.length} 个公开导出齐备`,
          });
        }
      }
    }
  }

  // ── 4. 源码/构建配置未漂移（没有仓库源码时降级 SKIP）────────────
  if (!existsSync(rootCargo)) {
    rows.push({
      level: "SKIP",
      name: "源码与构建配置未漂移",
      detail: "当前目录不是仓库根（/tmp 副本），没有 Cargo.toml 可比，跳过",
    });
  } else if (existsSync(provPath)) {
    try {
      const prov = JSON.parse(readFileSync(provPath, "utf8"));
      const { fingerprint, inputs } = computeSourceFingerprint(repoRoot);
      if (fingerprint === prov.sourceFingerprint) {
        rows.push({
          level: "PASS",
          name: "源码与构建配置未漂移",
          detail: `${inputs.length} 个输入，指纹 ${short(fingerprint)}`,
        });
      } else {
        rows.push({
          level: "FAIL",
          name: "源码或构建配置变了但探针产物没重建",
          detail:
            `现算 ${short(fingerprint)} ≠ 清单 ${short(prov.sourceFingerprint ?? "")}\n` +
            "      改过 Cargo.toml（release profile）或 crates/taiyin-core 源码：\n" +
            "      跑 just rebuild-probe-wasm 重建，别只改代码",
        });
      }
    } catch (e) {
      rows.push({ level: "FAIL", name: "来源指纹计算失败", detail: e.message });
    }
  }

  return rows;
}

function main() {
  const rows = inspect();
  const icon = { PASS: "✓", WARN: "!", FAIL: "✗", SKIP: "·" };
  console.log("探针 WASM 同源校验");
  console.log("─".repeat(60));
  for (const r of rows) {
    console.log(`${icon[r.level]} [${r.level}] ${r.name}${r.detail ? `\n      ${r.detail}` : ""}`);
  }
  console.log("─".repeat(60));
  const c = (lv) => rows.filter((r) => r.level === lv).length;
  console.log(`汇总：PASS ${c("PASS")} / SKIP ${c("SKIP")} / FAIL ${c("FAIL")}`);
  process.exit(c("FAIL") > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
