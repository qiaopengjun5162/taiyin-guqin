#!/usr/bin/env node
/**
 * audit-bundle-freshness.mjs — 体检「md 改了但 html 没重渲染」的推送隐患。
 *
 * 为什么需要
 * ----------
 * `moonpub push` 只读 `<slug>.html` 当正文，**不读 md**；而 `just push` /
 * `just update-draft` 都不 render。所以「改了 md 直接推」推的是上一版 html，
 * 而日志照样打印成功。这类问题不会有任何报错，只能静态比对 mtime。
 *
 * 判定口径（整秒比较，与 wxlib.mtime_int 一致）
 * ---------------------------------------------
 *   missing-html  没有 .html                → 推送会推空正文（cookie 模式）
 *   stale-html    md 比 html 新              → 下次推是旧内容
 *   fresh         其余
 *
 * 草稿状态（仅当有 .media_id 时）
 *   pushed-old    media_id 比 html 新 且 md 比 html 新
 *                 → 推的那一次 html 就已经是旧的，后台草稿内容确定落后
 *   draft-behind  media_id 比 md 旧
 *                 → 推过之后又改了 md，草稿落后于源稿
 *   draft-ok      其余
 *
 * 用法
 * ----
 *   node scripts/audit-bundle-freshness.mjs --vault "$HOME/Library/Mobile Documents/com~apple~CloudDocs/ObsidianMain"
 *   node scripts/audit-bundle-freshness.mjs --vault <path> --json
 *   node scripts/audit-bundle-freshness.mjs --vault <path> --stages ready
 *
 * 退出码：0 = 没有 pushed-old / missing-html；1 = 有（可接 CI 或 cron，但目前未接）
 */

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const STAGES_ALL = ["ready", "drafts", "published"];

function parseArgs(argv) {
  const out = { vault: null, json: false, stages: STAGES_ALL, onlyStale: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--only-stale") out.onlyStale = true;
    else if (a === "--vault") out.vault = argv[++i];
    else if (a.startsWith("--vault=")) out.vault = a.slice(8);
    else if (a === "--stages") out.stages = (argv[++i] || "").split(",").filter(Boolean);
    else if (a.startsWith("--stages=")) out.stages = a.slice(9).split(",").filter(Boolean);
    else if (a === "-h" || a === "--help") out.help = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function mtimeInt(p) {
  return Math.floor(statSync(p).mtimeMs / 1000);
}

function fmt(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function humanSec(s) {
  if (s >= 86400) return `${(s / 86400).toFixed(1)}d`;
  if (s >= 3600) return `${(s / 3600).toFixed(1)}h`;
  if (s >= 60) return `${Math.round(s / 60)}m`;
  return `${s}s`;
}

/** 终端显示宽度：CJK 占两格，padEnd 按码点数算会对不齐。 */
function dw(s) {
  let w = 0;
  for (const ch of s) w += ch.codePointAt(0) > 0x2e80 ? 2 : 1;
  return w;
}

function pad(s, width) {
  return s + " ".repeat(Math.max(0, width - dw(s)));
}

function scan(vault, stages) {
  const rows = [];
  for (const stage of stages) {
    const dir = join(vault, "Articles", stage);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const slug = name.slice(0, -3);
      const md = join(dir, name);
      const html = join(dir, `${slug}.html`);
      const mediaIdFile = join(dir, `${slug}.media_id`);

      const mdT = mtimeInt(md);
      const row = { stage, slug, mdT, htmlT: null, mediaIdT: null, mediaId: null, status: "fresh", draft: "unpushed", delta: 0 };

      if (!existsSync(html)) {
        row.status = "missing-html";
      } else {
        row.htmlT = mtimeInt(html);
        row.delta = mdT - row.htmlT;
        if (row.delta > 0) row.status = "stale-html";
      }

      if (existsSync(mediaIdFile)) {
        row.mediaIdT = mtimeInt(mediaIdFile);
        try {
          row.mediaId = readFileSync(mediaIdFile, "utf8").trim();
        } catch {
          row.mediaId = "?";
        }
        if (row.status === "stale-html" && row.mediaIdT > row.htmlT) {
          row.draft = "pushed-old";
        } else if (row.mediaIdT < mdT) {
          row.draft = "draft-behind";
        } else {
          row.draft = "draft-ok";
        }
      }

      rows.push(row);
    }
  }
  return rows;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.vault) {
    console.log(`用法: node scripts/audit-bundle-freshness.mjs --vault <ObsidianMain> [--json] [--stages ready,drafts] [--only-stale]`);
    return args.help ? 0 : 2;
  }

  const vault = resolve(args.vault.replace(/^~/, process.env.HOME));
  if (!existsSync(join(vault, "Articles"))) {
    console.error(`找不到 ${join(vault, "Articles")}，--vault 指错了？`);
    return 2;
  }

  const rows = scan(vault, args.stages);
  const stale = rows.filter((r) => r.status !== "fresh");
  const pushedOld = rows.filter((r) => r.draft === "pushed-old");
  const shown = args.onlyStale ? stale : rows;

  if (args.json) {
    console.log(JSON.stringify({
      vault,
      total: rows.length,
      stale: stale.length,
      missingHtml: rows.filter((r) => r.status === "missing-html").length,
      pushedOld: pushedOld.length,
      rows: shown,
    }, null, 2));
  } else {
    console.log(`\n推送产物体检 · ${vault}`);
    console.log("─".repeat(88));
    console.log(pad("stage", 11) + pad("slug", 44) + pad("md−html", 10) + "草稿");
    console.log("─".repeat(88));
    for (const r of shown) {
      const delta = r.status === "missing-html" ? "无 html" : r.delta > 0 ? `+${humanSec(r.delta)}` : "ok";
      const flag = r.draft === "pushed-old" ? "⚠︎ 落后" : r.draft === "draft-behind" ? "草稿落后" : r.draft;
      console.log(
        pad(r.stage, 11) + pad(r.slug.slice(0, 42), 44) + pad(delta, 10) + flag);
    }
    console.log("─".repeat(88));
    console.log(`共 ${rows.length} 篇 · 产物不同步 ${stale.length} 篇 · 草稿内容确定落后 ${pushedOld.length} 篇`);
    if (stale.length && !args.onlyStale) {
      console.log(`（只看不同步的加 --only-stale）`);
    }
    if (pushedOld.length) {
      console.log(`\n草稿内容确定落后（推的那次 html 就是旧的）:`);
      for (const r of pushedOld) {
        console.log(`  - ${r.stage}/${r.slug}  media_id=${r.mediaId}  md=${fmt(r.mdT)} html=${fmt(r.htmlT)}`);
      }
      console.log(`\n修复: just render <该稿>.md，确认正文图片是线上地址后再推。`);
      console.log(`注意 update-draft 需要 WECHAT_SECRET；没有就只能 push 换 media_id。`);
    }
  }

  return pushedOld.length ? 1 : 0;
}

process.exit(main());
