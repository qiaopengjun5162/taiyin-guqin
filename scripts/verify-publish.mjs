#!/usr/bin/env node
/**
 * 发布前自检（出门前一道闸门）。
 *
 *   node scripts/verify-publish.mjs                # 轻量档：工作区 / CI / 两个试玩链接
 *   node scripts/verify-publish.mjs --browser     # 加真浏览器首访走查（点「先听一首」真出声）
 *   node scripts/verify-publish.mjs --offline     # 只跑本地项，不联网
 *   node scripts/verify-publish.mjs --copy-only   # 只跑口径与物料台账，几秒、不读 git、不联网（CI 用）
 *   node scripts/verify-publish.mjs --copy-only --vault "$VAULT"   # 再扫一遍 vault 里的 live 待发稿
 *   node scripts/verify-publish.mjs --self-test   # 变异自检：注入坏数据，闸门必须变红
 *
 * 2026-11-09 第二次扩层（本轮）：上一轮把「当前口径文件」纳入闸门后，仍漏掉了
 * 待群发物料本身——草稿箱里 4 篇稿还在讲已证伪的「拍照识别」，其中一篇封面图上
 * 就印着这四个字。于是新增物料扫描：docs/articles/drafts/*.md 全扫、fail-closed
 * （出现即必须入台账），frontmatter 一并扫，历史段按台账放行，行级豁免带失效检测。
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
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeLine,
  REQUIRED_PHRASES,
  scanMaterial,
  toActionsAnnotations,
  validateAllowlist,
} from "./lib/copy-gate.mjs";

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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRAFTS_DIR = "docs/articles/drafts";
const LEDGER_REL = "docs/articles/material/pending-copy.json";
const ALLOWLIST_REL = "docs/articles/material/copy-allowlist.json";

const argv = process.argv.slice(2);
const OFFLINE = argv.includes("--offline");
const BROWSER = argv.includes("--browser");
const SELF_TEST = argv.includes("--self-test");
const COPY_ONLY = argv.includes("--copy-only");
const ALLOW_DIRTY = argv.includes("--allow-dirty");
const VAULT_ROOT = (() => {
  const i = argv.indexOf("--vault");
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1]);
  return process.env.TAIYIN_VAULT ? resolve(process.env.TAIYIN_VAULT) : "";
})();

const results = [];
const materialFindings = [];
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
function checkCurrentCopy() {
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

// ── 2026-11-09 第二次扩层：待群发物料 ───────────────────────────
const sha16 = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

function readJsonRel(rel) {
  const p = resolve(REPO_ROOT, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function listDrafts() {
  const dir = resolve(REPO_ROOT, DRAFTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `${DRAFTS_DIR}/${f}`);
}

function formatFindings(findings, limit = 25) {
  const lines = findings.slice(0, limit).map((f) => {
    const loc = f.line ? `${f.file}:${f.line}` : `${f.file} (${f.where})`;
    return `  ${loc} [${f.ruleId}] ${f.phrase}\n      -> ${f.advice}`;
  });
  if (findings.length > limit) lines.push(`  …… 还有 ${findings.length - limit} 处`);
  return lines.join("\n");
}

/** 扫所有 pending 物料（仓库 + 可选 vault）。fail-closed：drafts 下每篇都必须入账。 */
function checkMaterialCopy() {
  const ledger = readJsonRel(LEDGER_REL);
  if (!ledger || !Array.isArray(ledger.articles)) {
    bad("待群发物料口径", `台账读不到或格式不对：${LEDGER_REL}`);
    return;
  }
  const allowDoc = readJsonRel(ALLOWLIST_REL);
  const allow = Array.isArray(allowDoc?.entries) ? allowDoc.entries : [];

  const known = new Set(ledger.articles.map((a) => a.repo_path).filter(Boolean));
  const drafts = listDrafts();
  const unlisted = drafts.filter((f) => !known.has(f));
  if (unlisted.length) {
    bad("待群发物料已入账", `${unlisted.length} 个草稿没进台账：${unlisted.join("、")}`);
  } else {
    ok("待群发物料已入账", `${drafts.length} 个草稿全部在台账内`);
  }

  const pending = ledger.articles.filter((a) => a.state === "pending");
  const findings = [];
  const missing = [];
  let scanned = 0;

  for (const a of pending) {
    if (!a.repo_path) continue;
    const p = resolve(REPO_ROOT, a.repo_path);
    if (!existsSync(p)) {
      missing.push(`${a.slug}（${a.repo_path}）`);
      continue;
    }
    scanned++;
    findings.push(
      ...scanMaterial({
        text: readFileSync(p, "utf8"),
        file: a.repo_path,
        historicalHeadings: a.historical_headings || [],
        allow,
        requiredPhrases: a.required_phrases || REQUIRED_PHRASES,
        hashFn: sha16,
      }).findings,
    );
  }

  if (VAULT_ROOT) {
    for (const a of pending) {
      if (!a.vault_path) continue;
      const p = resolve(VAULT_ROOT, a.vault_path);
      if (!existsSync(p)) {
        missing.push(`${a.slug}（vault:${a.vault_path}）`);
        continue;
      }
      scanned++;
      findings.push(
        ...scanMaterial({
          text: readFileSync(p, "utf8"),
          file: `vault:${a.vault_path}`,
          historicalHeadings: a.historical_headings || [],
          allow: [],
          requiredPhrases: a.required_phrases || REQUIRED_PHRASES,
          hashFn: sha16,
        }).findings,
      );
    }
  } else {
    warn("vault 待发稿口径", "未给 --vault，只扫了仓库侧；发布前请带 --vault 再跑一次");
  }

  if (missing.length) bad("待发稿文件齐全", `读不到：${missing.join("、")}`);
  if (findings.length) {
    materialFindings.push(...findings);
    bad("待群发物料口径", `${findings.length} 处超线\n${formatFindings(findings)}`);
  } else ok("待群发物料口径", `${scanned} 份稿 / ${pending.length} 篇待发`);
}

