#!/usr/bin/env node
/**
 * 真机（真实浏览器）冒烟：跑一遍用户真正会走的路径，断言「能用」而不只是「不报错」。
 *
 * ## 为什么需要它（这次的真实教训）
 *
 * 2026-11-18，项目里 1390 条单测全绿、tsc/eslint 干净、`next build` 通过，
 * 但用户打开页面后的原话是「效果还是很差」「感觉根本不能用」。实拍后发现：
 *
 * - 只点了「四弦」一个部件，预览框就画出一个**不存在的减字**「散四」；
 * - 右侧「本页导航」用半透明底 + sticky，滚动时把下面面板的文字**叠压**住；
 * - 演奏控制台在 360px 窄栏里强行两列，滑杆被挤出面板右边界，只看得见一小截；
 * - 全站正文压在 12px（56% 的文本元素都是这个字号），桌面上又小又平；
 * - 移动端首屏 664px 全是介绍文字，减字键盘在 1088px 处——想打谱要先滚 1.6 屏；
 * - 390px 视口里 20 个可点元素高度不足 32px，手指点不准。
 *
 * 这些**没有一个**能被 jsdom 单测发现：jsdom 没有真实布局、没有像素、没有触控。
 * 所以这道闸门必须用真浏览器 + 真视口 + 真断言。
 *
 * ## 用法
 *
 *   just dev                     # 先起开发服务器（端口 3000）
 *   node scripts/smoke-browser.mjs
 *
 * 退出码 1 = 有断言失败。
 *
 * ## 为什么放在 scripts/ 而没接 CI
 *
 * 它需要先起 dev server 与浏览器二进制；CI 里加一条会显著拉长反馈时间。
 * 定位是「发布前手动跑一次的验收闸门」，与 `just verify-*` 那类纯静态检查不同层。
 */

import { chromium, devices } from "playwright";

/**
 * 目标地址。默认 3000，可用 `SMOKE_URL` 覆盖。
 *
 * ⚠ 本机同时有别的前端项目时，3000 可能被它们占着——2026-11-18 就撞到过：
 * `next dev` 发现端口被占会自动改用 3001，而 3000 上跑的是**另一个项目**，
 * 于是冒烟测的是别人的页面，报错却指向这里。稳妥做法：
 *
 *   PORT=3100 pnpm dev
 *   SMOKE_URL=http://localhost:3100/taiyin-guqin node scripts/smoke-browser.mjs
 */
const BASE = process.env.SMOKE_URL ?? "http://localhost:3000/taiyin-guqin";

const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
};

