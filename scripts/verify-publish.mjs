#!/usr/bin/env node
/**
 * 发布前自检（出门前一道闸门）。
 *
 *   node scripts/verify-publish.mjs                # 轻量档：工作区 / CI / 两个试玩链接
 *   node scripts/verify-publish.mjs --browser     # 加真浏览器首访走查（点「先听一首」真出声）
 *   node scripts/verify-publish.mjs --offline     # 只跑本地项，不联网
 *   node scripts/verify-publish.mjs --self-test   # 变异自检：注入坏数据，闸门必须变红
 *
 * 为什么要有它：2026-11-07~08 连着四次提交，`build` 全红但 `Deploy to GitHub Pages`
 * 每次都 success，被「部署成功」盖了四轮没人发现。文章里还给了两个试玩链接，
 * 一旦其中一个停在旧版，「先听一首」点了没声音，首访修复就白做一半。
 * 这些检查以前全靠人手工做，本脚本把它们收成一条命令。
 *
 * 2026-11-09 又补一条：方向 C 改完仓库口径后，草稿箱待群发的定位文没跟上
 * （仍把已判定失效的「拍照认谱」当核心入口写）。故新增「对外口径无超线表述」，
 * 把当前有效口径文件里的禁用短语收进闸门，防止口径改完又悄悄回退。
 *
 * 环境（区分 dev / 线上）：
 *   - 本机沙箱自带代理会让直连域名 502，脚本自动剔除指向 50218 的代理变量；
 *   - Vercel 域名需走本机 Clash：VERCEL_PROXY=http://127.0.0.1:7890 node scripts/verify-publish.mjs
 *   - --browser 需要项目根装了 playwright；缺了只报 WARN，不阻塞轻量档。
 *
 * 退出码：0 = 全过（含 WARN）；1 = 有 FAIL；2 = 用法/环境错误。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAGES_URL = process.env.PAGES_URL || "https://qiaopengjun5162.github.io/taiyin-guqin/";
const VERCEL_URL = process.env.VERCEL_URL || "https://taiyin-guqin-alws.vercel.app/";
const VERCEL_PROXY = process.env.VERCEL_PROXY || "";
const OLD_COPY = ["AI 传习", "AI传习", "智能拼装", "非遗科技复活"];
const NEW_TITLE = "打谱工具";

// 2026-11-09 判定后，当前对外口径里不该再出现的「已完成能力」式表述。
// 只列肯定式短语：pitch.md 红线表把这些当作「不能说」的反面示例，故不扫它。
const BANNED_COPY = [
  "拍照识谱",
  "拍照识别 ✅",
  "可识别本项目字体渲染的完整减字",
  "可认完整减字",
  "AI 按坐标识别",
  "整字都在",
];
// 只扫「陈述当前能力」的文件。历史复盘 / 更正记录 / 待群发物料一律不扫，
// 否则闸门会被历史引用弄成恒红，反而没人信它。物料一致性另按复核清单人工核。
const COPY_FILES = [
  "README.md",
  "docs/overview.md",
  "apps/web/src/app/layout.tsx",
  "apps/web/src/components/jianzi-recognizer.tsx",
  "apps/web/src/components/jianzi-sheet-recognizer.tsx",
];

const argv = process.argv.slice(2);
const OFFLINE = argv.includes("--offline");
const BROWSER = argv.includes("--browser");
const SELF_TEST = argv.includes("--self-test");
const ALLOW_DIRTY = argv.includes("--allow-dirty");

const results = [];
const add = (level, name, detail = "") => results.push({ level, name, detail });
const ok = (n, d) => add("PASS", n, d);
const warn = (n, d) => add("WARN", n, d);
const bad = (n, d) => add("FAIL", n, d);

/** 沙箱代理（端口 50218）会让 curl/gh 的直连请求 502，逐条剔除。 */
function childEnv() {
  const env = { ...process.env };
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
    if (env[k]?.includes("50218")) delete env[k];
  }
  return env;
}

function run(cmd, args, opts = {}) {
  try {
    return { code: 0, out: execFileSync(cmd, args, { encoding: "utf8", env: childEnv(), ...opts }).trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout?.toString() || "") + (e.stderr?.toString() || "") };
  }
}

/** 纯函数，便于 --self-test 做变异验证：旧门面必须被判红。 */
export function isCurrentCopy(html) {
  if (!html.includes(NEW_TITLE)) return false;
  return !OLD_COPY.some((w) => html.includes(w));
}

/**
 * 纯函数：返回命中的禁用短语（去重）。
 * 注释行豁免——组件头部注释要保留「旧注释称…是错的，已更正」这段误判史，
 * 属否定语境；UI 文案行不豁免，出现即判红。
 */
