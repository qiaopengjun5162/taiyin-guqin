#!/usr/bin/env node
/**
 * 领域常量契约闸门（二）：徽位音高表 + 减字记号表。
 *
 * 与 `verify-duration-code-contract.mjs` 是同一层的工具：跨语言**静态**比对，
 * 补的是现有 vitest 行为测试守不到的缝隙 —— 那些测试只验单侧性质：
 *   `jianzi.test.ts` 验 SLIDE_MARKS「21 个、无重复、复合在前」，
 *   `qin-fingering.test.ts` 只抽查 1/7/13 三个徽位，
 *   `jianzi-explain.test.ts` 验 5 个结构记号都有释义。
 * 它们都不知道 Rust 那一侧长什么样，所以「改了 Rust 忘了前端」两边依旧全绿。
 *
 * ── A 组：徽位音高（物理事实，不该有两份） ──────────────
 *   ① crates/taiyin-core/src/jianpu.rs   —— HUI_RATIOS / HUI_HARMONIC / DEGREE_SEMITONES
 *   ② apps/web/src/lib/jianzi-pitch.ts  —— HUI_FRACTION / HUI_HARMONIC
 *   ③ apps/web/src/lib/qin-fingering.ts —— HUI_TICKS（必须是**派生**，不许再抄一份）
 *   ④ apps/web/src/lib/__tests__/example-scores.test.ts —— 硬编码的 DEGREE_SEMITONES
 *      ④ 是技术债：测试里又抄了一份半音表。本闸门先钉住防止漂移；
 *      后续应改成从单一来源导入，而不是继续维护第三份。
 *
 *   物理一致性：徽位比例写成最简分数后，其**分母**就是该处泛音的谐波次数
 *   （一徽 1/8→8 次，六徽 2/5→5 次，九徽 2/3→3 次）。
 *   这条能抓住「两端一起改、集合仍然对齐，但物理上已经错了」的情况。
 *
 * ── B 组：减字记号（编码字母 ↔ 汉字，且顺序即正确性） ────
 *   ① crates/taiyin-core/src/jianzi_code.rs —— TONE/SLIDE/HUI/FEN/STRING_TOKENS
 *   ② apps/web/src/lib/jianzi-rapid.ts      —— TONE_TOKENS / TOKENS.{slide,hui,fen,stringNumber,structureMark}
 *   ③ apps/web/src/lib/jianzi.ts            —— SLIDE_MARKS / STRUCTURE_MARKS
 *   ④ apps/web/src/lib/types.ts             —— StructureMark 联合
 *   ⑤ crates/taiyin-core/src/lib.rs         —— StructureMark 枚举的 serde 标签
 *
 *   **故意不比** ACTION_TOKENS / LEFT_TOKENS ↔ TOKENS.rightAction / leftFinger：
 *   Rust 侧存全字（挑/抹/食/名），连打侧存省写字形（乚/木/亻/夕），
 *   两者是「归一化映射」关系而非同一张表。把它们塞进来只会制造误报。
 *   SlideMark 联合也不在这里比：多一个不在联合里的值 tsc 会直接红。
 *
 * 用法：node scripts/verify-domain-contracts.mjs
 *       node scripts/verify-domain-contracts.mjs --self-test   # 16 条变异，含双文件同步改
 * 退出码 1 = 契约被破坏，或自测里某条变异没被指定检查抓到。
 *
 * 本脚本**只读**：变异只在内存副本上做，不写回任何源码；按项目惯例不接 CI。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = {
  jianpuRs: "crates/taiyin-core/src/jianpu.rs",
  jianziCodeRs: "crates/taiyin-core/src/jianzi_code.rs",
  libRs: "crates/taiyin-core/src/lib.rs",
  jianziPitchTs: "apps/web/src/lib/jianzi-pitch.ts",
  qinFingeringTs: "apps/web/src/lib/qin-fingering.ts",
  exampleScoresTestTs: "apps/web/src/lib/__tests__/example-scores.test.ts",
  jianziTs: "apps/web/src/lib/jianzi.ts",
  jianziRapidTs: "apps/web/src/lib/jianzi-rapid.ts",
  typesTs: "apps/web/src/lib/types.ts",
};

// ── 解析小工具（都只锚定声明，不执行任何源码） ──────────────

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

function ints(text) {
  return [...text.matchAll(/-?\d+/g)].map((m) => Number(m[0]));
}

/** Rust `const X: [T; N] = [ ... ];`，返回数组内容（不含外层方括号）。 */
function rustArray(text, name) {
  const re = new RegExp("const\\s+" + name + "[^=]*?=\\s*\\[([\\s\\S]*?)\\]");
  const m = re.exec(text);
  return m ? m[1] : "";
}

