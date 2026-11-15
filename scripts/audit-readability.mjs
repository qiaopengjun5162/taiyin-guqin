#!/usr/bin/env node
/**
 * 前端可读性审查（人工可复跑；刻意不接 CI，跟 measure-codebase.mjs 同级）。
 *
 * 为什么要有它：2026-11-15 之前，项目 84 个测试文件 / 1,347 个用例里
 * 没有一条检查「字看不看得清、控件读不读得出」。CI 全绿与用户觉得难用
 * 可以长期同时成立——当时实测最低对比度 1.07:1（字与背景几乎同色）、
 * 384 处文字小于 12px。修完之后必须有一条命令能复跑，否则改两次样式
 * 又会漂回去。
 *
 * 用法（先起 dev server：cd apps/web && pnpm dev）：
 *   node scripts/audit-readability.mjs
 *   node scripts/audit-readability.mjs --base http://localhost:3000/taiyin-guqin
 *   node scripts/audit-readability.mjs --json
 *
 * 判据（任一命中即 exit 1）：
 *   1) 非禁用态文字对比度 < 3:1 —— 「几乎看不见」的回归红线
 *   2) 表单控件对比度 < 3:1 —— 原生 select 的显示值不在文本节点里，
 *      普通 DOM 审查抓不到，必须单独量
 *   3) 页面横向溢出
 *   4) 出现 < 10px 的正文文字（排除三处有意保留的紧凑尺寸：SVG 字形、
 *      #score-area 里的徽位 / 角标、data-jianzi-block 内按方块等比缩放的
 *      文字构件，它们放大就会顶破减字方块的 1.05em 宽度闸门）
 *
 * 只诊断、不判失败：4.5:1 以下的清单（WCAG AA 正文目标，当前仍有
 * 少量深色按钮与禁用态在 4.2~4.5 之间，属已知余量）、页面高度、字号分布。
 * 禁用态（元素或其祖先 [disabled] / opacity < 1）按 WCAG 豁免，不计入红线。
 *
 * 依赖：根 package.json 已声明 playwright；不新增任何依赖、不需要联网。
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = argOf("--base", "http://localhost:3000/taiyin-guqin").replace(/\/$/, "");
const AS_JSON = args.includes("--json");

const PAGES = [
  { name: "home", path: "" },
  { name: "jianzipu", path: "/jianzipu" },
  { name: "yuelun", path: "/yuelun" },
  { name: "zidian", path: "/zidian" },
];
const VIEWPORTS = [
  { tag: "desktop", width: 1440, height: 1000 },
  { tag: "mobile", width: 390, height: 844 },
];

/** 在页面里执行：合成真实背景色后算对比度，并区分禁用态 / SVG / 乐谱区。 */
const analyze = () => {
  const cv = document.createElement("canvas");
  cv.width = 1; cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const toRgb = (css, base) => {
    if (!css || css === "transparent" || css === "rgba(0, 0, 0, 0)") return base;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = `rgb(${base.map((v) => Math.round(v)).join(",")})`;
    cx.fillRect(0, 0, 1, 1);
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const effBg = (el) => {
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1) { chain.unshift(getComputedStyle(cur).backgroundColor); cur = cur.parentElement; }
    let bg = [28, 27, 26];
    for (const c of chain) bg = toRgb(c, bg);
    return bg;
  };
  const opacityProduct = (el) => {
    let p = 1, cur = el;
    while (cur && cur.nodeType === 1) { p *= parseFloat(getComputedStyle(cur).opacity || "1"); cur = cur.parentElement; }
    return p;
  };
  const isDisabled = (el) => {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.disabled || cur.hasAttribute("disabled") || cur.getAttribute("aria-disabled") === "true") return true;
      cur = cur.parentElement;
    }
    return false;
  };
  const isExemptSmall = (el) => Boolean(
    el.closest("svg") || el.closest("#score-area") || el.closest("[data-jianzi-block]")
  );

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const parents = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.textContent.trim().length > 0 && n.parentElement) parents.add(n.parentElement);
  }

  // 屏幕阅读器专用内容（sr-only：1×1 + clip-path + overflow hidden）视觉上不可见。
  // WCAG 1.4.3 只约束「看得见的文字」，把它算进对比度会产出假警报——
  // 但排除条件必须卡紧：只认绝对定位 + 裁剪 + ≤1px 三条同时成立。
  const srOnly = (el) => {
    const cs = getComputedStyle(el);
    const clipped = cs.clipPath && cs.clipPath !== "none";
    return (
      cs.position === "absolute" &&
      cs.overflow === "hidden" &&
      (parseFloat(cs.width) <= 1 || parseFloat(cs.height) <= 1) &&
      Boolean(clipped)
    );
  };

  const texts = [];
  for (const el of parents) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === "none" || cs.visibility === "hidden" || r.width <= 0 || r.height <= 0) continue;
    if (srOnly(el)) continue;
    const bg = effBg(el);
    let fg = toRgb(cs.color, bg);
    const op = opacityProduct(el);
    if (op < 1) fg = fg.map((v, i) => v * op + bg[i] * (1 - op));
    texts.push({
      text: el.textContent.trim().slice(0, 20),
      cr: Math.round(ratio(fg, bg) * 100) / 100,
      size: parseFloat(cs.fontSize),
      disabled: isDisabled(el) || op < 1,
      exemptSmall: isExemptSmall(el),
    });
  }

  const forms = [];
  for (const el of document.querySelectorAll("input, select, textarea")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el), bg = effBg(el), fg = toRgb(cs.color, bg);
    forms.push({
      tag: el.tagName,
      text: (el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent : el.value || el.getAttribute("placeholder") || "").trim().slice(0, 20),
      cr: Math.round(ratio(fg, bg) * 100) / 100,
      disabled: isDisabled(el),
    });
  }

  const active = texts.filter((t) => !t.disabled);
  return {
    height: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    textNodes: texts.length,
    below45Active: active.filter((t) => t.cr < 4.5).length,
    below30Active: active.filter((t) => t.cr < 3).length,
    minContrast: active.length ? Math.min(...active.map((t) => t.cr)) : 0,
    under12: texts.filter((t) => t.size < 12).length,
    tinyText: texts.filter((t) => t.size < 10 && !t.exemptSmall).length,
    forms: forms.length,
    formsBad: forms.filter((f) => !f.disabled && f.cr < 3).length,
    worst: active.filter((t) => t.cr < 4.5).sort((a, b) => a.cr - b.cr).slice(0, 6),
  };
};