/** 台账结构 + 豁免表自身（孤儿 / 超限 / 过期）。 */
function checkLedger() {
  const ledger = readJsonRel(LEDGER_REL);
  if (!ledger || !Array.isArray(ledger.articles)) {
    bad("物料台账结构", `读不到 ${LEDGER_REL}`);
    return;
  }
  const problems = [];
  const seen = new Set();
  const validStates = new Set(["pending", "published", "internal", "hold"]);

  for (const a of ledger.articles) {
    if (!a.slug) problems.push("有条目缺 slug");
    if (seen.has(a.slug)) problems.push(`slug 重复：${a.slug}`);
    seen.add(a.slug);
    if (!validStates.has(a.state)) problems.push(`${a.slug} 的 state 非法：${a.state}`);
    if (a.repo_path && !existsSync(resolve(REPO_ROOT, a.repo_path))) {
      problems.push(`${a.slug} 的 repo_path 不存在：${a.repo_path}`);
    }
    if (a.state === "internal" && a.repo_path?.startsWith(`${DRAFTS_DIR}/`)) {
      problems.push(`${a.slug} 标为 internal 却仍在 drafts/ 下`);
    }
    if (a.state === "pending" && !a.media_id) problems.push(`${a.slug} 是 pending 但没记 media_id`);
  }

  const allowDoc = readJsonRel(ALLOWLIST_REL);
  const entries = Array.isArray(allowDoc?.entries) ? allowDoc.entries : [];
  const byFile = new Map();
  for (const e of entries) {
    if (!byFile.has(e.file)) {
      const p = resolve(REPO_ROOT, e.file);
      byFile.set(
        e.file,
        existsSync(p) ? readFileSync(p, "utf8").split("\n").map((l) => sha16(normalizeLine(l))) : [],
      );
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const allowFindings = validateAllowlist(entries, byFile, today);

  if (problems.length || allowFindings.length) {
    const lines = [
      ...problems.map((p) => `  ${p}`),
      ...allowFindings.map((f) => `  [${f.ruleId}] ${f.phrase} — ${f.advice}`),
    ];
    bad("物料台账与豁免表", `${problems.length + allowFindings.length} 处\n${lines.join("\n")}`);
  } else {
    ok("物料台账与豁免表", `${ledger.articles.length} 篇 / ${entries.length} 条豁免`);
  }
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
    ["旧门面须判红", isCurrentCopy('<title>太音 · 古琴AI传习平台</title>'), false, true],
    ["旧副标题须判红", isCurrentCopy('打谱工具 减字谱智能拼装 · 非遗科技复活'), false, true],
    ["单个 failure 须判红", ciVerdict([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }]), "fail", true],
    ["全 success 才通过", ciVerdict([{ status: "completed", conclusion: "success" }]), "pass"],
    ["未跑完须标 pending", ciVerdict([{ status: "in_progress", conclusion: "" }]), "pending", true],
    ["干净口径应无命中", bannedCopyIn("键盘打谱、简谱转减字、打谱出声").length, 0],
    ["旧 slogan 须判红", bannedCopyIn("把看不懂的古琴老谱，拍照识谱、简谱转减字").length > 0, true, true],
    ["注释里的更正史应豁免", bannedCopyIn(" * 旧注释称「大九勾四这类整字都在」是错的，已更正。").length, 0],
    ["UI 文案里的旧口径须判红", bannedCopyIn('        "AI 按坐标识别每个减字"').length > 0, true, true],
  ];

  // ── 物料层（2026-11-09 新增）────────────────────────────────
  const has = (text, opts = {}) => scanMaterial({ text, file: "t.md", hashFn: sha16, requiredPhrases: [], ...opts }).findings.length > 0;
  const allowCase = (entries, text) => validateAllowlist(entries, new Map([["t.md", text.split("\n").map((l) => sha16(normalizeLine(l)))]]), "2026-11-09");
  const exemptLine = "支持拍照识别。";

  cases.push(
    ["正文「拍照识别」须判红", has(`## 现在\n\n${exemptLine}`), true, true],
    ["标题含超线词须判红", has('---\ntitle: "拍照识别全记录"\n---\n\n正文'), true, true],
    ["摘要含「识别准确率」须判红", has('---\ndigest: "识别准确率 0 到 100"\n---\n\n正文'), true, true],
    ["否定句应放行", has("## 现在\n\n标准完整减字尚不能识别。"), false],
    ["历史段的「能识别」应放行", has("## 七、当时的路\n\n当时能识别若干字。", { historicalHeadings: ["## 七、当时的路"] }), false],
    ["同一句在当前段须判红", has("## 现在\n\n当前能识别若干字。"), true, true],
    ["历史段标题被改名须报错", has("## 八、改过名的标题\n\n正文", { historicalHeadings: ["## 七、当时的路"] }), true, true],
    ["缺必填边界表述须判红", scanMaterial({ text: "## 现在\n\n能拼能算。", file: "t.md", hashFn: sha16 }).findings.some((f) => f.ruleId === "R1"), true, true],
    ["有必填边界表述应放行", scanMaterial({ text: "## 现在\n\n图片录入（受限，需逐格校正）。", file: "t.md", hashFn: sha16 }).findings.length, 0],
    ["只写一半边界表述须判红", scanMaterial({ text: "## 现在\n\n图片录入（受限）。", file: "t.md", hashFn: sha16 }).findings.some((f) => f.ruleId === "R1"), true, true],
    ["行级豁免命中应放行", has(`## 现在\n\n${exemptLine}`, { allow: [{ id: "EX", file: "t.md", sha256: sha16(normalizeLine(exemptLine)), ruleId: "H1" }] }), false],
    ["豁免行改一个字须判红（失效检测）", has(`## 现在\n\n${exemptLine}x`, { allow: [{ id: "EX", file: "t.md", sha256: sha16(normalizeLine(exemptLine)), ruleId: "H1" }] }), true, true],
    ["孤儿豁免须报错", allowCase([{ id: "EX", file: "t.md", sha256: "deadbeef", ruleId: "H1" }], "## 现在\n\n随便一句。").some((f) => f.ruleId === "A2"), true, true],
    ["过期豁免须报错", allowCase([{ id: "EX", file: "t.md", sha256: sha16(normalizeLine(exemptLine)), ruleId: "H1", expires: "2026-01-01" }], `## 现在\n\n${exemptLine}`).some((f) => f.ruleId === "A4"), true, true],
    [
      "豁免条数超限须报错",
      validateAllowlist(
        Array.from({ length: 9 }, (_, i) => ({ id: `E${i}`, file: "t.md", sha256: "abc", ruleId: "H1" })),
        new Map([["t.md", ["abc"]]]),
        "2026-11-09",
      ).some((f) => f.ruleId === "A1"),
      true,
      true,
    ],
  );

  let failed = 0;
  for (const [name, got, want] of cases) {
    const pass = got === want;
    if (!pass) failed++;
    console.log(`${pass ? "✅" : "❌"} ${name}（得到 ${String(got)}）`);
  }
  const mutations = cases.filter((c) => c[3]).length;
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : `SELF-TEST OK: ${cases.length}/${cases.length}（含 ${mutations} 条变异）`);
  process.exit(failed ? 1 : 0);
}