/** Rust `const X_TOKENS: &[(&str,&str)] = &[ ... ];`，返回 [字母, 汉字] 数组，保留顺序。 */
function rustTokens(text, name) {
  const re = new RegExp("const\\s+" + name + "[^=]*?=\\s*&\\[([\\s\\S]*?)\\n\\];");
  const m = re.exec(text);
  return m ? pairs(m[1]) : [];
}

/** TS `const X = { ... };`，返回对象体。 */
function tsObject(text, name) {
  const re = new RegExp("const " + name + "[^=]*?=\\s*\\{([\\s\\S]*?)\\n\\};");
  const m = re.exec(text);
  return m ? m[1] : "";
}

/** TS `const X = [ ... ];`，返回数组体。 */
function tsArray(text, name) {
  const re = new RegExp("(?:export )?const " + name + "[^=]*?=\\s*\\[([\\s\\S]*?)\\];");
  const m = re.exec(text);
  return m ? m[1] : "";
}

/**
 * 提取 [a, b]，保留顺序。Rust 写 `("san", "散")`，TS 写 `["san", "散"]`，
 * 两种括号都要认 —— 字符类用 `[\[(]` / `[\])]`，别写成「可选 [ 后跟必需的 (」。
 */
function pairs(text) {
  return [...text.matchAll(/[\[(]\s*"([^"]+)"\s*,\s*"([^"]+)"\s*[\])]/g)].map(
    (m) => [m[1], m[2]],
  );
}

