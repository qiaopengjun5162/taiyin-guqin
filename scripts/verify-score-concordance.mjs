// 「谱中见过」的第二个入口：在谱面上点一个音。
//
// 点音会进编辑模式（handleEdit → 滚到 #keyboard-area → 键盘用该音的 state remount），
// 释义面板随之显示这个字的释义与谱例出处。这条路径不需要额外接线，
// 但也没有任何自动测试盯着——vitest 起不来 worker 的环境里，只能靠真浏览器确认。
//
// 前置：apps/web dev server 跑在 http://localhost:3100（`PORT=3100 pnpm dev`）。
// 用法：env -u HTTP_PROXY -u HTTPS_PROXY node scripts/verify-score-concordance.mjs
// 期望：载入示例谱 → 点第一个音 → 打印「谱中见过 N 处 · M 首」并截图，无页面错误。
import { chromium } from "playwright";

const URL = "http://localhost:3100/taiyin-guqin";
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });

// 1. 空谱时页面上有两个示例按钮，点第一个把谱填上
const exampleBtn = page.locator("text=暂无音符").locator("xpath=..").locator("button").first();
await exampleBtn.click();
await page.waitForTimeout(1200);

const noteCount = await page.locator("[data-note-column]").count();
console.log("谱面音符数:", noteCount);

// 2. 点第一个音 → 应进编辑模式并滚到键盘区
await page.locator("[data-note-column]").first().click();
await page.waitForTimeout(1500);

const hasPanel = await page.locator("text=谱中见过").count();
console.log("「谱中见过」命中数:", hasPanel);

// 3. 把面板附近文字抓出来
if (hasPanel > 0) {
  const panel = page.locator("text=谱中见过").first().locator("xpath=../../..");
  const text = await panel.innerText();
  console.log("---- 面板文字 ----");
  console.log(text.trim().slice(0, 600));
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await panel.boundingBox();
  if (box) {
    await page.screenshot({
      path: "/tmp/taiyin-concordance-from-score.png",
      clip: {
        x: Math.max(0, box.x - 24),
        y: Math.max(0, box.y - 24),
        width: Math.min(1200, box.width + 48),
        height: Math.min(800, box.height + 48),
      },
    });
    console.log("截图: /tmp/taiyin-concordance-from-score.png");
  }
} else {
  console.log("---- 键盘区文字 ----");
  const kb = await page.locator("#keyboard-area").innerText().catch(() => "(无 #keyboard-area)");
  console.log(String(kb).trim().slice(0, 800));
  await page.screenshot({ path: "/tmp/taiyin-concordance-from-score.png", fullPage: false });
}

console.log("页面错误:", errors.length ? errors : "无");
await browser.close();
