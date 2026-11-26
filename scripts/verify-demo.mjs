#!/usr/bin/env node
/**
 * 演示前 3 分钟自检：把晚上要现场走的那条线**真跑一遍**。
 *
 * 与 `smoke-browser.mjs` 的分工：
 *   - smoke 是「全面体检」，47 项断言、桌面 + 手机 + 子页，跑一轮几分钟；
 *   - 本脚本只验**演示动线**：出声 → 简谱转减字 → 智能编排 → 入谱 → 导出。
 *     跑一轮约 40 秒，演示前临时改了什么都能马上知道。
 *
 * 为什么必须真浏览器：这几步都依赖 AudioContext、字体、html-to-image 与剪贴板下载，
 * jsdom 一条都验不了。「单测全绿但现场放不出声」是这个项目真实踩过的坑。
 *
 * 用法：
 *   just demo                                  # 另开一个终端起服务
 *   node scripts/verify-demo.mjs               # 默认 http://localhost:3000/taiyin-guqin
 *   DEMO_URL=http://127.0.0.1:3100/taiyin-guqin node scripts/verify-demo.mjs
 *
 * 退出码 1 = 演示动线有断点，别上场。
 */

import { chromium } from "playwright";
import { statSync } from "node:fs";

const BASE = process.env.DEMO_URL ?? "http://localhost:3000/taiyin-guqin";
const failures = [];
const step = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({
  args: ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// 音频探针：只认「时钟真的在走」，不认「按钮变成了暂停」
await page.addInitScript(() => {
  window.__audio = { contexts: 0, ctx: null };
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) return;
  class Probed extends Orig {
    constructor(...args) {
      super(...args);
      window.__audio.contexts += 1;
      window.__audio.ctx = this;
    }
  }
  window.AudioContext = Probed;
  if (window.webkitAudioContext) window.webkitAudioContext = Probed;
});

console.log(`\n演示地址：${BASE}\n`);

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
step("页面能打开", true, await page.title());

// ① 先听一首 —— 演示第一个动作，也是唯一「一上来就有反馈」的动作
const listen = page.getByRole("button", { name: "先听一首" }).first();
step("首屏有「先听一首」", (await listen.count()) > 0);
if (await listen.count()) {
  await listen.click();
  await page.waitForTimeout(2500);
  const audio = await page.evaluate(() => ({
    contexts: window.__audio.contexts,
    state: window.__audio.ctx?.state ?? "none",
    time: window.__audio.ctx?.currentTime ?? 0,
  }));
  step("真的起了音频（不是只摆谱）", audio.contexts > 0 && audio.time > 0.3, `state=${audio.state}，currentTime=${audio.time.toFixed(2)}s`);
  step("谱面出现音符", (await page.locator("[data-note-column]").count()) > 0, `${await page.locator("[data-note-column]").count()} 列`);
}

// 让播放停下来，并刷新回干净状态：
// 「先听一首」会把示例曲（含标题）留在谱面上，接着打自己的谱会变成叠在上面，
// 标题也还是示例的《沧海一声笑》。演示时的做法就是刷一下，脚本照做。
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
step("刷新后回到空谱", (await page.locator("[data-note-column]").count()) === 0);

// ② 简谱转减字 —— 演示的「核心能力」：数字进去，减字谱出来
await page.getByRole("button", { name: "简谱转减字" }).first().click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "序列", exact: true }).first().click();
await page.waitForTimeout(300);
await page.locator("#keyboard-area textarea").first().fill("5 6 1 2 3 5 6 1 2 3");
await page.getByRole("button", { name: "翻译", exact: true }).first().click();
await page.waitForTimeout(2000);

const arrangeBtn = page.getByRole("button", { name: "智能编排" }).first();
step("翻译后有候选与「智能编排」", (await arrangeBtn.count()) > 0);

// ③ 智能编排 —— 结论由 Rust 生成，是「专业性」最强的一幕
if (await arrangeBtn.count()) {
  await arrangeBtn.click();
  await page.waitForTimeout(1500);
  const summary = await page.evaluate(() =>
    (document.querySelector("[data-arrange-summary]")?.textContent ?? "").trim(),
  );
  step("编排给出「说人话」结论", summary.length > 0, summary);
}

// ④ 确认全部 —— 数字真正变成谱面上的减字
await page.getByRole("button", { name: "确认全部" }).first().click();
await page.waitForTimeout(1200);
const notes = await page.locator("[data-note-column]").count();
step("确认后谱面成谱", notes === 10, `${notes} 个谱字（期望 10）`);

// ⑤ 导出 PNG —— 演示的「带走」环节，页脚必须完整（曲名 + 定弦）
await page.waitForTimeout(400);
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
  page.getByRole("button", { name: /导出图片/ }).first().click().catch(() => {}),
]);
if (download) {
  const path = `/tmp/verify-demo-${Date.now()}.png`;
  await download.saveAs(path);
  const kb = statSync(path).size / 1024;
  step("导出 PNG 成功", kb > 30, `${kb.toFixed(0)} KB → ${path}`);
} else {
  step("导出 PNG 成功", false, "60 秒内没有触发下载");
}
const footerText = await page.evaluate(
  () => document.getElementById("export-footer")?.textContent?.trim() ?? "",
);
step("导出页脚含曲名与定弦", footerText.includes("定弦") && footerText.includes("《"), footerText);

step("全程无 JS 运行时错误", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();

if (failures.length) {
  console.log(`\n✗ 演示动线有 ${failures.length} 处断点：\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("\n✓ 演示就绪：五个动作都跑通了。");