/** `TOKENS` 对象里某个 slot 的数组体，靠 `^  slot: [` 与 `^  ],` 定界。 */
function rapidTokens(text, slot) {
  const re = new RegExp("^  " + slot + ":\\s*\\[([\\s\\S]*?)^  \\],", "m");
  const m = re.exec(text);
  return m ? pairs(m[1]) : [];
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** 分数约分后的分母 —— 就是该徽位的泛音谐波次数。 */
function simplifiedDen(num, den) {
  return den / gcd(num, den);
}

function parse(files) {
  // ── A 组 ──
  const rsRatios = rustArray(files.jianpuRs, "HUI_RATIOS");
  const rustRatios = [...rsRatios.matchAll(/([\d.]+)\s*\/\s*([\d.]+)/g)].map((m) => ({
    num: Number(m[1]),
    den: Number(m[2]),
    value: Number(m[1]) / Number(m[2]),
  }));
  const rustHarmonic = ints(rustArray(files.jianpuRs, "HUI_HARMONIC"));
  const rustDegrees = ints(rustArray(files.jianpuRs, "DEGREE_SEMITONES"));
  const rustHarmonicHui = ints(rustArray(files.jianpuRs, "ZHENG_DIAO_HARMONIC_HUI"));

  const tsFractionBody = tsObject(files.jianziPitchTs, "HUI_FRACTION");
  const tsFractions = [...tsFractionBody.matchAll(/^\s*(\d+):\s*([\d.]+)\s*\/\s*([\d.]+)/gm)].map(
    (m) => ({ hui: Number(m[1]), num: Number(m[2]), den: Number(m[3]), value: Number(m[2]) / Number(m[3]) }),
  );
  const tsHarmBody = tsObject(files.jianziPitchTs, "HUI_HARMONIC");
  const tsHarmonic = [...tsHarmBody.matchAll(/^\s*(\d+):\s*(\d+)/gm)].map((m) => ({
    hui: Number(m[1]),
    value: Number(m[2]),
  }));

  const tsDegrees = ints(
    (/const DEGREE_SEMITONES\s*=\s*\[([^\]]+)\]/.exec(files.exampleScoresTestTs)?.[1]) ?? "",
  );
  const huiTicksSection = section(files.qinFingeringTs, /export const HUI_TICKS/, /\n\);/);
  const huiTicksDerived = /huiFraction\(/.test(huiTicksSection);

  // ── B 组 ──
  const rustTone = rustTokens(files.jianziCodeRs, "TONE_TOKENS");
  const rustSlide = rustTokens(files.jianziCodeRs, "SLIDE_TOKENS");
  const rustHui = rustTokens(files.jianziCodeRs, "HUI_TOKENS");
  const rustFen = rustTokens(files.jianziCodeRs, "FEN_TOKENS");
  const rustString = rustTokens(files.jianziCodeRs, "STRING_TOKENS");

  const rapidTone = pairs(tsArray(files.jianziRapidTs, "TONE_TOKENS"));
  const rapidSlide = rapidTokens(files.jianziRapidTs, "slide");
  // 连打表在数字键之后还挂着火蜘蛛字母旧法，只取数字键部分与 Rust 对齐。
  const rapidHui = rapidTokens(files.jianziRapidTs, "hui").filter(([k]) => /^\d+$/.test(k));
  const rapidFen = rapidTokens(files.jianziRapidTs, "fen");
  const rapidString = rapidTokens(files.jianziRapidTs, "stringNumber").filter(([k]) => /^\d+$/.test(k));
  const rapidStructure = rapidTokens(files.jianziRapidTs, "structureMark").map(([, v]) => v);

  const slideMarks = quoted(tsArray(files.jianziTs, "SLIDE_MARKS"));
  const structureMarks = quoted(tsArray(files.jianziTs, "STRUCTURE_MARKS"));
  const tsStructure = quoted(section(files.typesTs, /export type StructureMark\s*=/, /;/));
  const rustStructure = [
    ...section(files.libRs, /pub enum StructureMark/, /\n\}/).matchAll(
      /#\[serde\(rename\s*=\s*"([^"]+)"\)\]/g,
    ),
  ].map((m) => m[1]);

  return {
    rustRatios, rustHarmonic, rustDegrees, rustHarmonicHui,
    tsFractions, tsHarmonic, tsDegrees, huiTicksDerived,
    rustTone, rustSlide, rustHui, rustFen, rustString,
    rapidTone, rapidSlide, rapidHui, rapidFen, rapidString, rapidStructure,
    slideMarks, structureMarks, tsStructure, rustStructure,
  };
}

// ── 比对小工具 ──────────────────────────────────