/** 桌面：渲染 + 可见性 + 布局溢出。 */
async function desktop(browser) {
  console.log("\n=== 桌面 1440×1000 ===");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);

  check("页面无 JS 运行时错误", errors.length === 0, errors.join("; "));
  check("标题正确", (await page.title()).includes("太音"));

  // 字号：正文不该压在 12px。统计可见文本的字号分布。
  const sizes = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("*")) {
      if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (el.closest(".sr-only")) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      out[fs] = (out[fs] || 0) + 1;
    }
    return out;
  });
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const at12 = (sizes["12"] || 0) / total;
  check(
    `正文没有整体压在 12px（12px 占比 ${(at12 * 100).toFixed(0)}%）`,
    at12 < 0.2,
    "超过 20% 的可见文本是 12px，桌面阅读会偏小偏平",
  );

  // 横向溢出
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("无横向溢出", overflow <= 1, `溢出 ${overflow}px`);

  // 申请：点了「弦序 + 右手」之后，预览框必须画出**完整真实的**减字
  await page.evaluate(() => document.querySelector("#keyboard-area")?.scrollIntoView());
  await page.waitForTimeout(300);

  // 只点一个部件：预览不该画出假字
  const fourBtn = page.getByRole("button", { name: "弦序 · 四", exact: true });
  if (await fourBtn.count()) {
    await fourBtn.click();
    await page.waitForTimeout(250);
    const partial = await page.evaluate(() => document.querySelector(".w-28")?.innerText ?? "");
    check(
      "只点一个部件时不画出不存在的减字",
      partial.includes("未完成") || partial.includes("还缺") || partial.includes("选择部件"),
      `实际显示：${JSON.stringify(partial)}`,
    );

    // 补齐右手：应画出「散勾四」
    await page.getByRole("button", { name: "右手 · 勾", exact: true }).click();
    await page.waitForTimeout(300);
    const complete = await page.evaluate(() => document.querySelector(".w-28")?.innerText ?? "");
    check("补齐部件后画出完整减字", complete.includes("散勾四"), `实际：${JSON.stringify(complete)}`);

    // 确认后应进入谱面
    const confirm = page.getByRole("button", { name: /^(确认|更新)$/ }).first();
    check("部件齐了之后「确认」可用", !(await confirm.isDisabled()));
    await confirm.click();
    await page.waitForTimeout(600);
    const notes = await page.evaluate(() => document.querySelectorAll("[data-note-column]").length);
    check("确认后谱面出现音符", notes >= 1, `音符数 ${notes}`);
  } else {
    check("键盘按钮可定位（aria-label 带分区）", false, "找不到「弦序 · 四」");
  }

  // 演奏控制台内的控件不得溢出面板
  const ctrlOverflow = await page.evaluate(() => {
    const panel = document.querySelector("#sec-console");
    if (!panel) return null;
    const pr = panel.getBoundingClientRect();
    let n = 0;
    for (const el of panel.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > pr.right + 2 || r.left < pr.left - 2)) n++;
    }
    return n;
  });
  check("演奏控制台无控件溢出", ctrlOverflow === 0, `${ctrlOverflow} 个元素越界`);

  /*
   * 右栏五个工具面板必须是**手风琴**（同时只开一个）。
   *
   * 2026-11-18 实拍发现：五个独立 useState 允许全开，全展开后右栏 2775px、
   * 左栏 1777px，页面被撑到 3214px，底部一大片空白；用户点第二个面板时
   * 第一个还占着位置，得一路滚过去才看得到新的。
   */
  const accordion = await page.evaluate(async () => {
    const labels = ["识别减字图片", "琴面音位全览", "调音", "跟录音练", "练琴记录"];
    const results = [];
    for (const label of labels) {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent || "").includes(label),
      );
      if (!btn) continue;
      btn.click();
      await new Promise((r) => setTimeout(r, 250));
      const open = Array.from(document.querySelectorAll("button"))
        .map((b) => (b.textContent || "").trim())
        .filter((t) => t.startsWith("收起"));
      results.push({ label, open: open.length });
    }
    return results;
  });
  check(
    "右栏工具面板同时只开一个（手风琴）",
    accordion.length > 0 && accordion.every((r) => r.open <= 1),
    accordion.map((r) => `${r.label}:${r.open}`).join(" "),
  );

  /*
   * 减字码入谱：把导出的码行整段粘回来要真能成谱，坏码要如实报错。
   *
   * 这是「导出 → 再导入」闭环的另一半。2026-11-18 实测：
   * 好码 3 条 → 3 个音（含泛音走 SVG 降级分支）；坏码 → 明确说「2 条码读不通」
   * 且不污染已有谱面。
   */
  const codeTab = page.getByRole("button", { name: "减字码入谱" }).first();
  if (await codeTab.count()) {
    await codeTab.click();
    await page.waitForTimeout(500);
    const ta = page.locator("#keyboard-area textarea").first();
    await ta.fill("ad9g4 sg3 fd9g4");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "解析并加入曲谱" }).click();
    await page.waitForTimeout(1500);
    const imported = await page.evaluate(
      () => document.querySelectorAll("[data-note-column]").length,
    );
    check(
      `减字码入谱能成谱（3 条码 → ${imported} 音）`,
      imported >= 3,
      `实际 ${imported} 个音`,
    );

    // 坏码：要报错且不改变谱面
    await ta.fill("xx9 zz");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "解析并加入曲谱" }).click();
    await page.waitForTimeout(1200);
    const bad = await page.evaluate(() => ({
      notes: document.querySelectorAll("[data-note-column]").length,
      msg: (document.body.innerText.match(/[^\n]*读不通[^\n]*/g) || [])[0] ?? "",
    }));
    check(
      "坏码如实报错且不污染谱面",
      bad.notes === imported && bad.msg.includes("读不通"),
      `音符 ${bad.notes}（原 ${imported}），提示 ${JSON.stringify(bad.msg)}`,
    );

    // 回到简谱 tab，别影响后续
    const jpTab = page.getByRole("button", { name: "简谱转减字" }).first();
    if (await jpTab.count()) await jpTab.click();
    await page.waitForTimeout(300);
  }

  /*
   * 拼音输入：敲汉字要有实时预览，候选下拉不能被别的面板盖住。
   *
   * 2026-11-18 实拍发现两处：
   * - 拼音模式此前**根本没有预览**——敲了什么看不见，只能靠回车后看谱面变没变；
   * - 候选下拉虽然写了 `z-50`，但父容器没抬起层级，被下面「我的减字」盖掉一半。
   */
  const pinyinTab = page.getByRole("button", { name: "拼音", exact: true }).first();
  if (await pinyinTab.count()) {
    await pinyinTab.click();
    await page.waitForTimeout(400);
    const pyInput = page.locator("#keyboard-area input[type=text]").first();
    await pyInput.fill("大九勾四");
    await page.waitForTimeout(700);
    const preview = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".w-28"))
        .map((b) => b.innerText.replace(/\n/g, "/"))
        .join(" | "),
    );
    check(
      "拼音输入有实时预览",
      /大九勾四/.test(preview) && !preview.includes("未完成 | 未完成"),
      `预览框：${JSON.stringify(preview)}`,
    );

    // 候选下拉必须在最上层
    await pyInput.fill("da");
    await page.waitForTimeout(700);
    const dd = await page.evaluate(() => {
      const el = document.querySelector(".z-50");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { h: Math.round(r.height), onTop: el.contains(top) || el === top };
    });
    check(
      "拼音候选下拉浮在最上层（没被别的面板盖住）",
      dd !== null && dd.onTop && dd.h > 40,
      dd === null ? "没找到下拉" : `高度 ${dd.h}px，onTop=${dd.onTop}`,
    );

    // 打字模式下换成「点选」，避免影响后续断言
    const pointTab = page.getByRole("button", { name: "点选", exact: true }).first();
    if (await pointTab.count()) await pointTab.click();
    await page.waitForTimeout(300);
  }

  /*
   * 谱面减字的字号要够读：列宽 72px，减字曾是 24px（比例 1:3，白扔空间），
   * 3 倍屏放大后部件糊成一团。现在 34px，且不得撑破列宽。
   */
  const noteSizing = await page.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll("[data-note-column]")) {
      const el = c.querySelector('[style*="font-size"]');
      if (!el) continue;
      const cs = getComputedStyle(el);
      out.push({
        fs: parseFloat(cs.fontSize),
        w: el.getBoundingClientRect().width,
        cw: c.getBoundingClientRect().width,
      });
    }
    return out;
  });
  if (noteSizing.length > 0) {
    const minFs = Math.min(...noteSizing.map((n) => n.fs));
    check(`谱面减字字号 ≥ 32px（实际 ${minFs}px）`, minFs >= 32);
    const overflowed = noteSizing.filter((n) => n.w > n.cw + 1);
    check("减字不撑破列宽", overflowed.length === 0, `${overflowed.length} 个越界`);
  }

  /*
   * 存 → 取闭环（2026-11-18 实拍发现的两处真缺陷）。
   *
   * 本机没起后端时：
   * - 保存原先报「保存失败」且 localStorage 里什么都没有；
   * - 「加载」原先直接抛错、对话框根本不打开，用户连本机谱都看不到。
   *
   * 这两条是这个工具最基础的「存得住、找得回」，必须在真实浏览器里守住。
   */
  /*
   * ⚠ 这一步原先把按钮名写死成「发布到社区」，而那是**被判定成有后端**时
   * 才有的 aria-label。判定规则在 `api.ts::isBrowserOnlyMode()`：
   * `host !== "localhost" && host !== "127.0.0.1"` 就是纯前端模式。
   *
   * 于是本地跑（localhost）永远是 server 模式、线上 Pages 永远是 browser 模式
   * ——两边按钮名不同（「发布到社区」/「保存」）。写死一个名字的后果是：
   * **这套烟测从来没在线上跑通过**，线上真正的存储路径（纯前端存本机）
   * 一直没被验证。2026-11-23 对着线上跑，第一刀就卡在这里。
   *
   * 现在按状态徽章判模式，两种模式都验「存得住」，并把模式写进断言名。
   */
  const storageMode = await page.evaluate(() => {
    const text = document.body.innerText;
    if (text.includes("存本机")) return "browser";
    if (text.includes("存即公开") || text.includes("已发布（公开）")) return "server";
    return "unknown";
  });
  await page
    .getByRole("button", {
      name: storageMode === "server" ? "发布到社区" : "保存",
      exact: true,
    })
    .first()
    .click({ timeout: 15000 });
  /*
   * 「已保存」是**瞬态**：`setSaveStatus("saved")` 之后 2 秒自动回落到 idle。
   * 早先这里直接 `waitForTimeout(2500)` 再读，读到的必然是回落后的原始按钮名
   * ——断言于是永远差一步。改成边等边采样，抓到瞬态才算数。
   */
  const readSaveLabel = () =>
    page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        /^(保存|发布到社区|已保存|保存失败|保存中…)$/.test((b.textContent ?? "").trim()),
      );
      return btn ? (btn.textContent ?? "").trim() : "";
    });
  let saveLabel = "";
  for (let i = 0; i < 25; i++) {
    saveLabel = await readSaveLabel();
    if (saveLabel === "已保存" || saveLabel === "保存失败") break;
    await page.waitForTimeout(100);
  }
  const afterSave = await page.evaluate(() => ({
    stored: Object.keys(localStorage).some((k) => k.includes("scores")),
    hint: Array.from(document.querySelectorAll("div"))
      .map((e) => e.innerText?.trim())
      .find((t) => t && /存到本机|保存失败/.test(t) && t.length < 90),
  }));
  check(
    `保存落到本机、按钮瞬时回「已保存」（模式：${storageMode}）`,
    storageMode !== "unknown" && afterSave.stored && saveLabel === "已保存",
    `localStorage 有数据=${afterSave.stored}，捕捉到的按钮=${JSON.stringify(saveLabel)}`,
  );
  if (storageMode === "server") {
    check(
      "判成有后端但连不上时，如实说「存到本机」而不是假装发布成功",
      String(afterSave.hint).includes("存到本机"),
      `提示=${JSON.stringify(afterSave.hint)}`,
    );
  }

  await page.getByLabel("加载曲谱").first().click();
  await page.waitForTimeout(2200);
  const dialog = await page.evaluate(() => {
    const d = Array.from(document.querySelectorAll("div")).find(
      (x) => x.className.includes("fixed") && x.className.includes("inset"),
    );
    if (!d) return null;
    // 取整段文本，不限前 300 字符：列表项可能排在说明文字之后
    return {
      text: d.innerText,
      lists: d.querySelectorAll("button, [data-score-id]").length,
    };
  });
  check(
    "后端连不上时「加载」仍能打开并显示本机谱",
    dialog !== null && /本机|沧海|已保存/.test(dialog.text),
    dialog === null ? "对话框没打开" : `对话框未含本机谱，内容：${JSON.stringify(dialog.text.slice(0, 80))}`,
  );

  await page.close();
}

