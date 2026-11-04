#!/usr/bin/env node
/**
 * 社区「琴友视角」验收：在真浏览器里按一个陌生人会走的路走一遍。
 *
 *   node scripts/e2e-community.mjs https://<前端域名> https://<后端域名>
 *
 * 与 scripts/verify-deployed.sh 的分工（两者不要合并）：
 *   - verify-deployed.sh 只发 curl：验 TLS / CORS / 鉴权 / 分页 / 落库。快，可以进 CI。
 *   - 本脚本开真浏览器：验**界面**这层——设置面板在不在、按钮点得动点不动、
 *     https 页面调 http 接口会不会被混合内容拦掉、刷新后登录态和收藏还在不在。
 *     这些 curl 一条都测不出来，却恰好是「用户说用不了」的常见原因。
 *
 * 依赖 playwright（仓库根 devDependencies）。会写数据：注册一个带时间戳的测试账号、
 * 发布一首测试谱；结束时把谱删掉（账号没有删号接口，会留下一个）。
 */

import { chromium } from "playwright";

const [FRONTEND, BACKEND] = process.argv.slice(2);
if (!FRONTEND || !BACKEND) {
  console.error("用法: node scripts/e2e-community.mjs <前端地址> <后端地址>");
  process.exit(2);
}

const stamp = Date.now().toString().slice(-6);
const email = `e2e-${stamp}@example.com`;
const password = "guqin-2026-test";
const title = `验收-${stamp}`;

let pass = 0;
let fail = 0;
const ok = (m) => {
  console.log(`✅ ${m}`);
  pass++;
};
const bad = (m) => {
  console.log(`❌ ${m}`);
  fail++;
};
const apiErrors = [];

/** 轮询到条件成立，返回耗时（秒）；超时返回 null。 */
async function until(fn, timeoutMs = 30000, stepMs = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return ((Date.now() - t0) / 1000).toFixed(1);
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return null;
}

console.log(`前端：${FRONTEND}`);
console.log(`后端：${BACKEND}`);
console.log("────────────────────────────────────────");

const browser = await chromium.launch({
  // 本机常开系统代理（Clash 之类），浏览器会把 127.0.0.1 / 内网地址也丢给代理，
  // 结果明明是本地后端却连不上。验收脚本一律绕开系统代理。
  args: ["--no-proxy-server"],
});
const page = await browser.newPage({ viewport: { width: 375, height: 900 }, locale: "zh-CN" });

page.on("response", (r) => {
  if (r.url().startsWith(BACKEND) && r.status() >= 400) {
    apiErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  }
});
page.on("requestfailed", (r) => {
  if (r.url().startsWith(BACKEND)) apiErrors.push(`FAILED ${r.method()} ${r.url()}`);
});

