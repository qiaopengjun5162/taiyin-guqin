// 谱例溯源的端到端验证（真浏览器 + 真 localStorage 曲库）。
//
// 前置：apps/web 的 dev server 跑在 http://localhost:3100（`PORT=3100 pnpm dev`）。
// 断言：拼出「大九六分勾四」后，释义面板里出现「谱中见过」，命中本地曲谱的
// 两处同一个字（换了弦的那处不进严匹配结果），点击不抛页面错误。
// 用法：env -u HTTP_PROXY -u HTTPS_PROXY node scripts/verify-concordance.mjs
import { chromium } from "playwright";

const TARGET = {
  toneType: "按",
  rhythmMode: null,
  leftFinger: "大",
  hui: "九",
  fen: "六分",
  slide: null,
  rightAction: "勹",
  stringNumber: "四",
};

const seed = [
  {
    id: "seed-score",
    title: "验证用谱",
    notes: [
      // 第一处：同一个字
      { id: "n1", jianpuNumber: "5", jianpuOctave: "", jianpuDot: false, duration: "四分", jianzi: { ...TARGET } },
      // 第二处：换了弦（二弦），应被标成「别弦」
      { id: "n2", jianpuNumber: "6", jianpuOctave: "", jianpuDot: false, duration: "四分", jianzi: { ...TARGET, stringNumber: "二" } },
      // 第三处：又是同一个字
      { id: "n3", jianpuNumber: "1", jianpuOctave: "·", jianpuDot: false, duration: "八分", jianzi: { ...TARGET } },
    ],
    tuning: "zheng",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.addInitScript((payload) => {
  window.localStorage.setItem("taiyin.scores.v1", JSON.stringify(payload));
}, seed);

await page.goto("http://localhost:3100/taiyin-guqin", { waitUntil: "networkidle" });

await page.getByRole("button", { name: "按", exact: true }).click();
// 弦号与徽位同名（一~七），弦区排在徽位之后 → 取最后一个
for (const label of ["大", "九", "六分", "勹", "四"]) {
  const btn = page.getByRole("button", { name: label, exact: true });
  if ((await btn.count()) === 0) throw new Error(`找不到按钮：${label}`);
  await btn.last().click();
  await page.waitForTimeout(120);
}

const header = page.getByText("谱中见过");
await header.waitFor({ timeout: 8000 });

const panel = header.locator("xpath=../..");
await panel.scrollIntoViewIfNeeded();
console.log("--- 面板全文 ---");
console.log(await panel.innerText());

const rows = await page.getByRole("button", { name: /验证用谱/ }).count();
console.log("可点击行数：", rows);
console.log("别弦标记：", await page.getByText("别弦").count());

await panel.screenshot({ path: "/tmp/taiyin-concordance.png" });

await page.getByRole("button", { name: /验证用谱/ }).first().click();
await page.waitForTimeout(500);
console.log("点击后页面错误：", errors.length === 0 ? "无" : errors.join(" | "));

await browser.close();