/**
 * 序列编排 → 「说人话」：验证**线上产物**里的 wasm 真的导出了 describe_arrangement。
 *
 * 为什么要真浏览器：这两句文案 2026-11-23 从 TS 搬进了 Rust（`describe.rs`），
 * 单测读的是仓库里的 `.wasm` 文件，验不到「静态导出产物 + basePath + 部署」这条
 * 链路；而这条链路上任何一环不对，页面都会静默少一句话（代码里是空串降级）——
 * 正好是「测试全绿但实际不可用」的典型形态。
 *
 * 顺带查静态产物里有没有 `taiyin_core.d.ts`：`wasm/` 与 `public/wasm/` 是两份拷贝，
 * 只更新一份就会出现「声明说导出、运行时没有」。
 */
async function seqArrange(browser) {
  console.log("\n=== 序列编排 · 说人话 ===");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);

  // 产物层：用页面内 fetch，才走得通浏览器自己的代理设置
  const dts = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : "" };
  }, `${BASE}/wasm/taiyin_core.d.ts`);
  check(
    "静态产物里有 wasm 声明，且声明了 describe_arrangement / describe_phrases",
    dts.ok &&
      dts.text.includes("describe_arrangement") &&
      dts.text.includes("describe_phrases"),
    `HTTP ${dts.status}，${dts.text.length} 字节`,
  );

  try {
    const jpTab = page.getByRole("button", { name: "简谱转减字" }).first();
    await jpTab.click({ timeout: 8000 });
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "序列", exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(300);

    const ta = page.locator("#keyboard-area textarea").first();
    await ta.fill("5 6 1 2 3 5 6 1 2 3");
    await page.getByRole("button", { name: "翻译", exact: true }).first().click({ timeout: 8000 });
    // 翻译走 WASM，首次要等产物加载
    await page.waitForTimeout(1500);

    const arrangeBtn = page.getByRole("button", { name: "智能编排" }).first();
    check("翻译成功后出现「智能编排」按钮", (await arrangeBtn.count()) > 0);
    await arrangeBtn.click({ timeout: 8000 });
    await page.waitForTimeout(1200);

    const summary = await page.evaluate(() => {
      const el = document.querySelector("[data-arrange-summary]");
      return el ? (el.textContent ?? "").trim() : "";
    });
    check(
      "编排后给出「说人话」结论（文案由核心 Rust 提供）",
      /^(已编排：|已重排：|这条已经是最顺)/.test(summary),
      `实际：${JSON.stringify(summary)}`,
    );
  } catch (e) {
    check("序列编排交互可走通", false, String(e).split("\n")[0]);
  }

  check("序列编排全过程无 JS 运行时错误", errors.length === 0, errors.join("; "));
  await page.close();
}