function report() {
  console.log("\n──────── 发布前自检 ────────");
  for (const r of results) {
    const icon = r.level === "PASS" ? "✅" : r.level === "WARN" ? "⚠️ " : "❌";
    console.log(`${icon} ${r.name}${r.detail ? " — " + r.detail : ""}`);
  }
  for (const line of toActionsAnnotations(materialFindings)) console.log(line);
  const counts = results.reduce((m, r) => ({ ...m, [r.level]: (m[r.level] || 0) + 1 }), {});
  console.log(`\nPASS ${counts.PASS || 0} / WARN ${counts.WARN || 0} / FAIL ${counts.FAIL || 0}`);
  process.exit(counts.FAIL ? 1 : 0);
}

if (SELF_TEST) selfTest();

// --copy-only：只跑口径与台账，不读 git、不联网、不需要 vault → 给 CI 用。
// 不要拿 --offline 顶替：它仍会跑 checkGit / checkCi，在 PR merge ref 下会假红。
if (COPY_ONLY) {
  checkCurrentCopy();
  checkMaterialCopy();
  checkLedger();
  report();
}

const sha = checkGit();
checkCi(sha);
checkCurrentCopy();
checkMaterialCopy();
checkLedger();
if (!OFFLINE) {
  checkSites();
  if (BROWSER) await checkBrowser();
} else {
  warn("线上检查", "--offline 已跳过站点与首访检查");
}

report();
