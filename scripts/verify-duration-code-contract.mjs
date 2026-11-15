#!/usr/bin/env node
/**
 * 时值码契约闸门 —— 同一张「时值 ↔ 码尾数字」表，四处必须同源。
 *
 * 为什么要有这个脚本：
 *   `score-export.ts` 的 DURATION_CODE 注释自己写着「两边都要改的时候记得一起改」，
 *   但现有校验是分头的 —— `verify-wasm.mjs` 逐个数字只验 Rust 那一侧，
 *   `score-export.test.ts` 只验 TS 那一侧。改了一头、另一头没跟，两边都还是绿的。
 *   后果不是显示难看，是「十六分」被读成「全」，差十六倍时值，听起来是两首曲子。
 *
 * 四处口径：
 *   ① crates/taiyin-core/src/jianzi_code.rs  —— DURATION_TOKENS：数字 → 汉字
 *   ② apps/web/src/lib/score-export.ts      —— DURATION_CODE：汉字 → 数字（① 的逆映射）
 *   ③ apps/web/src/lib/types.ts             —— Duration 联合类型：合法的时值汉字
 *   ④ apps/web/src/lib/jianzi.ts            —— durationToBeats 的 case 分支：每个时值都要能算拍数
 *
 * 另守一条**顺序**约束：`DURATION_TOKENS` 里 "16" 必须排在 "1" 前面，
 * 否则 `find` 会把「十六分」先匹配成「全」。集合相同但顺序错了，别处全都查不出来。
 *
 * 用法：node scripts/verify-duration-code-contract.mjs
 *       node scripts/verify-duration-code-contract.mjs --self-test   # 8 条变异，证明闸门不会假绿
 * 退出码 1 = 契约被破坏，或自测里某条变异没被抓到。
 *
 * 本脚本**只读**：从磁盘读四个文件，变异只在内存副本上做，不写回、不改任何源码。
 * 按项目惯例保持为本地工具，不接 CI（脚本本身不产生外部依赖，也不会因依赖库更新变红）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  jianziCodeRs: "crates/taiyin-core/src/jianzi_code.rs",
  scoreExportTs: "apps/web/src/lib/score-export.ts",
  typesTs: "apps/web/src/lib/types.ts",
  jianziTs: "apps/web/src/lib/jianzi.ts",
};

/** 截出从 startRe 到 endRe 之间的一段，锚点找不到就返回空串（由健康度检查兜底）。 */
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
  // ① Rust：保留**顺序**，顺序本身是被检查的对象。
  const rustSection = section(
    files.jianziCodeRs,
    /const DURATION_TOKENS/,
    /\n\];/,
  );
  const rustTable = [...rustSection.matchAll(/\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)].map(
    (m) => ({ digit: m[1], label: m[2] }),
  );

  // ② TS 导出表：键是中文时值名（无引号），值是码尾数字字符串。
  const codeSection = section(files.scoreExportTs, /const DURATION_CODE/, /\};/);
  const tsCode = {};
  for (const m of codeSection.matchAll(/^\s*([^\s:,]+)\s*:\s*"([^"]+)"/gm)) {
    tsCode[m[1]] = m[2];
  }

  // ③ Duration 联合类型。
  const unionSection = section(files.typesTs, /export type Duration\s*=/, /;/);
  const durationUnion = quoted(unionSection);

  // ④ durationToBeats 的 case 分支（只取这个函数体，别把别处的 case 混进来）。
  const beatsSection = section(files.jianziTs, /export function durationToBeats/, /\n\}/);
  const beatsCases = [...beatsSection.matchAll(/case\s+"([^"]+)":/g)].map((m) => m[1]);

  return { rustTable, tsCode, durationUnion, beatsCases };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== a.length || sb.size !== b.length) return false; // 重复项也算破坏
  return [...sa].every((v) => sb.has(v));
}

function fmt(list) {
  return list.length ? list.join(" / ") : "（空）";
}