function sameSeq(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function samePairSeq(a, b) {
  return a.length === b.length && a.every((p, i) => p[0] === b[i]?.[0] && p[1] === b[i]?.[1]);
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === a.length && sb.size === b.length && [...sa].every((v) => sb.has(v));
}

function fmt(list) {
  return list.length ? list.slice(0, 8).join(" / ") + (list.length > 8 ? " …" : "") : "（空）";
}

/** 返回 {checks:[{name, ok, detail}], failures:[]}；名字稳定，自测按名字断言。 */
function check(p) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok, detail });

  // ── A 组：徽位音高 ──
  add(
    "徽位/各表都解析出内容（非空）",
    p.rustRatios.length > 0 && p.tsFractions.length > 0 &&
      p.rustHarmonic.length > 0 && p.tsHarmonic.length > 0 &&
      p.rustDegrees.length > 0 && p.tsDegrees.length > 0,
    `Rust ratios ${p.rustRatios.length} / TS fractions ${p.tsFractions.length} / degrees ${p.rustDegrees.length}:${p.tsDegrees.length}`,
  );

  const ratioMismatch = [];
  if (p.rustRatios.length === 13 && p.tsFractions.length === 13) {
    for (let i = 0; i < 13; i++) {
      if (Math.abs(p.rustRatios[i].value - p.tsFractions[i].value) > 1e-12 || p.tsFractions[i].hui !== i + 1) {
        ratioMismatch.push(`第${i + 1}徽`);
      }
    }
  } else {
    ratioMismatch.push(`长度 ${p.rustRatios.length} vs ${p.tsFractions.length}，应为 13`);
  }
  add("徽位/HUI_RATIOS ↔ HUI_FRACTION 十三徽逐项相等", ratioMismatch.length === 0, fmt(ratioMismatch));

  const harmMismatch = [];
  if (p.rustHarmonic.length === 13 && p.tsHarmonic.length === 13) {
    for (let i = 0; i < 13; i++) {
      if (p.rustHarmonic[i] !== p.tsHarmonic[i].value || p.tsHarmonic[i].hui !== i + 1) {
        harmMismatch.push(`第${i + 1}徽 ${p.rustHarmonic[i]}≠${p.tsHarmonic[i].value}`);
      }
    }
  } else {
    harmMismatch.push(`长度 ${p.rustHarmonic.length} vs ${p.tsHarmonic.length}，应为 13`);
  }
  add("徽位/HUI_HARMONIC 两侧十三徽逐项相等", harmMismatch.length === 0, fmt(harmMismatch));

  const rustPhysics = [];
  const tsPhysics = [];
  for (let i = 0; i < 13; i++) {
    const r = p.rustRatios[i];
    const t = p.tsFractions[i];
    if (r && p.rustHarmonic[i] !== undefined && simplifiedDen(r.num, r.den) !== p.rustHarmonic[i]) {
      rustPhysics.push(`第${i + 1}徽 分母${simplifiedDen(r.num, r.den)}≠${p.rustHarmonic[i]}`);
    }
    if (t && p.tsHarmonic[i] && simplifiedDen(t.num, t.den) !== p.tsHarmonic[i].value) {
      tsPhysics.push(`第${i + 1}徽 分母${simplifiedDen(t.num, t.den)}≠${p.tsHarmonic[i].value}`);
    }
  }
  add("徽位/Rust 比例的最简分母 == 泛音谐波次数", rustPhysics.length === 0, fmt(rustPhysics));
  add("徽位/TS 比例的最简分母 == 泛音谐波次数", tsPhysics.length === 0, fmt(tsPhysics));

  add(
    "徽位/DEGREE_SEMITONES 与示例谱测试里的那份相等",
    sameSeq(p.rustDegrees, p.tsDegrees) && p.rustDegrees.length === 7,
    `Rust ${fmt(p.rustDegrees.map(String))}；测试 ${fmt(p.tsDegrees.map(String))}`,
  );

  add(
    "徽位/HUI_TICKS 由 huiFraction 派生（不许抄第二份表）",
    p.huiTicksDerived,
    p.huiTicksDerived ? "" : "HUI_TICKS 没调用 huiFraction",
  );

  add(
    "徽位/正调泛音徽位均在 1..13 且无重复",
    p.rustHarmonicHui.length > 0 && p.rustHarmonicHui.every((h) => h >= 1 && h <= 13) &&
      new Set(p.rustHarmonicHui).size === p.rustHarmonicHui.length,
    fmt(p.rustHarmonicHui.map(String)),
  );

  // ── B 组：减字记号 ──
  add(
    "减字/各表都解析出内容（非空）",
    p.rustTone.length > 0 && p.rustSlide.length > 0 && p.rustHui.length > 0 &&
      p.rustFen.length > 0 && p.rustString.length > 0 && p.rapidSlide.length > 0 &&
      p.slideMarks.length > 0 && p.structureMarks.length > 0 && p.rustStructure.length > 0,
    `slide ${p.rustSlide.length}/${p.rapidSlide.length}/${p.slideMarks.length}；structure ${p.rustStructure.length}/${p.structureMarks.length}`,
  );
  add("减字/TONE_TOKENS Rust ↔ 连打逐项相等", samePairSeq(p.rustTone, p.rapidTone),
    `Rust ${p.rustTone.length} / 连打 ${p.rapidTone.length}`);
  add("减字/SLIDE_TOKENS Rust ↔ TOKENS.slide 逐项相等（字母+汉字+顺序）",
    samePairSeq(p.rustSlide, p.rapidSlide), `Rust ${p.rustSlide.length} / 连打 ${p.rapidSlide.length}`);
  add("减字/SLIDE_MARKS 序列 == Rust SLIDE_TOKENS 的汉字序列",
    sameSeq(p.slideMarks, p.rustSlide.map(([, v]) => v)), `${fmt(p.slideMarks)}`);
  add("减字/HUI_TOKENS Rust ↔ 连打数字键逐项相等", samePairSeq(p.rustHui, p.rapidHui),
    `Rust ${p.rustHui.length} / 连打 ${p.rapidHui.length}`);
  add("减字/FEN_TOKENS Rust ↔ TOKENS.fen 逐项相等", samePairSeq(p.rustFen, p.rapidFen),
    `Rust ${p.rustFen.length} / 连打 ${p.rapidFen.length}`);
  add("减字/STRING_TOKENS Rust ↔ 连打数字键逐项相等", samePairSeq(p.rustString, p.rapidString),
    `Rust ${p.rustString.length} / 连打 ${p.rapidString.length}`);
  add("减字/STRUCTURE_MARKS == TS StructureMark 联合",
    sameSet(p.structureMarks, p.tsStructure), `${fmt(p.structureMarks)} / ${fmt(p.tsStructure)}`);
  add("减字/STRUCTURE_MARKS == Rust StructureMark 枚举标签",
    sameSet(p.structureMarks, p.rustStructure), `${fmt(p.structureMarks)} / ${fmt(p.rustStructure)}`);
  add("减字/STRUCTURE_MARKS == 连打 TOKENS.structureMark",
    sameSet(p.structureMarks, p.rapidStructure), `${fmt(p.structureMarks)} / ${fmt(p.rapidStructure)}`);

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