/**
 * 撤销/重做与节拍器状态提示。
 *
 * 两处都是「按钮在、点了没反馈」的经典形态：
 * - 撤销/重做必须真的改回谱面（不是只亮一下按钮）；
 * - 节拍器开着时按钮文字要变——它是静音排练时才用的功能，
 *   光靠一点底色差异，用户没法确认它到底响没响。
 */
async function editingControls(browser) {
  console.log("\n=== 撤销 / 重做 / 节拍器 ===");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);

  await page.getByRole("button", { name: "先听一首" }).click();
  await page.waitForTimeout(2800);
  const count = () =>
    page.evaluate(() => document.querySelectorAll("[data-note-column]").length);
  const n0 = await count();

  await page.getByLabel("删除此音").first().click();
  await page.waitForTimeout(500);
  const n1 = await count();
  check("删除一个音后谱面少一个", n1 === n0 - 1, `${n0} → ${n1}`);

  await page.getByLabel("撤销").first().click();
  await page.waitForTimeout(500);
  check("撤销真的恢复谱面", (await count()) === n0);

  await page.getByLabel("重做").first().click();
  await page.waitForTimeout(500);
  check("重做真的再次生效", (await count()) === n1);

  // 节拍器：开着时文字必须变
  const stop = page.getByLabel("停止播放").first();
  if (await stop.count()) {
    await stop.click();
    await page.waitForTimeout(400);
  }
  const metro = page.getByLabel("启动节拍器").first();
  if (await metro.count()) {
    await metro.click();
    await page.waitForTimeout(900);
    const label = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) =>
        /节拍/.test(x.textContent || ""),
      );
      return b?.textContent?.trim();
    });
    check(
      "节拍器开启后按钮文字有明确状态",
      typeof label === "string" && label !== "节拍",
      `实际文字：${JSON.stringify(label)}`,
    );
  }

  await page.close();
}

