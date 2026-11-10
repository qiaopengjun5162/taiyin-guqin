#!/usr/bin/env node
/**
 * 定弦契约闸门 —— 四种名单必须同源。
 *
 * 起因（2026-11-10）：定弦从 3 种扩到 6 种时只改了 `lib/tuning.ts`，
 * 后端 `VALID_TUNINGS` 仍是 3 种（新调式的谱发布/筛选直接 400），
 * 翻译器又把新调式悄悄回退成正调（编排按正调、播放按外调，差半音）。
 * 这类「改了一处忘了另外三处」的错，靠人肉 review 挡不住，靠静态核对可以。
 *
 * 四处名单：
 *   ① apps/web/src/lib/tuning.ts             —— TuningId 联合 / TUNINGS 表 / isTuningId 分支
 *   ② crates/taiyin-server/src/routes.rs     —— VALID_TUNINGS 白名单（存谱、筛选）
 *   ③ crates/taiyin-core/src/jianpu.rs       —— Tuning 的 serde wire 值（编排引擎）
 *   ④ jianpu-translator/types.ts            —— TUNING_OPTIONS / TUNING_TO_ID / 编排支持集
 *
 * ③ 允许是 ① 的真子集：编排引擎只建模「1=F 清乐七声」的简谱，
 * 清商 / 太簇 / 凄凉含半音，写不出来。少哪几个由 ④ 显式声明，
 * 界面据此给可见提示（`isArrangementTuning`）。
 *
 * 用法：node scripts/verify-tuning-contract.mjs
 *       node scripts/verify-tuning-contract.mjs --self-test   # 7 条变异，证明闸门自己不会假绿
 * 退出码 1 = 有契约被破坏，或自测里某条变异没被抓到。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  tuningTs: "apps/web/src/lib/tuning.ts",
  routesRs: "crates/taiyin-server/src/routes.rs",
  jianpuRs: "crates/taiyin-core/src/jianpu.rs",
  translatorTypes: "apps/web/src/components/jianpu-translator/types.ts",
};

function section(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.search(endRe);
  return end < 0 ? rest : rest.slice(0, end);
}

function quoted(text) {
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function parse(files) {
  const tuningTs = files.tuningTs;
  const routesRs = files.routesRs;
  const typesTs = files.translatorTypes;

  const unionSection = section(tuningTs, /export type TuningId\s*=/, /;/);
  const isTuningIdSection = section(tuningTs, /export function isTuningId/, /\n\}/);
  const tuningsSection = section(tuningTs, /export const TUNINGS/, /\n\];/);
  const whitelistSection = section(routesRs, /const VALID_TUNINGS/, /\];/);
  // TUNING_OPTIONS 的类型里就带分号（`{ value: Tuning; label: string }`），
  // 结束锚点必须用数组收尾，不能用 `/;/`——否则只截到类型开头、解析出空集。
  const optionsSection = section(typesTs, /export const TUNING_OPTIONS/, /\n\];/);
  const toIdSection = section(typesTs, /export const TUNING_TO_ID/, /\};/);
  const arrangementSection = section(typesTs, /export const ARRANGEMENT_TUNING_IDS/, /\n\];/);
  const translatorUnion = section(typesTs, /export type Tuning\s*=/, /;/);

  const declaredLen = /\[&str;\s*(\d+)\]/.exec(whitelistSection)?.[1] ?? null;

  return {
    tuningIdUnion: quoted(unionSection),
    isTuningIdBranches: [
      ...isTuningIdSection.matchAll(/===\s*"([^"]+)"/g),
    ].map((m) => m[1]),
    tuningsTable: [...tuningsSection.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]),
    openMidiRows: [
      ...tuningsSection.matchAll(/openMidi:\s*\[([^\]]+)\]/g),
    ].map((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean)),
    backendWhitelist: quoted(whitelistSection),
    declaredLen,
    rustWire: [
      ...files.jianpuRs.matchAll(/#\[serde\(rename\s*=\s*"([^"]+)"\)\]/g),
    ].map((m) => m[1]),
    optionValues: [
      ...optionsSection.matchAll(/value:\s*"([^"]+)"/g),
    ].map((m) => m[1]),
    toIdKeys: [...toIdSection.matchAll(/^\s*(\w+):\s*"/gm)].map((m) => m[1]),
    toIdValues: [...toIdSection.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]),
    translatorUnion: quoted(translatorUnion),
    arrangementIds: quoted(arrangementSection),
    hasGuardFunction: /export function isArrangementTuning/.test(typesTs),
    hasVisibleHint: /isArrangementTuning\(scoreTuning\)/.test(
      readFileSync(resolve(ROOT, "apps/web/src/components/jianpu-translator.tsx"), "utf8"),
    ),
  };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== a.length || sb.size !== b.length) return false; // 重复项也算破坏
  return [...sa].every((v) => sb.has(v));
}

function isSubset(sub, sup) {
  return sub.every((v) => new Set(sup).has(v));
}

function fmt(list) {
  return list.length ? list.join(" / ") : "（空）";
}

/** 返回 {checks:[{name, ok, detail}], failures:[]}。 */
function check(p) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok, detail });

  add(
    "TuningId 联合 == TUNINGS 表 id",
    p.tuningIdUnion.length > 0 && sameSet(p.tuningIdUnion, p.tuningsTable),
    `联合 ${fmt(p.tuningIdUnion)} | 表 ${fmt(p.tuningsTable)}`,
  );
  add(
    "TuningId 联合 == isTuningId 分支",
    p.isTuningIdBranches.length > 0 && sameSet(p.tuningIdUnion, p.isTuningIdBranches),
    `守卫分支 ${fmt(p.isTuningIdBranches)}`,
  );
  add(
    "后端 VALID_TUNINGS == 前端 TuningId",
    p.backendWhitelist.length > 0 && sameSet(p.tuningIdUnion, p.backendWhitelist),
    `白名单 ${fmt(p.backendWhitelist)}`,
  );
  add(
    "VALID_TUNINGS 声明长度 == 实际元素数",
    p.declaredLen !== null && Number(p.declaredLen) === p.backendWhitelist.length,
    `声明 ${p.declaredLen} / 实际 ${p.backendWhitelist.length}`,
  );
  add(
    "WASM wire 值 == 翻译器下拉项",
    p.rustWire.length > 0 && sameSet(p.rustWire, p.optionValues),
    `Rust ${fmt(p.rustWire)} | 选项 ${fmt(p.optionValues)}`,
  );
  add(
    "翻译器 Tuning 联合 == 下拉项 == TUNING_TO_ID 键",
    p.translatorUnion.length > 0 &&
      sameSet(p.translatorUnion, p.optionValues) &&
      sameSet(p.optionValues, p.toIdKeys),
    `联合 ${fmt(p.translatorUnion)} | 映射键 ${fmt(p.toIdKeys)}`,
  );
  add(
    "TUNING_TO_ID 值 ⊆ TuningId，且 == 编排支持集",
    p.toIdValues.length > 0 &&
      isSubset(p.toIdValues, p.tuningIdUnion) &&
      sameSet(p.toIdValues, p.arrangementIds),
    `映射值 ${fmt(p.toIdValues)} | 支持集 ${fmt(p.arrangementIds)}`,
  );
  add(
    "编排支持集 ⊆ TuningId，且是真子集（外调确实被排除）",
    p.arrangementIds.length > 0 &&
      p.arrangementIds.length < p.tuningIdUnion.length &&
      isSubset(p.arrangementIds, p.tuningIdUnion),
    `支持 ${p.arrangementIds.length} / 全部 ${p.tuningIdUnion.length}`,
  );
  add("isArrangementTuning 守卫存在", p.hasGuardFunction);
  add("翻译器界面对不支持的定弦有可见提示", p.hasVisibleHint);
  add(
    "每条定弦的 openMidi 都是 7 个数",
    p.openMidiRows.length === p.tuningsTable.length &&
      p.openMidiRows.length > 0 &&
      p.openMidiRows.every((row) => row.length === 7 && row.every((n) => /^\d+$/.test(n))),
    `${p.openMidiRows.length} 行`,
  );

  return { checks, failures: checks.filter((c) => !c.ok) };
}

