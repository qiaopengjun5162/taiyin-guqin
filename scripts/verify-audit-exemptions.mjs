#!/usr/bin/env node
/**
 * 依赖审计豁免表同源校验。
 *
 * ## 为什么需要这道闸门
 *
 * `cargo audit` 的豁免写在**两处**，且各自独立生效：
 *
 * - `.cargo/audit.toml` 的 `[advisories] ignore` —— 本地 `cargo audit` 读它；
 * - `.github/workflows/build.yml` 里 `rustsec/audit-check` 的 `ignore` 输入 —— CI 读它。
 *
 * 两边注释都写着「改这里必须同步改那边」，但**没有任何东西真的检查**。
 * 这正是 2026-11-19 踩到的形态：本地加一条豁免就绿了，CI 仍是红的，
 * 而人第一反应会是去怀疑新代码。
 *
 * 分家的两个方向都会咬人：
 * - 只加在 toml → 本地绿、CI 红（本次情形）；
 * - 只加在 yml → CI 绿、本地红，人会把「本地跑不过」当成环境问题而跳过。
 *
 * ## 判据
 *
 * 两个集合必须**完全相等**（不是包含关系）。多一条或少一条都说明两边不同步。
 * 顺序不比——集合语义。
 *
 * 纯只读，不需要构建产物，不需要网络。
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_TOML = join(ROOT, ".cargo/audit.toml");
const BUILD_YML = join(ROOT, ".github/workflows/build.yml");

const ID = /RUSTSEC-\d{4}-\d{4}/;

/** 从 audit.toml 的 `ignore = [...]` 取出豁免集合。 */
export function parseTomlIgnores(text) {
  const start = text.indexOf("[advisories]");
  if (start === -1) throw new Error("audit.toml 里找不到 [advisories] 段");
  const ids = new Set();
  for (const line of text.slice(start).split("\n")) {
    // 段结束：遇到下一个 [section] 就停，避免把后面的内容算进来
    if (/^\[/.test(line.trim()) && !line.includes("[advisories]")) break;
    for (const m of line.matchAll(new RegExp(ID, "g"))) ids.add(m[0]);
  }
  return ids;
}

/**
 * 从 build.yml 的 audit-check 步骤取 `ignore:` 输入。
 *
 * 只认 `rustsec/audit-check` 那一步之后的 `ignore:`，避免误吃别处的同名字段。
 */
export function parseWorkflowIgnores(text) {
  const anchor = text.indexOf("rustsec/audit-check");
  if (anchor === -1) throw new Error("build.yml 里找不到 rustsec/audit-check 步骤");
  const after = text.slice(anchor);
  const match = after.match(/^\s*ignore:\s*(.+)$/m);
  if (!match) throw new Error("audit-check 步骤里找不到 ignore: 输入");
  return new Set(match[1].match(new RegExp(ID, "g")) ?? []);
}

function diff(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

function main() {
  const toml = parseTomlIgnores(readFileSync(AUDIT_TOML, "utf8"));
  const yml = parseWorkflowIgnores(readFileSync(BUILD_YML, "utf8"));

  const onlyToml = diff(toml, yml);
  const onlyYml = diff(yml, toml);

  const problems = [];
  if (toml.size === 0) problems.push("audit.toml 的豁免表为空——解析可能整体失效");
  if (yml.size === 0) problems.push("build.yml 的 ignore 输入为空——解析可能整体失效");
  for (const id of onlyToml) {
    problems.push(`${id} 只在 .cargo/audit.toml 里（本地会绿、CI 仍红）`);
  }
  for (const id of onlyYml) {
    problems.push(`${id} 只在 build.yml 里（CI 会绿、本地仍红）`);
  }

  if (problems.length > 0) {
    console.error("✗ 依赖审计豁免表不同源：");
    for (const p of problems) console.error(`   - ${p}`);
    console.error("   两份豁免必须完全一致：.cargo/audit.toml ↔ build.yml 的 ignore:");
    process.exit(1);
  }

  console.log(`✓ 依赖审计豁免同源（两边各 ${toml.size} 条）`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
