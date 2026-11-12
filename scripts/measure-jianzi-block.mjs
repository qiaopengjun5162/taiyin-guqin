#!/usr/bin/env node
/**
 * 减字方块渲染宽度闸门。
 *
 * 为什么需要它：字体 GSUB 有真身 ≠ 能接进产品。
 * 减字谱一个方块固定 1em，若某个右手指法部件比标准部件宽，拼进去会把方块撑破
 * （实测：拨/撮/大撮/反撮 在按音下 1.533em、跪 2.0em）。这类问题靠读 bbox 推不出来，
 * 必须真渲染量一次。
 *
 * 两道闸门的顺序（都不能省）：
 *   1) fontTools 读 GSUB → 判「有没有真身」（placeholder 不出现在规则里）
 *   2) 本脚本真渲染量宽 → 判「布局合不合格」
 *
 * ⚠️ 本脚本抓不出「字体没做」：placeholder 占位框宽度约 1.03em，会通过宽度检查
 *    （实测 大九六剌四 = 1.033em ✅）。必须先用第 1 道闸门。
 *
 * 用法：
 *   node scripts/measure-jianzi-block.mjs                     # 跑内置对照表
 *   node scripts/measure-jianzi-block.mjs "大九六拨四" ...     # 量指定减字文本
 *   node scripts/measure-jianzi-block.mjs --font path/to.ttf  # 换字体
 *
 * 判据：≤1.05em 合格方块；1.05~1.6em 偏宽；>1.6em 散架。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FONT = path.join(
  ROOT,
  "apps/web/public/fonts/WangJiJianZiPuKaiTi.ttf",
);

const PASS = 1.05;
const WIDE = 1.6;

function parseArgs(argv) {
  let font = DEFAULT_FONT;
  const texts = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--font") {
      font = path.resolve(argv[++i]);
    } else {
      texts.push(argv[i]);
    }
  }
  return { font, texts };
}

const { font, texts } = parseArgs(process.argv.slice(2));

if (!fs.existsSync(font)) {
  console.error(`✗ 找不到字体：${font}`);
  process.exit(1);
}

// 内置对照表：基线（已知合格）+ 历史拒收样本（用于验证闸门本身没失效）
const CASES = texts.length
  ? texts.map((t) => ({ label: t, text: t }))
  : [
      { label: "轮（基线）", text: "大九六轮四" },
      { label: "拂（基线）", text: "大九六拂四" },
      { label: "散音勾（基线）", text: "散勾四" },
      { label: "拨·按音（已拒）", text: "大九六拨四" },
      { label: "撮·按音（已拒）", text: "大九六撮四" },
      { label: "跪·按音（已拒）", text: "大九六跪四" },
      { label: "剌·占位（已知漏网）", text: "大九六剌四" },
    ];

const b64 = fs.readFileSync(font).toString("base64");
const html = `<!doctype html><meta charset="utf-8">
<style>
@font-face{font-family:TJ;src:url(data:font/ttf;base64,${b64}) format("truetype");}
body{font-family:TJ;font-size:100px;margin:0;padding:20px;background:#fff;color:#111}
.row{margin:6px 0;white-space:nowrap}
span.t{display:inline-block;white-space:nowrap}
</style>
<body>
${CASES.map(({ text }, i) => `<div class="row"><span class="t" id="m${i}">${text}</span></div>`).join("\n")}
</body>`;

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const page = await browser.newPage();
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const fontSize = await page.evaluate(() =>
  parseFloat(getComputedStyle(document.body).fontSize),
);

const rows = [];
for (let i = 0; i < CASES.length; i++) {
  const width = await page.evaluate(
    (id) => document.getElementById(id).getBoundingClientRect().width,
    `m${i}`,
  );
  rows.push({ ...CASES[i], em: +(width / fontSize).toFixed(3) });
}

await browser.close();

console.log(`字体：${path.relative(ROOT, font)}`);
console.log(`字号：${fontSize}px\n`);
console.log("减字".padEnd(26), "文本".padEnd(14), "宽/em", "  判定");
let failed = 0;
for (const r of rows) {
  const verdict =
    r.em <= PASS ? "✅ 合格" : r.em <= WIDE ? "⚠️ 偏宽" : "❌ 散架";
  if (r.em > PASS) failed++;
  console.log(
    r.label.padEnd(26),
    r.text.padEnd(14),
    String(r.em).padStart(6),
    " " + verdict,
  );
}
console.log(
  `\n合格 ${rows.length - failed} / 共 ${rows.length}；判据 ≤${PASS}em`,
);