/** 返回 {checks:[{name, ok, detail}], failures:[]}。check 名保持稳定，自测按名字断言。 */
function check(p) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok, detail });
  const rustDigits = p.rustTable.map((r) => r.digit);
  const rustLabels = p.rustTable.map((r) => r.label);
  const tsLabels = Object.keys(p.tsCode);

  add(
    "四处都解析出内容（非空）",
    p.rustTable.length > 0 &&
      tsLabels.length > 0 &&
      p.durationUnion.length > 0 &&
      p.beatsCases.length > 0,
    `Rust ${p.rustTable.length} / TS ${tsLabels.length} / Union ${p.durationUnion.length} / Beats ${p.beatsCases.length}`,
  );

  add(
    "Rust 数字与汉字均无重复",
    new Set(rustDigits).size === rustDigits.length &&
      new Set(rustLabels).size === rustLabels.length,
    `数字 ${fmt(rustDigits)}；汉字 ${fmt(rustLabels)}`,
  );

  add(
    "Rust 数字都是十进制正整数",
    rustDigits.every((d) => /^[1-9][0-9]*$/.test(d)),
    fmt(rustDigits),
  );

  // 逐项比对逆映射，而不是只比集合：把 "16" 改成 "32" 时集合大小不变，也能抓住。
  const mismatches = [];
  for (const { digit, label } of p.rustTable) {
    if (p.tsCode[label] !== digit) {
      mismatches.push(`${label}: Rust=${digit} TS=${p.tsCode[label] ?? "缺失"}`);
    }
  }
  for (const label of tsLabels) {
    if (!rustLabels.includes(label)) mismatches.push(`${label}: 只存在于 TS`);
  }
  add(
    "Rust DURATION_TOKENS ↔ TS DURATION_CODE 互为逆映射",
    mismatches.length === 0,
    fmt(mismatches),
  );

  add(
    "DURATION_CODE 键集合 == Duration 联合",
    sameSet(tsLabels, p.durationUnion),
    `TS ${fmt(tsLabels)}；Union ${fmt(p.durationUnion)}`,
  );

  add(
    "durationToBeats 的 case 集合 == Duration 联合",
    sameSet(p.beatsCases, p.durationUnion),
    `case ${fmt(p.beatsCases)}；Union ${fmt(p.durationUnion)}`,
  );

  // 顺序陷阱：find() 按表顺序取第一个匹配，"16" 必须比 "1" 靠前。
  const i16 = rustDigits.indexOf("16");
  const i1 = rustDigits.indexOf("1");
  add(
    'Rust 表中 "16" 排在 "1" 之前（否则十六分读成全）',
    i16 >= 0 && i1 >= 0 && i16 < i1,
    `index(16)=${i16} index(1)=${i1}`,
  );

  const failures = checks.filter((c) => !c.ok);
  return { checks, failures };
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

/**
 * 变异验证：每条都必须被判红；expect 指定时必须由**那一条**检查抓到，
 * 防止「改哪儿都全红」式的假抓到。变异只改数据/顺序，不改解析锚点。
 */
function selfTest(base) {
  const mutations = [
    {
      name: "Rust 把十六分的码从 16 改成 32",
      key: "jianziCodeRs",
      from: '("16", "十六分")',
      to: '("32", "十六分")',
      expect: "Rust DURATION_TOKENS ↔ TS DURATION_CODE 互为逆映射",
    },
    {
      name: "Rust 把 16 挪到 1 后面（集合不变，只坏顺序）",
      key: "jianziCodeRs",
      from: '    ("16", "十六分"),\n    ("1", "全"),',
      to: '    ("1", "全"),\n    ("16", "十六分"),',
      expect: 'Rust 表中 "16" 排在 "1" 之前（否则十六分读成全）',
    },
    {
      name: "Rust 表插入重复数字",
      key: "jianziCodeRs",
      from: '    ("4", "四分"),',
      to: '    ("4", "四分"),\n    ("4", "十六分"),',
      expect: "Rust 数字与汉字均无重复",
    },
    {
      name: "Rust 数字写成非十进制",
      key: "jianziCodeRs",
      from: '("8", "八分")',
      to: '("eight", "八分")',
      expect: "Rust 数字都是十进制正整数",
    },
    {
      name: "TS 把十六分的码写成 1",
      key: "scoreExportTs",
      from: '  十六分: "16",',
      to: '  十六分: "1",',
      expect: "Rust DURATION_TOKENS ↔ TS DURATION_CODE 互为逆映射",
    },
    {
      name: "TS 导出表漏掉八分",
      key: "scoreExportTs",
      from: '  八分: "8",\n',
      to: "",
      expect: "DURATION_CODE 键集合 == Duration 联合",
    },
    {
      name: "Duration 联合新增三十二分但别处没跟",
      key: "typesTs",
      from: 'export type Duration = "全" | "二分" | "四分" | "八分" | "十六分";',
      to: 'export type Duration = "全" | "二分" | "四分" | "八分" | "十六分" | "三十二分";',
      expect: "DURATION_CODE 键集合 == Duration 联合",
    },
    {
      name: "durationToBeats 少了十六分分支",
      key: "jianziTs",
      from: '    case "十六分":\n      beats = 0.25;',
      to: "",
      expect: "durationToBeats 的 case 集合 == Duration 联合",
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
    const parsed = parse({ ...base, [m.key]: mutated });
    // 防「假抓到」：解析整体失效（锚点被改坏、集合全空）也会全红，那不是闸门有效。
    const healthy =
      parsed.rustTable.length > 0 &&
      Object.keys(parsed.tsCode).length > 0 &&
      parsed.durationUnion.length > 0 &&
      parsed.beatsCases.length > 0;
    if (!healthy) {
      console.log(`✗ 变异「${m.name}」让解析整体失效（假抓到）`);
      bad += 1;
      continue;
    }
    const result = check(parsed);
    const caught = result.failures.some((f) => f.name === m.expect);
    console.log(
      `${caught ? "✓" : "✗"} 变异「${m.name}」被「${m.expect}」拦下` +
        (caught ? "" : ` —— 实际红的是：${result.failures.map((f) => f.name).join("、") || "无"}`),
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
  return report(baseline, "时值码契约");
}

process.exit(main());
