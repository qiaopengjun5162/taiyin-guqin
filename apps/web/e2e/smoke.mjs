/**
 * 线上功能冒烟（真实浏览器，打已部署站点）
 *
 * 为什么需要它：CI 里的 vitest 跑的是 jsdom + mock，能保证逻辑不回归，
 * 但保证不了「线上真的能用」——实测就抓到过一类典型问题：
 * 减字字体路径在根路径部署下 404，被 SPA rewrites 兜成 200 的 HTML，
 * 浏览器静默回退系统字体，减字谱整片显示成「散挑二」三个汉字。
 * 单测全绿、CI 全绿、页面也能打开，但核心渲染是坏的。
 *
 * 这个脚本走的是真浏览器 + 真线上资源，覆盖：
 *   1. 首页可达、生产包为最新
 *   2. 减字字体真加载（不是回退）
 *   3. WASM 引擎真跑（翻译出候选，不是只看文件 200）
 *   4. 简谱 → 翻译 → 智能编排 → 确认入谱 全链路
 *   5. 双谱对照（字体连字 或 SVG 降级，两条路径都合法）
 *   6. 无 JS 报错 / 无关键请求失败
 *
 * 用法：
 *   node e2e/smoke.mjs                                  # 默认打 Vercel
 *   BASE=https://qiaopengjun5162.github.io/taiyin-guqin node e2e/smoke.mjs
 *   PROXY=http://127.0.0.1:7890 node e2e/smoke.mjs      # 需要代理出网时
 *
 * 注意：依赖仓库根 devDependency 的 playwright（浏览器需已安装）。
 * 不打进 CI 默认流程——它验的是「已部署的站点」，属于发布后验证。
 */

import { chromium } from "playwright";

const BASE = process.env.BASE || "https://taiyin-guqin-alws.vercel.app";
const PROXY = process.env.PROXY || "";
const SHOT = process.env.SHOT || "";

const ok = [];
const fail = [];
const log = (...a) => console.log(...a);

function check(name, cond, detail = "") {
  if (cond) {
    ok.push(name);
    log(`  ✅ ${name}${detail ? "  " + detail : ""}`);
  } else {
    fail.push(name);
    log(`  ❌ ${name}${detail ? "  " + detail : ""}`);
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  ignoreHTTPSErrors: true,
});
ctx.setDefaultTimeout(60000);
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
const failedReq = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("requestfailed", (r) =>
  failedReq.push(`${r.url()} :: ${r.failure()?.errorText}`)
);