export function bannedCopyIn(text) {
  const hits = new Set();
  for (const line of text.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) continue;
    for (const phrase of BANNED_COPY) {
      if (line.includes(phrase)) hits.add(phrase);
    }
  }
  return [...hits];
}

/** 纯函数：只要有一个 failure 就红；有未跑完的单独标 PENDING。 */
export function ciVerdict(runs) {
  if (!runs.length) return "none";
  if (runs.some((r) => r.status === "completed" && r.conclusion !== "success")) return "fail";
  if (runs.some((r) => r.status !== "completed" || !r.conclusion)) return "pending";
  return "pass";
}

function checkGit() {
  const head = run("git", ["rev-parse", "HEAD"]);
  if (head.code !== 0) { bad("git HEAD", "不在 git 仓库里"); return ""; }
  const sha = head.out;
  const upstream = run("git", ["rev-parse", "@{u}"]);
  if (upstream.code === 0 && upstream.out !== sha) {
    bad("本地已推到远程", `本地 ${sha.slice(0, 8)} / 远程 ${upstream.out.slice(0, 8)}`);
  } else {
    ok("本地已推到远程", sha.slice(0, 8));
  }
  const dirty = run("git", ["status", "--porcelain"]).out;
  if (dirty) {
    (ALLOW_DIRTY ? warn : bad)("工作区干净", `${dirty.split("\n").length} 个未提交文件（--allow-dirty 可放行）`);
  } else {
    ok("工作区干净");
  }
  return sha;
}

function checkCi(sha) {
  if (!sha) return;
  const r = run("gh", ["run", "list", "--limit", "30", "--json", "workflowName,conclusion,headSha,status"]);
  if (r.code !== 0) { warn("CI 全绿", "gh 不可用（未登录 / 未装），本项跳过"); return; }
  let all = [];
  try { all = JSON.parse(r.out); } catch { warn("CI 全绿", "gh 输出解析失败，本项跳过"); return; }
  const mine = all.filter((x) => x.headSha === sha || x.headSha.startsWith(sha.slice(0, 8)));
  // 关键：逐个列出「当前提交触发的所有 workflow」，不能只看部署那一个。
  const verdict = ciVerdict(mine);
  const summary = mine.map((x) => `${x.workflowName}=${x.conclusion || x.status}`).join(" / ") || "（无记录）";
  if (verdict === "fail") bad("CI 全绿", summary);
  else if (verdict === "pending") warn("CI 全绿", `仍在跑：${summary}`);
  else if (verdict === "none") warn("CI 全绿", "这个提交还没有 CI 记录（刚 push？等一下再跑）");
  else ok("CI 全绿", summary);
}

/** 2026-11-09 新增：当前有效口径文件里不许再出现已被证伪的能力宣称。 */
function checkCopy() {
  let checked = 0;
  const violations = [];
  const missing = [];
  for (const rel of COPY_FILES) {
    let body;
    try {
      body = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    } catch {
      missing.push(rel);
      continue;
    }
    checked++;
    const hits = bannedCopyIn(body);
    if (hits.length) violations.push(`${rel}: ${hits.join("、")}`);
  }
  if (missing.length) warn("对外口径无超线表述", `读不到 ${missing.length} 个文件：${missing.join("、")}`);
  if (!checked) bad("对外口径无超线表述", "一个口径文件都没读到（路径有变动？）");
  else if (violations.length) bad("对外口径无超线表述", violations.join(" | "));
  else ok("对外口径无超线表述", `${checked} 个当前口径文件 / ${BANNED_COPY.length} 条禁用短语`);
}

function fetchHtml(name, url, extra = []) {
  const tmp = mkdtempSync(join(tmpdir(), "ty-publish-"));
  const file = join(tmp, "page.html");
  const r = run("curl", ["-sS", "--max-time", "30", "-o", file, "-w", "%{http_code}", ...extra, url]);
  const html = r.code === 0 ? readFileSync(file, "utf8") : "";
  rmSync(tmp, { recursive: true, force: true });
  if (r.out.trim() !== "200") { bad(`${name} 可访问`, `HTTP ${r.out.trim() || "连不上"}`); return ""; }
  ok(`${name} 可访问`, "HTTP 200");
  if (!isCurrentCopy(html)) {
    bad(`${name} 是新门面`, "标题未含「打谱工具」或仍含旧口径（AI 传习 / 智能拼装）");
  } else {
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    ok(`${name} 是新门面`, title);
  }
  return html;
}

function extractMeta(html, key) {
  return html.match(new RegExp(`name="${key}" content="([^"]*)"`))?.[1] ?? "";
}