try {
  await page.goto(FRONTEND, { waitUntil: "domcontentloaded" });
  // 从「一台干净手机」开始：本地存储里什么都不留，否则上一轮的账号和地址会掩盖问题
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });

  // ── 1. 填后端地址 ─────────────────────────────────────
  const apiInput = page.locator('input[aria-label="社区后端地址"]');
  const foundPanel = await until(async () => (await apiInput.count()) > 0, 20000);
  if (foundPanel === null) {
    bad("页面上找不到「社区后端地址」输入框——设置面板没挂到页面（组件写了但没渲染）");
  } else {
    await apiInput.scrollIntoViewIfNeeded();
    await apiInput.fill(BACKEND);
    // 页面上有两个「保存」：工具栏那个和设置面板这个。用「我的署名」定位面板里那个。
    await page
      .locator('xpath=//input[@aria-label="我的署名"]/following::button[normalize-space()="保存"][1]')
      .click();
    const shown = await until(async () => (await page.getByText(`已连接社区后端：${BACKEND}`).count()) > 0, 15000);
    if (shown === null) bad("填了地址但界面没显示「已连接社区后端」");
    else ok(`填入后端地址后显示已连接（${shown}s）`);
  }
  await page.reload({ waitUntil: "domcontentloaded" });

  // ── 2. 注册 ──────────────────────────────────────────
  const nameBox = page.locator('input[aria-label="我的署名"]');
  await nameBox.waitFor({ timeout: 20000 });
  await nameBox.scrollIntoViewIfNeeded();
  const toRegister = page.getByRole("button", { name: /没有账号？注册/ });
  if (await toRegister.count()) await toRegister.click();
  await page.locator('input[aria-label="邮箱"]').fill(email);
  await page.locator('input[aria-label="口令"]').fill(password);
  await page.getByRole("button", { name: /^注册$/ }).click();
  const loginTook = await until(async () => (await page.getByText(/已登录：/).count()) > 0, 30000);
  if (loginTook === null) bad("注册后界面没有进入登录态");
  else ok(`注册并登录（${loginTook}s，${email}）`);

  // ── 3. 发布 ──────────────────────────────────────────
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.selectOption('select[aria-label="加载示例"]', { index: 1 });
  await page.waitForTimeout(800);
  await page.locator('input[aria-label="曲谱名称"]').fill(title);
  const publish = page.locator('button[aria-label="发布到社区"]');
  const canPublish = await until(async () => (await publish.count()) > 0, 10000);
  if (canPublish === null) {
    bad("找不到「发布到社区」按钮——连上后端后工具栏没有切换到服务器模式");
  } else {
    await publish.click();
    // 等按钮自己从「保存中…」回到「已保存」——这是「POST 真的回来了」的唯一界面信号。
    // 别用旁边那个「已发布（公开）」胶囊：它只表示「连了后端、存了就公开」，
    // 不是发布完成的证据（曾经就是被它骗了，以为发布完了，其实请求还在飞）。
    const saved = await until(async () => {
      const t = (await publish.innerText().catch(() => "")) || "";
      return t.includes("已保存");
    }, 40000);
    if (saved === null) bad("发布没完成——按钮一直停在「保存中…」");
    else ok(`发布完成，按钮回到「已保存」（${saved}s）`);
  }

  // ── 4. 社区列表里能查到 ───────────────────────────────
  await page.locator('button[aria-label="加载曲谱"]').click();
  const modal = page.locator("div.fixed.inset-0.z-50");
  const opened = await until(async () => (await modal.count()) > 0, 25000);
  if (opened === null) {
    bad("点「加载曲谱」后弹窗没打开");
  } else {
    ok(`曲谱弹窗打开（${opened}s）`);
    const tab = modal.getByText("社区曲谱", { exact: true }).first();
    if (await tab.count()) await tab.click();
    const row = modal.locator("span.truncate", { hasText: title });
    const seen = await until(async () => (await row.count()) > 0, 40000);
    if (seen === null) bad(`社区列表里查不到刚发布的《${title}》（发布没落库，或列表取了旧快照）`);
    else ok(`社区列表里查得到《${title}》（${seen}s）`);

    // ── 5. 收藏 ────────────────────────────────────────
    const fav = modal.locator(`button[aria-label="收藏「${title}」"]`);
    if ((await fav.count()) === 0) {
      bad("列表行上没有收藏按钮");
    } else {
      await fav.first().click();
      const unfav = modal.locator(`button[aria-label="取消收藏「${title}」"]`);
      const favTook = await until(async () => (await unfav.count()) > 0, 30000);
      if (favTook === null) bad("点了收藏没有变收藏态");
      else ok(`收藏成功（${favTook}s）`);
    }
  }

  // ── 6. 刷新后还在（换设备也认得出的前提）─────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  const stillIn = await until(async () => (await page.getByText(/已登录：/).count()) > 0, 25000);
  if (stillIn === null) bad("刷新后登录态丢了");
  else ok("刷新后仍是登录态");

  await page.locator('button[aria-label="加载曲谱"]').click();
  const modal2 = page.locator("div.fixed.inset-0.z-50");
  await modal2.waitFor({ state: "visible", timeout: 25000 });
  const tab2 = modal2.getByText("社区曲谱", { exact: true }).first();
  if (await tab2.count()) await tab2.click();
  const kept = await until(
    async () => (await modal2.locator(`button[aria-label="取消收藏「${title}」"]`).count()) > 0,
    30000,
  );
  if (kept === null) bad("刷新后收藏没了（收藏没跟着账号存）");
  else ok("刷新后收藏仍在");

  // ── 7. 手机宽度不横向溢出 ─────────────────────────────
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) bad(`375px 下横向溢出 ${overflow}px（手机上会左右拖）`);
  else ok("375px 宽度无横向溢出");

  // ── 收尾：删掉测试谱 ─────────────────────────────────
  // 用页面里那把设备钥匙删：脚本不该在别人的社区里留垃圾。
  const cleaned = await page.evaluate(async ({ api, name }) => {
    const token = window.localStorage.getItem("taiyin.ownerToken") || "";
    const list = await fetch(`${api}/api/v1/scores?limit=200`, { headers: { "x-owner-token": token } })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    const mine = (Array.isArray(list) ? list : []).find((s) => s.title === name);
    if (!mine) return "没找到（可能已被清理）";
    const r = await fetch(`${api}/api/v1/scores/${mine.id}`, {
      method: "DELETE",
      headers: { "x-owner-token": token },
    });
    return r.ok ? "已删除" : `删除失败 ${r.status}`;
  }, { api: BACKEND, name: title });
  console.log(`· 测试谱收尾：${cleaned}`);

  if (apiErrors.length) {
    console.log("· 期间出现的接口错误：");
    for (const e of apiErrors.slice(0, 8)) console.log("   ", e);
    fail++;
  }
} finally {
  await browser.close();
}

console.log("────────────────────────────────────────");
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log("结论：**还不能交给琴友**，先修上面标 ❌ 的项。");
  process.exit(1);
}
console.log("结论：一个陌生人拿到链接，能自己连上社区、注册、发布、收藏，刷新不丢。");