/** 移动端：触控目标 + 键盘是否在首屏附近。 */
async function mobile(browser) {
  console.log("\n=== 移动端 iPhone 13（390×664）===");
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1800);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("无横向溢出", overflow <= 1, `溢出 ${overflow}px`);

  // 触控目标：手指点得准的下界取 40px（44 是建议值，留一点容差）
  const small = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("button, [role=button], select")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 40 || r.width < 40)
        bad.push(`${el.textContent?.trim().slice(0, 12)}(${Math.round(r.width)}×${Math.round(r.height)})`);
    }
    return bad;
  });
  check("可点元素高度 ≥ 40px", small.length === 0, `${small.length} 个偏小：${small.slice(0, 5).join("、")}`);

  // 键盘位置：不该被引导卡片推到一屏之外
  const keyboardTop = await page.evaluate(() => {
    const el = document.querySelector("#keyboard-area");
    return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
  });
  check(
    `减字键盘在首屏内可达（top=${keyboardTop}px）`,
    keyboardTop !== null && keyboardTop < 900,
    "主操作被介绍卡片推得太远，用户要滚好几屏才能开始打谱",
  );

  // 移动端也要能真的打出一个字
  await page.evaluate(() => document.querySelector("#keyboard-area")?.scrollIntoView());
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "弦序 · 四", exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "右手 · 勾", exact: true }).click();
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => document.querySelector(".w-28")?.innerText ?? "");
  check("移动端能打完一个字", preview.includes("散勾四"), `实际：${JSON.stringify(preview)}`);

  await ctx.close();
}

/**
 * 子页面（/jianzipu、/zidian、/yuelun）。
 *
 * 它们是用户能直接从导航与搜索引擎进来的入口，但一直没有被任何自动化覆盖：
 * 单测测的是组件，`next build` 只验证「能预渲染」。实际打开会不会空白、
 * 会不会横向溢出、字典还能不能筛——全靠人点。
 *
 * 2026-11-18 实拍发现：字典卡的减字只有 30px，多部件字形（散勾三）比例失调、
 * 看起来像散架的三块。已提到 38px。
 */