function checkSites() {
  const pages = fetchHtml("GitHub Pages", PAGES_URL);
  const vercel = fetchHtml("Vercel", VERCEL_URL, VERCEL_PROXY ? ["--proxy", VERCEL_PROXY] : []);
  if (pages && vercel) {
    const a = extractMeta(pages, "description");
    const b = extractMeta(vercel, "description");
    if (a && a === b) ok("两站点文案同源", a.slice(0, 28) + "…");
    else if (!a || !b) warn("两站点文案同源", "有一边没抓到 description（静态导出可能不含）");
    else bad("两站点文案同源", "description 不一致，可能一边是旧构建");
  }
}

async function checkBrowser() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    warn("真浏览器首访", "未装 playwright，跳过（可 --offline 或只跑轻量档）");
    return;
  }
  const INIT = `
    window.__audio = { created: 0, running: 0 };
    const Native = window.AudioContext;
    if (Native) window.AudioContext = class extends Native {
      constructor(...a) { super(...a); window.__audio.created++; if (this.state === "running") window.__audio.running++; }
    };`;
  for (const t of [
    { name: "GitHub Pages", url: PAGES_URL, opts: { args: ["--no-proxy-server"] } },
    { name: "Vercel", url: VERCEL_URL, opts: VERCEL_PROXY ? { proxy: { server: VERCEL_PROXY } } : {} },
  ]) {
    let browser;
    try {
      browser = await chromium.launch(t.opts);
      const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
      await page.addInitScript(INIT);
      await page.goto(t.url, { waitUntil: "networkidle", timeout: 60000 });
      const intro = await page.locator('section[aria-label="太音是什么"]').count();
      const btn = page.getByRole("button", { name: /先听一首/ });
      if (!intro || !(await btn.count())) {
        bad(`${t.name} 首访链路`, "介绍区或「先听一首」按钮缺失");
      } else {
        await btn.click();
        await page.waitForTimeout(1500);
        const audio = await page.evaluate(() => window.__audio);
        const texts = await page.locator("button").allTextContents();
        const playing = texts.some((b) => /停止|暂停/.test(b));
        if (audio.created >= 1 && audio.running >= 1 && playing) {
          ok(`${t.name} 首访链路`, `AudioContext ${audio.created} 次 / running / 播放键变停止`);
        } else {
          bad(`${t.name} 首访链路`, `AudioContext=${JSON.stringify(audio)} 播放态=${playing}`);
        }
      }
    } catch (e) {
      bad(`${t.name} 首访链路`, String(e).slice(0, 120));
    } finally {
      await browser?.close();
    }
  }
}

function selfTest() {
  // 变异验证：把「新门面」和「旧门面」都喂进去，闸门必须给出相反结论。
  const cases = [
    ["新门面应通过", isCurrentCopy('<title>太音 · 古琴打谱工具</title>'), true],
    ["旧门面须判红", isCurrentCopy('<title>太音 · 古琴AI传习平台</title>'), false],
    ["旧副标题须判红", isCurrentCopy('打谱工具 减字谱智能拼装 · 非遗科技复活'), false],
    ["单个 failure 须判红", ciVerdict([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }]), "fail"],
    ["全 success 才通过", ciVerdict([{ status: "completed", conclusion: "success" }]), "pass"],
    ["未跑完须标 pending", ciVerdict([{ status: "in_progress", conclusion: "" }]), "pending"],
    ["干净口径应无命中", bannedCopyIn("键盘打谱、简谱转减字、打谱出声").length, 0],
    ["旧 slogan 须判红", bannedCopyIn("把看不懂的古琴老谱，拍照识谱、简谱转减字").length > 0, true],
    ["注释里的更正史应豁免", bannedCopyIn(" * 旧注释称「大九勾四这类整字都在」是错的，已更正。").length, 0],
    ["UI 文案里的旧口径须判红", bannedCopyIn('        "AI 按坐标识别每个减字"').length > 0, true],
  ];
  let failed = 0;
  for (const [name, got, want] of cases) {
    const pass = got === want;
    if (!pass) failed++;
    console.log(`${pass ? "✅" : "❌"} ${name}（得到 ${String(got)}）`);
  }
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : `SELF-TEST OK: ${cases.length}/${cases.length}（含 5 条变异）`);
  process.exit(failed ? 1 : 0);
}

if (SELF_TEST) selfTest();

const sha = checkGit();
checkCi(sha);
checkCopy();
if (!OFFLINE) {
  checkSites();
  if (BROWSER) await checkBrowser();
} else {
  warn("线上检查", "--offline 已跳过站点与首访检查");
}

console.log("\n──────── 发布前自检 ────────");
for (const r of results) {
  const icon = r.level === "PASS" ? "✅" : r.level === "WARN" ? "⚠️ " : "❌";
  console.log(`${icon} ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
const counts = results.reduce((m, r) => ({ ...m, [r.level]: (m[r.level] || 0) + 1 }), {});
console.log(`\nPASS ${counts.PASS || 0} / WARN ${counts.WARN || 0} / FAIL ${counts.FAIL || 0}`);
process.exit(counts.FAIL ? 1 : 0);