function healthy(p) {
  return p.rustRatios.length > 0 && p.tsFractions.length > 0 &&
    p.rustHarmonic.length > 0 && p.tsHarmonic.length > 0 &&
    p.rustDegrees.length > 0 && p.tsDegrees.length > 0 &&
    p.rustSlide.length > 0 && p.rapidSlide.length > 0 && p.slideMarks.length > 0 &&
    p.structureMarks.length > 0 && p.rustStructure.length > 0 && p.rapidStructure.length > 0;
}

/**
 * 变异验证：每条都必须被 expect 指定的那一项检查抓到（防「改哪儿都全红」的假抓到）。
 * edits 支持多文件，用来验证「两端一起改也逃不掉物理一致性」。
 */
function selfTest(base) {
  const mutations = [
    // ── A 组 ──
    { name: "Rust 九徽比例 2/3 改成 2/5", edits: [{ key: "jianpuRs", from: "2.0 / 3.0", to: "2.0 / 5.0" }],
      expect: "徽位/HUI_RATIOS ↔ HUI_FRACTION 十三徽逐项相等" },
    { name: "TS 七徽比例 1/2 改成 1/3", edits: [{ key: "jianziPitchTs", from: "7: 1 / 2,", to: "7: 1 / 3," }],
      expect: "徽位/HUI_RATIOS ↔ HUI_FRACTION 十三徽逐项相等" },
    { name: "Rust 七徽谐波 2 改成 3", edits: [{ key: "jianpuRs", from: "5, 2, 5, 3, 4", to: "5, 3, 5, 3, 4" }],
      expect: "徽位/HUI_HARMONIC 两侧十三徽逐项相等" },
    { name: "TS 一徽谐波 8 改成 7", edits: [{ key: "jianziPitchTs", from: "1: 8,", to: "1: 7," }],
      expect: "徽位/HUI_HARMONIC 两侧十三徽逐项相等" },
    { name: "六徽比例两端同步改成 1/3（集合仍对齐，物理已错）",
      edits: [
        { key: "jianpuRs", from: "2.0 / 5.0", to: "1.0 / 3.0" },
        { key: "jianziPitchTs", from: "6: 2 / 5,", to: "6: 1 / 3," },
      ],
      expect: "徽位/Rust 比例的最简分母 == 泛音谐波次数" },
    { name: "Rust 半音表末项 11 改成 10", edits: [{ key: "jianpuRs", from: "[0, 2, 4, 5, 7, 9, 11]", to: "[0, 2, 4, 5, 7, 9, 10]" }],
      expect: "徽位/DEGREE_SEMITONES 与示例谱测试里的那份相等" },
    { name: "示例谱测试里的半音表末项 11 改成 12",
      edits: [{ key: "exampleScoresTestTs", from: "[0, 2, 4, 5, 7, 9, 11]", to: "[0, 2, 4, 5, 7, 9, 12]" }],
      expect: "徽位/DEGREE_SEMITONES 与示例谱测试里的那份相等" },
    { name: "HUI_TICKS 改成硬编码，不再派生",
      edits: [{ key: "qinFingeringTs", from: "ratio: huiFraction(i + 1, null) ?? 0", to: "ratio: 0.5" }],
      expect: "徽位/HUI_TICKS 由 huiFraction 派生（不许抄第二份表）" },
    // ── B 组 ──
    { name: "Rust 绰吟汉字拼错", edits: [{ key: "jianziCodeRs", from: '("cy", "绰吟")', to: '("cy", "绰吟X")' }],
      expect: "减字/SLIDE_TOKENS Rust ↔ TOKENS.slide 逐项相等（字母+汉字+顺序）" },
    { name: "SLIDE_MARKS 把单字绰注换个顺序（集合不变）",
      edits: [{ key: "jianziTs", from: '"绰", "注", "急", "吟", "猱",', to: '"注", "绰", "急", "吟", "猱",' }],
      expect: "减字/SLIDE_MARKS 序列 == Rust SLIDE_TOKENS 的汉字序列" },
    { name: "Rust 音色前缀 san 改成 sanX", edits: [{ key: "jianziCodeRs", from: '("san", "散")', to: '("sanX", "散")' }],
      expect: "减字/TONE_TOKENS Rust ↔ 连打逐项相等" },
    { name: "连打 TONE_TOKENS 把 f 映射成按", edits: [{ key: "jianziRapidTs", from: '["f", "泛"]', to: '["f", "按"]' }],
      expect: "减字/TONE_TOKENS Rust ↔ 连打逐项相等" },
    { name: "Rust 十三徽写成十二", edits: [{ key: "jianziCodeRs", from: '("13", "十三")', to: '("13", "十二")' }],
      expect: "减字/HUI_TOKENS Rust ↔ 连打数字键逐项相等" },
    { name: "Rust 分位半拼错", edits: [{ key: "jianziCodeRs", from: '("fb", "半")', to: '("fb", "半X")' }],
      expect: "减字/FEN_TOKENS Rust ↔ TOKENS.fen 逐项相等" },
    // 锚点必须带表尾：`("7", "七")` 在 HUI_TOKENS 里也有一份，
    // 不带 `\n];` 会改到徽位表去，红的就是别的检查了。
    { name: "Rust 七弦写成八", edits: [{ key: "jianziCodeRs", from: '("7", "七"),\n];', to: '("7", "八"),\n];' }],
      expect: "减字/STRING_TOKENS Rust ↔ 连打数字键逐项相等" },
    { name: "STRUCTURE_MARKS 多一个小息",
      edits: [{ key: "jianziTs", from: '"少息", "大息", "再作", "从头再作", "入拍",', to: '"少息", "大息", "再作", "从头再作", "入拍", "小息",' }],
      expect: "减字/STRUCTURE_MARKS == TS StructureMark 联合" },
    { name: "Rust StructureMark 少息改名",
      edits: [{ key: "libRs", from: '#[serde(rename = "少息")]', to: '#[serde(rename = "少息X")]' }],
      expect: "减字/STRUCTURE_MARKS == Rust StructureMark 枚举标签" },
    { name: "连打结构记号入拍拼错",
      edits: [{ key: "jianziRapidTs", from: '["rp", "入拍"]', to: '["rp", "入拍X"]' }],
      expect: "减字/STRUCTURE_MARKS == 连打 TOKENS.structureMark" },
  ];

  let bad = 0;
  for (const m of mutations) {
    const files = { ...base };
    let anchorFailed = false;
    for (const e of m.edits) {
      const original = files[e.key];
      const mutated = original.replace(e.from, e.to);
      if (mutated === original) {
        console.log(`✗ 变异「${m.name}」没有改动任何文本（锚点失效：${e.key}）`);
        anchorFailed = true;
        break;
      }
      files[e.key] = mutated;
    }
    if (anchorFailed) { bad += 1; continue; }

    const parsed = parse(files);
    if (!healthy(parsed)) {
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
  const baseline = check(parse(base));
  if (baseline.failures.length > 0) return report(baseline, "当前契约");
  console.log("✓ 当前契约基线全绿\n");
  if (process.argv.includes("--self-test")) return selfTest(base);
  return report(baseline, "领域常量契约");
}

process.exit(main());