async function subPages(browser) {
  console.log("\n=== 子页面 ===");
  const pages = [
    // H1 实际文案：/jianzipu →「古琴 · 指法谱 · 科普」，/zidian →「古琴 · 减字谱 · 字典」
    ["/jianzipu", "减字科普", "科普"],
    ["/zidian", "减字字典", "字典"],
    ["/yuelun", "乐论", "乐论"],
  ];

  for (const [path, name, mustContain] of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);

    const m = await page.evaluate(() => ({
      textLen: document.body.innerText.length,
      h1: document.querySelector("h1")?.innerText ?? "",
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));

    check(
      `${name} 有实际内容（${m.textLen} 字）`,
      m.textLen > 300 && m.h1.includes(mustContain),
      `h1=${JSON.stringify(m.h1)} 正文=${m.textLen}`,
    );
    check(`${name} 无横向溢出`, m.overflowX <= 1, `溢出 ${m.overflowX}px`);
    check(`${name} 无 JS 错误`, errors.length === 0, errors.join("; "));

    /*
     * 「七弦琴」这个词必须能被找到。
     *
     * 2026-11-18 补：全站此前一次都没出现过它，而它正是很多人搜索时用的词。
     * 科普页现在有一节讲清源流（本来只叫「琴」，因胡琴/钢琴/月琴借用此字才加限定），
     * 这里守住它不被后续改稿删掉。
     */
    if (path === "/jianzipu") {
      const hasName = await page.evaluate(() =>
        /七弦琴/.test(document.body.innerText),
      );
      check("科普页讲清「七弦琴」名称源流", hasName);

      /*
       * 「弦数不是从来就固定的」这一点必须保留。
       *
       * 2026-11-18 补：很容易让人以为古琴自古七弦十三徽，但曾侯乙墓出的是
       * 十弦琴与五弦琴。这不只是知识点——它解释了本站为什么以七弦为基准
       * （减字谱成熟于七弦定型之后），删掉这段，那个前提就没交代了。
       */
      const hasEvolution = await page.evaluate(() =>
        /早期琴的形式和琴弦的多少，是没有一定的/.test(document.body.innerText) &&
        /曾侯乙墓/.test(document.body.innerText),
      );
      check("科普页交代早期弦数不固定（曾侯乙十弦琴）", hasEvolution);

      /*
       * 「结构与发音原则古今无大变」——本工具成立的前提。
       *
       * 如果这条不成立，把千年前的老谱数字化就没有意义了：
       * 谱上写的「大九勾四」，今天照着弹得是那个音，才谈得上「变成能弹的曲子」。
       * 这段被删掉时，读者会失去理解整件事为什么可行的唯一线索。
       */
      const hasPrinciple = await page.evaluate(() =>
        /今琴的结构和发音原则，与古代没有很大的区别/.test(document.body.innerText),
      );
      check("科普页交代结构与发音原则古今一致", hasPrinciple);
    }

    // 字典页额外验一次筛选真的会变
    if (path === "/zidian") {
      const before = await page.evaluate(
        () => document.querySelectorAll('[data-testid="dict-grid"] > *').length,
      );
      const fy = page.getByRole("button", { name: "泛音", exact: true }).first();
      if (await fy.count()) {
        await fy.click();
        await page.waitForTimeout(1000);
        const after = await page.evaluate(
          () => document.querySelectorAll('[data-testid="dict-grid"] > *').length,
        );
        check(
          `字典筛选「泛音」真的收窄结果（${before} → ${after}）`,
          after > 0 && after < before,
        );
      }
    }

    await page.close();
  }
}

/*
 * 本机代理：线上的 GitHub Pages 直连会直接拿不到响应（本项目实测 curl 恒 000），
 * 所以对着线上跑要带 SMOKE_PROXY=http://127.0.0.1:7890。
 * 同时 bypass 掉 localhost——本机冒烟不该被代理绕一圈。
 */
const PROXY = process.env.SMOKE_PROXY ?? "";
const browser = await chromium.launch(
  PROXY ? { proxy: { server: PROXY, bypass: "localhost,127.0.0.1" } } : {},
);
try {
  await desktop(browser);
  await seqArrange(browser);
  await editingControls(browser);
  await subPages(browser);
  await mobile(browser);
} finally {
  await browser.close();
}

console.log(
  failures.length === 0
    ? "\n全部通过：页面在实际浏览器里可渲染、可交互、可用。"
    : `\n${failures.length} 项未通过：\n  - ${failures.join("\n  - ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