const results = [];
let failed = false;
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--no-sandbox"] });
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    for (const p of PAGES) {
      const page = await ctx.newPage();
      try {
        await page.goto(BASE + p.path, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(900);
        const d = await page.evaluate(analyze);
        const bad = d.below30Active > 0 || d.formsBad > 0 || d.overflowX || d.tinyText > 0;
        if (bad) failed = true;
        results.push({ page: p.name, viewport: vp.tag, ...d, verdict: bad ? "FAIL" : "PASS" });
      } catch (err) {
        failed = true;
        results.push({ page: p.name, viewport: vp.tag, verdict: "ERROR", error: String(err.message || err).slice(0, 160) });
      } finally {
        await page.close();
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (AS_JSON) {
  console.log(JSON.stringify({ base: BASE, failed, results }, null, 2));
} else {
  console.log(`\n──────── 前端可读性审查 · ${BASE} ────────`);
  console.log("页面        尺寸      高度   文字  <12px  <4.5(非禁用)  最低对比  控件差  判定");
  for (const r of results) {
    if (r.error) { console.log(`${r.page.padEnd(11)} ${r.viewport.padEnd(9)} ERROR: ${r.error}`); continue; }
    console.log(
      `${r.page.padEnd(11)} ${r.viewport.padEnd(9)} ${String(r.height).padStart(5)} ${String(r.textNodes).padStart(5)} ` +
      `${String(r.under12).padStart(5)} ${String(r.below45Active).padStart(12)} ` +
      `${String(r.minContrast).padStart(10)} ${String(r.formsBad).padStart(7)}  ${r.verdict}`
    );
    for (const w of r.worst) console.log(`    ⚠ ${String(w.cr).padEnd(5)} ${w.size}px  "${w.text}"`);
    if (r.tinyText > 0) console.log(`    ⚠ 有 ${r.tinyText} 处 <10px 的非 SVG / 非乐谱区文字`);
    if (r.overflowX) console.log("    ⚠ 横向溢出");
  }
  console.log(`\n判据：非禁用文字 <3:1、控件 <3:1、<10px 中文、横向溢出 → FAIL`);
  console.log(`4.5:1 是 WCAG AA 正文目标；禁用态按 WCAG 豁免，只打印不判失败。`);
  console.log(failed ? "\n结论：FAIL" : "\n结论：PASS");
}
process.exit(failed ? 1 : 0);