function readAll() {
  const out = {};
  for (const [key, rel] of Object.entries(FILES)) {
    out[key] = readFileSync(resolve(ROOT, rel), "utf8");
  }
  return out;
}

function report(result, label) {
  for (const c of result.checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : ` — ${c.detail}`}`);
  }
  const passed = result.checks.length - result.failures.length;
  console.log(`${label}: PASS ${passed} / FAIL ${result.failures.length}`);
  return result.failures.length === 0 ? 0 : 1;
}

/** 变异验证：每条都必须被判红，否则闸门自身是假的。 */
function selfTest(base) {
  const mutations = [
    {
      name: "后端白名单漏一种定弦",
      key: "routesRs",
      from: '"qiliang",\n];',
      to: '];',
    },
    {
      name: "isTuningId 少一个分支",
      key: "tuningTs",
      from: '    v === "taicu" ||\n',
      to: "",
    },
    {
      name: "TUNINGS 表 id 拼错",
      key: "tuningTs",
      from: 'id: "qingshang",',
      to: 'id: "qingshang2",',
    },
    {
      name: "Rust serde wire 值改名",
      key: "jianpuRs",
      from: '#[serde(rename = "ruibin")]',
      to: '#[serde(rename = "ruibinX")]',
    },
    {
      name: "TUNING_TO_ID 少一项映射",
      key: "translatorTypes",
      from: '  manjiao: "manjiao",\n',
      to: "",
    },
    {
      name: "编排支持集混进不支持的定弦",
      key: "translatorTypes",
      from: '  "manjiao",\n];',
      to: '  "manjiao",\n  "qiliang",\n];',
    },
    {
      name: "白名单声明长度没跟着改",
      key: "routesRs",
      from: "const VALID_TUNINGS: [&str; 6]",
      to: "const VALID_TUNINGS: [&str; 5]",
    },
  ];

  let bad = 0;
  for (const m of mutations) {
    const original = base[m.key];
    const mutated = original.replace(m.from, m.to);
    if (mutated === original) {
      console.log(`✗ 变异「${m.name}」没有改动任何文本（锚点失效）`);
      bad += 1;
      continue;
    }
    const files = { ...base, [m.key]: mutated };
    const parsed = parse(files);
    // 防「假抓到」：解析整体失效（比如锚点被改坏、集合全空）也会让检查全红，
    // 那不是闸门有效，是脚本瞎了。先确认核心名单仍解析得出来。
    const healthy =
      parsed.tuningIdUnion.length > 0 &&
      parsed.tuningsTable.length > 0 &&
      parsed.backendWhitelist.length > 0 &&
      parsed.rustWire.length > 0;
    if (!healthy) {
      console.log(`✗ 变异「${m.name}」让解析整体失效（假抓到）`);
      bad += 1;
      continue;
    }
    const result = check(parsed);
    const caught = result.failures.length > 0;
    const which = result.failures.map((f) => f.name).join("、");
    console.log(
      `${caught ? "✓" : "✗"} 变异「${m.name}」被拦下` +
        (caught ? `（${which}）` : " —— 假绿！"),
    );
    if (!caught) bad += 1;
  }
  console.log(`\n--self-test: PASS ${mutations.length - bad} / FAIL ${bad}`);
  return bad === 0 ? 0 : 1;
}

function main() {
  const base = readAll();
  // 基线本身必须先绿，否则「变异被抓到」可能只是因为原本就红。
  const baseline = check(parse(base));
  if (baseline.failures.length > 0) {
    return report(baseline, "当前契约");
  }
  console.log("✓ 当前契约基线全绿\n");
  if (process.argv.includes("--self-test")) {
    return selfTest(base);
  }
  return report(baseline, "定弦契约");
}

process.exit(main());