try {
  log(`\n=== 1) 打开线上站 ${BASE} ===`);
  const resp = await page.goto(BASE, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  check("首页 HTTP 200", resp?.status() === 200, `status=${resp?.status()}`);

  await page.waitForSelector('button:has-text("简谱转减字")', { timeout: 60000 });
  check("录入区渲染完成（出现「简谱转减字」tab）", true);

  const title = await page.title();
  check("页面标题正确", title.includes("太音"), title);

  const guideVisible = await page
    .locator("text=可一键生成多套减字谱候选并智能编排指法")
    .first()
    .isVisible()
    .catch(() => false);
  check("生产包为最新版（含录入引导文案）", guideVisible);

  log(`\n=== 2) 减字字体真加载（丢了会退化成汉字） ===`);
  const fontInfo = await page.evaluate(async () => {
    await document.fonts
      .load('24px "WangJiJianZiPuKaiTi"', "散挑二")
      .catch(() => {});
    await document.fonts.ready;
    // 按族名筛：这个字体是我们原样分发的第三方开源字体（OFL 1.1），
    // 族名就是人家的原名，不再改成自有前缀——改名前缀会让署名消失。
    const faces = [...document.fonts].filter((f) =>
      f.family.includes("WangJiJianZiPuKaiTi")
    );
    return {
      check: document.fonts.check('24px "WangJiJianZiPuKaiTi"'),
      faces: faces.map((f) => `${f.family}:${f.status}`),
    };
  });
  check(
    "减字字体已加载可用",
    fontInfo.check === true && fontInfo.faces.length > 0,
    `check=${fontInfo.check} faces=[${fontInfo.faces.join(",")}]`
  );

  log(`\n=== 3) 简谱转减字：输入 → 翻译 ===`);
  // 录入区默认停在「单音」模式，整段输入要先切「序列」
  await page.getByRole("button", { name: "序列", exact: true }).click();
  const ta = page.locator('textarea[placeholder*="5 6 1 2"]').first();
  await ta.waitFor({ state: "visible", timeout: 20000 });
  await ta.fill("6 1 2 | 3 5");
  check("简谱输入成功", (await ta.inputValue()) === "6 1 2 | 3 5");

  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await page
    .getByRole("button", { name: "确认全部", exact: true })
    .waitFor({ state: "visible", timeout: 60000 });
  check("翻译成功（WASM 返回候选）", true);

  const previewCount = await page.locator('button[aria-label*="试听"]').count();
  check(
    "WASM 引擎实际工作（翻译出候选落点）",
    previewCount > 0,
    `候选试听按钮=${previewCount}`
  );

  if (SHOT) await page.screenshot({ path: `${SHOT}-1-translated.png` });

  log(`\n=== 4) 智能编排（Viterbi 整句排指法） ===`);
  await page.getByRole("button", { name: "智能编排", exact: true }).click();
  await page.locator("text=已编排").first().waitFor({ state: "visible" });
  check("智能编排完成", true);

  const arrangeDesc = await page
    .locator("text=/最顺的走法|最长一串|少换|换手|换把|同弦|共 \\d+ 句/")
    .first()
    .textContent()
    .catch(() => null);
  check(
    "编排结论文案已展示",
    !!arrangeDesc && arrangeDesc.length > 4,
    (arrangeDesc || "").slice(0, 46)
  );

  if (SHOT) await page.screenshot({ path: `${SHOT}-2-arranged.png` });

  log(`\n=== 5) 确认入谱 → 曲谱区出现减字 ===`);
  const countScore = () =>
    page.evaluate(() => {
      const el = document.querySelector("#score-area");
      return el ? el.querySelectorAll("*").length : -1;
    });

  const beforeNotes = await countScore();
  await page.getByRole("button", { name: "确认全部", exact: true }).click();
  await page.waitForTimeout(3000);

  const afterNotes = await countScore();
  check("曲谱区存在", beforeNotes >= 0, `before=${beforeNotes}`);
  check("入谱后曲谱区节点增加", afterNotes > beforeNotes, `${beforeNotes} → ${afterNotes}`);

  const renderInfo = await page.evaluate(() => {
    const el = document.querySelector("#score-area");
    if (!el) return { svg: 0, text: 0 };
    return {
      svg: el.querySelectorAll("svg").length,
      text: (el.textContent || "").replace(/\s/g, "").length,
    };
  });
  check("减字已渲染", renderInfo.svg > 0 || renderInfo.text > 0, `svg=${renderInfo.svg} 文本=${renderInfo.text}字`);

  if (SHOT) await page.screenshot({ path: `${SHOT}-3-committed.png` });

  log(`\n=== 6) 双谱对照：同一列内简谱 + 减字 ===`);
  await page
    .waitForFunction(
      () => {
        const cols = [
          ...document.querySelectorAll('#score-area [data-note-column="true"]'),
        ];
        return (
          cols.length > 0 &&
          cols.every((c) => (c.textContent || "").replace(/[\s\d×]/g, "").length > 0)
        );
      },
      { timeout: 15000 }
    )
    .catch(() => {});

  const columnInfo = await page.evaluate(() => {
    const cols = [
      ...document.querySelectorAll('#score-area [data-note-column="true"]'),
    ];
    let dual = 0;
    const detail = [];
    for (const c of cols) {
      const hasDigit = /\d/.test(c.textContent || "");
      // 减字有两条合法渲染路径：字体 GSUB 连字 / SVG 四象限积木（无连字时降级）
      const hasFontLayer = [...c.querySelectorAll("div")].some((d) =>
        (d.getAttribute("style") || "").includes("WangJiJianZiPuKaiTi")
      );
      const hasSvgLayer = c.querySelectorAll("svg").length > 0;
      const hasJianziText =
        (c.textContent || "").replace(/[\s\d×]/g, "").length > 0;
      if (hasDigit && (hasFontLayer || hasSvgLayer || hasJianziText)) dual++;
      detail.push(
        `${hasDigit ? "谱" : "-"}${hasFontLayer ? "字" : "-"}${hasSvgLayer ? "图" : "-"}${hasJianziText ? "文" : "-"}`
      );
    }
    return { cols: cols.length, dual, detail };
  });
  check(
    "每个音符列同时含简谱数字与减字",
    columnInfo.cols > 0 && columnInfo.dual === columnInfo.cols,
    `列数=${columnInfo.cols} 完整=${columnInfo.dual} [${columnInfo.detail.join(" ")}]`
  );

  log(`\n=== 7) 运行期健康 ===`);
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|manifest|React DevTools|preload/i.test(e)
  );
  check("无 JS 运行时报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  check("无未捕获 console error", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));
  const realFailed = failedReq.filter(
    (u) => !/favicon|manifest|\.map$|fonts\.googleapis|gstatic/i.test(u)
  );
  check("无关键请求失败", realFailed.length === 0, realFailed.slice(0, 3).join(" | "));
} catch (e) {
  fail.push("脚本异常: " + e.message);
  log(`\n💥 异常: ${e.message}`);
  if (SHOT) await page.screenshot({ path: `${SHOT}-ERROR.png` }).catch(() => {});
} finally {
  log(`\n================ 结果 ================`);
  log(`通过 ${ok.length} 项 / 失败 ${fail.length} 项`);
  if (fail.length) log(`失败项:\n - ` + fail.join("\n - "));
  await browser.close();
  process.exit(fail.length ? 1 : 0);
}
