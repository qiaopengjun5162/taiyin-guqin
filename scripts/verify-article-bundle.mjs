#!/usr/bin/env node
/**
 * 一篇文章的「产物三源」核对：md（源）/ html（渲染）/ draft.json（真正推给微信的 body）。
 *
 * 为什么需要它：2026-11-09 推草稿箱时，`moonpub push` 实际吃的是 html 链路而不是
 * draft.json。只给 draft.json 打补丁、html 还是旧稿，结果「推送全绿、推上去还是旧文」。
 * 所以每次推完都要回来断言三源一致，而不是靠眼睛看推送日志。
 *
 * 用法：
 *   node scripts/verify-article-bundle.mjs taiyin-what-is-it                 # 默认 post
 *   node scripts/verify-article-bundle.mjs taiyin-guqin-launch --stage pre
 *   node scripts/verify-article-bundle.mjs <dir>/<slug>.md --expect-media-id 100018516 --expect-images 8
 *
 * --stage pre ：render 之后、update-draft 之前。允许 html 里有 data:image（尚未上传 CDN）。
 * --stage post：update-draft 之后。要求 data:image=0、图片已是 mmbiz 链接、体积不暴涨。
 *
 * 退出码：0 全过；1 有 FAIL；2 用法错误。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const STALE = ["拍照识别", "识别回来", "一键导入可播曲谱", "拍照或截图上传", "识别入谱"];
const REQUIRED = ["图片录入", "逐格校正"];
const MAX_CONTENT = 200 * 1024;
const MAX_HTML = 500 * 1024;

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const flag = (name, dflt = "") => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const stage = flag("--stage", "post");
const expectMediaId = flag("--expect-media-id");
const expectImages = flag("--expect-images") ? Number(flag("--expect-images")) : null;

const rows = [];
const add = (level, name, detail = "") => rows.push({ level, name, detail });

if (!target) {
  console.error("用法: node scripts/verify-article-bundle.mjs <slug|md 路径> [--stage pre|post] [--expect-media-id id] [--expect-images n]");
  process.exit(2);
}
if (!["pre", "post"].includes(stage)) {
  console.error(`--stage 只认 pre / post，收到 ${stage}`);
  process.exit(2);
}

const mdPath = target.endsWith(".md") ? resolve(target) : resolve(dirname(target) || ".", `${basename(target)}.md`);
const dir = dirname(mdPath);
const slug = basename(mdPath, ".md");
const p = (ext) => resolve(dir, `${slug}.${ext}`);

function parseFrontmatter(text) {
  const lines = text.split("\n");
  const fm = {};
  if (lines[0]?.trim() !== "---") return fm;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (m) fm[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return fm;
}

// ── 1. 五件套存在 ────────────────────────────────────────────
for (const [name, path] of [
  ["md", mdPath],
  ["html", p("html")],
  ["draft.json", p("draft.json")],
  ["media_id", p("media_id")],
  ["cover.png", p("cover.png")],
]) {
  if (existsSync(path)) add("PASS", `${name} 存在`, `${statSync(path).size} B`);
  else add("FAIL", `${name} 存在`, `缺 ${path}`);
}

const mdText = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
const html = existsSync(p("html")) ? readFileSync(p("html"), "utf8") : "";
let draft = null;
try {
  draft = JSON.parse(readFileSync(p("draft.json"), "utf8"))?.articles?.[0] ?? null;
} catch {
  add("FAIL", "draft.json 可解析", "读不出 articles[0]");
}
const mediaId = existsSync(p("media_id")) ? readFileSync(p("media_id"), "utf8").trim() : "";
const content = draft?.content ?? "";

// ── 2. 三源口径 ──────────────────────────────────────────────
const sources = { md: mdText, html, "draft.json": content };
for (const [name, text] of Object.entries(sources)) {
  if (!text) continue;
  const stale = STALE.filter((s) => text.includes(s));
  if (stale.length) add("FAIL", `${name} 旧口径零残留`, stale.join("、"));
  else add("PASS", `${name} 旧口径零残留`);
}
const missing = REQUIRED.filter((k) => !mdText.includes(k));
if (missing.length) add("FAIL", "md 有边界表述", `缺 ${missing.join("、")}`);
else add("PASS", "md 有边界表述", REQUIRED.join(" + "));

// ── 3. title / digest 与 md 一致 ─────────────────────────────
const fm = parseFrontmatter(mdText);
const wantTitle = fm.wechat_title || fm.title || "";
if (!draft) {
  // 上面已记 FAIL
} else if (wantTitle && draft.title !== wantTitle) {
  add("FAIL", "draft 标题与 md 一致", `draft=${draft.title?.slice(0, 24)} / md=${wantTitle.slice(0, 24)}`);
} else {
  add("PASS", "draft 标题与 md 一致", String(draft.title).slice(0, 30));
}

const fmDigest = (fm.digest || "").trim();
const dDigest = (draft?.digest || "").trim();
if (!fmDigest || !dDigest) {
  add("WARN", "draft 摘要与 md 一致", "有一边为空");
} else if (fmDigest.startsWith(dDigest)) {
  const cut = fmDigest.length > dDigest.length;
  add("PASS", "draft 摘要与 md 一致", cut ? `截断到 ${dDigest.length} 字（微信摘要按字节截断）` : "完全一致");
} else {
  add("FAIL", "draft 摘要与 md 一致", `draft=${dDigest.slice(0, 24)}… / md=${fmDigest.slice(0, 24)}…`);
}

// ── 4. 图片与体积（post 才严格要求）─────────────────────────
const base64 = (content.match(/data:image/g) || []).length;
const cdn = (content.match(/mmbiz\.qpic\.cn/g) || []).length;
// 相对路径的图（fig/xxx.png）在微信正文里一定是破图：push/update-draft 应当
// 把它们上传成 CDN 链接并回写。若推完还剩相对路径，说明上传没发生。
const relImgs = [...content.matchAll(/<img[^>]+src="((?!https?:)[^"]*)"/g)].map((m) => m[1]);
if (stage === "post") {
  if (base64 > 0) add("FAIL", "正文没有内嵌 base64", `${base64} 处，正文 ${content.length} 字符`);
  else add("PASS", "正文没有内嵌 base64");
  if (relImgs.length) add("FAIL", "正文图片都是线上地址", `${relImgs.length} 个相对路径：${relImgs.slice(0, 3).join("、")}`);
  else add("PASS", "正文图片都是线上地址");
  if (expectImages !== null) {
    if (cdn === expectImages) add("PASS", "CDN 图片数量", String(cdn));
    else add("FAIL", "CDN 图片数量", `期望 ${expectImages}，实际 ${cdn}`);
  } else {
    add("PASS", "CDN 图片数量", String(cdn));
  }
  if (content.length > MAX_CONTENT) add("FAIL", "正文体积", `${content.length} 字符 > ${MAX_CONTENT}`);
  else add("PASS", "正文体积", `${content.length} 字符`);
  if (html.length > MAX_HTML) add("FAIL", "html 体积", `${html.length} 字符 > ${MAX_HTML}`);
  else add("PASS", "html 体积", `${html.length} 字符`);
} else {
  add("PASS", "pre 阶段跳过内嵌图检查", `data:image=${base64}（render 后正常，推送时才上传）`);
}

// ── 5. media_id 未变 ────────────────────────────────────────
if (expectMediaId) {
  if (mediaId === expectMediaId) add("PASS", "media_id 未变", mediaId);
  else add("FAIL", "media_id 未变", `期望 ${expectMediaId}，实际 ${mediaId || "（空）"}`);
} else {
  add("PASS", "media_id", mediaId || "（空，未指定期望值）");
}

// ── 6. 封面确属本文 ─────────────────────────────────────────
const thumb = draft?.thumb_media_id || "";
if (!thumb) add("WARN", "封面指向", "draft 里没有 thumb_media_id");
else if (thumb.includes(`${slug}.cover`) || thumb === "") add("PASS", "封面指向本文", basename(thumb));
else add("WARN", "封面指向", `可能不是本文封面：${basename(thumb)}`);

// ── 输出 ────────────────────────────────────────────────────
console.log(`产物三源核对 · ${slug}（stage=${stage}）`);
console.log("─".repeat(60));
for (const r of rows) {
  const icon = r.level === "PASS" ? "✅" : r.level === "WARN" ? "⚠️ " : "❌";
  console.log(`${icon} ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
const c = (lv) => rows.filter((r) => r.level === lv).length;
console.log("─".repeat(60));
console.log(`PASS ${c("PASS")} / WARN ${c("WARN")} / FAIL ${c("FAIL")}`);
if (c("FAIL") === 0) {
  const h = createHash("sha256").update(content).digest("hex").slice(0, 12);
  console.log(`正文指纹 ${h}（可用来对比推送前后是否同一份）`);
}
process.exit(c("FAIL") ? 1 : 0);
