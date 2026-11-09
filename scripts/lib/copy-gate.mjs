/**
 * 待群发物料的「对外口径」判定（纯函数，无 IO）。
 *
 * 为什么独立成模块：2026-11-09 那起事故的根因不是写错一句话，是发布闸门
 * 只扫「当前口径文件」，从不扫待发稿。判定逻辑放进纯函数，才能被 --self-test
 * 用合成文本做变异验证——不然「闸门是绿的」和「闸门根本没扫」分不出来。
 *
 * 三层规则：
 *   HARD        任何位置命中即红（含 frontmatter）；只有行级豁免能放行
 *   CONTEXT     只在「当前能力段」生效；历史段自动放行（过程记录可以留）
 *   FRONTMATTER 只扫标题 / 摘要 / 封面标题；永不允许豁免
 */

/** 任何位置命中即红。只列肯定式短语，不列反面示例。 */
export const HARD_RULES = [
  { id: "H1", phrase: "拍照识别", advice: "改成「图片录入（受限）」；确属过程记录时改过去时并在 allowlist 登记" },
  { id: "H2", phrase: "拍照识谱", advice: "同上：当前口径是「图片录入（受限）」，不是拍张照就成谱" },
  { id: "H3", phrase: "拍照或截图上传", advice: "改成「上传字体渲染的干净电子谱面」" },
  { id: "H4", phrase: "识别入谱", advice: "改成「辅助录入（受限）」" },
  { id: "H5", phrase: "一键导入可播曲谱", advice: "标准完整减字尚不能识别，不能承诺一键成谱" },
  { id: "H6", phrase: "可识别本项目字体渲染的完整减字", advice: "11-09 判定已证伪，删掉这句能力宣称" },
  { id: "H7", phrase: "可认完整减字", advice: "同上" },
  { id: "H8", phrase: "AI 按坐标识别", advice: "同上" },
  { id: "H9", phrase: "整字都在", advice: "同上" },
  { id: "H10", phrase: "识别回来", advice: "改成「识别结果需逐格校正」" },
  { id: "H11", phrase: "能拍照", advice: "改成「能做图片录入（受限）」" },
  { id: "H12", phrase: "识别准确率 100", advice: "100% 只在同分布自测成立，不可写成对外能力" },
];

/** 只在当前能力段生效。历史段（过程记录）自动放行。 */
export const CONTEXT_RULES = [
  { id: "C1", phrase: "能识别", negative: ["不", "未", "没", "难以", "无法", "不能"], advice: "改成「能辅助录入（受限）」" },
  { id: "C2", phrase: "能拍", negative: ["不", "未", "没", "难以", "无法", "不能"], advice: "改成「能录」" },
  { id: "C3", phrase: "单字识别", advice: "限定为「复合指法符号的辅助录入」" },
  { id: "C4", phrase: "整页自动切分", advice: "改成「整页切分（辅助）」" },
];

/** 只扫 frontmatter。标题/摘要是最容易被读到的地方，永不允许豁免。 */
export const FRONTMATTER_RULES = [
  { id: "F1", phrase: "识别准确率", advice: "标题/摘要不能以「识别准确率」为核心卖点" },
  { id: "F2", phrase: "0 到 100", advice: "同上：0→100 只指同分布自测" },
  { id: "F3", phrase: "0% 到 100", advice: "同上" },
];

/**
 * 待发稿必须出现的边界表述，缺一即红（防「删了旧话但没写新边界」）。
 * 用「图片录入 + 逐格校正」而不是「受限」：后者太死，稿子里更自然的写法是
 * 「仅作干净电子谱面的辅助」「结果必须逐格校正」，语义等价但字面不同。
 */
export const REQUIRED_PHRASES = ["图片录入", "逐格校正"];

export const FRONTMATTER_KEYS = ["title", "wechat_title", "digest", "cover_title"];

/** 行归一化：去掉首尾空白、压缩内部空白。改一个字 hash 就变，这是特性。 */
export function normalizeLine(line) {
  return line.trim().replace(/\s+/g, " ");
}

/** 极简 frontmatter 解析：只认 ---- 之间的 key: value（不进 YAML 依赖）。 */
export function parseFrontmatter(text) {
  const lines = text.split("\n");
  const fm = {};
  if (lines[0]?.trim() !== "---") return { fm, bodyLines: lines, bodyStartLine: 1 };
  let end = 1;
  for (; end < lines.length; end++) {
    if (lines[end].trim() === "---") break;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[end]);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    fm[m[1]] = v;
  }
  return { fm, bodyLines: lines.slice(end + 1), bodyStartLine: end + 2 };
}

/**
 * 计算每一行归属的标题（含祖先链），用于「历史段」判定。
 * 返回 { owners: [{text, level, start, end}], lineToChain: [] }
 */
export function buildSections(lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (m) heads.push({ text: lines[i].trim(), level: m[1].length, start: i + 1, end: lines.length });
  }
  for (let k = 0; k < heads.length; k++) {
    for (let j = k + 1; j < heads.length; j++) {
      if (heads[j].level <= heads[k].level) { heads[k].end = heads[j].start - 1; break; }
    }
  }
  const chainOf = (lineNo) => {
    const chain = [];
    for (const h of heads) {
      if (lineNo >= h.start && lineNo <= h.end) chain.push(h.text);
    }
    return chain;
  };
  return { heads, chainOf };
}

function hasNegativeBefore(line, idx, negatives) {
  for (const n of negatives || []) {
    if (idx >= n.length && line.slice(idx - n.length, idx) === n) return true;
  }
  return false;
}

/**
 * 扫一篇物料。
 * @param {object} p
 * @param {string} p.text       全文
 * @param {string} p.file       展示用路径
 * @param {string[]} p.historicalHeadings  历史段标题（须在文中恰好出现一次）
 * @param {Array} p.allow       行级豁免 [{sha256, ruleId, ...}]
 * @param {string[]} p.requiredPhrases
 * @param {(s:string)=>string} p.hashFn
 */
export function scanMaterial({ text, file, historicalHeadings = [], allow = [], requiredPhrases = REQUIRED_PHRASES, hashFn }) {
  const findings = [];
  const { fm, bodyLines, bodyStartLine } = parseFrontmatter(text);
  const { chainOf, heads } = buildSections(bodyLines);

  // ── frontmatter：HARD + FRONTMATTER，无豁免 ──────────────────
  for (const key of FRONTMATTER_KEYS) {
    const val = fm[key];
    if (!val) continue;
    for (const r of [...HARD_RULES, ...FRONTMATTER_RULES]) {
      if (val.includes(r.phrase)) {
        findings.push({ file, line: 0, where: `frontmatter:${key}`, ruleId: r.id, phrase: r.phrase, advice: r.advice });
      }
    }
  }

  // ── 历史段标题必须唯一存在（防改标题后豁免范围静默失效）────
  for (const h of historicalHeadings) {
    const n = heads.filter((x) => x.text === h).length;
    if (n !== 1) {
      findings.push({ file, line: 0, where: "ledger", ruleId: "L1", phrase: h, advice: `历史段标题在文中出现 ${n} 次（应为 1 次）：${h}` });
    }
  }

  // ── 正文逐行 ────────────────────────────────────────────────
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const lineNo = i + bodyStartLine;
    const isHistorical = chainOf(lineNo).some((c) => historicalHeadings.includes(c));
    const lineHash = hashFn ? hashFn(normalizeLine(line)) : "";

    const push = (r) => {
      const exempt = allow.some((a) => a.sha256 === lineHash && a.ruleId === r.id);
      if (exempt) return;
      findings.push({ file, line: lineNo, where: "body", ruleId: r.id, phrase: r.phrase, advice: r.advice });
    };

    for (const r of HARD_RULES) if (line.includes(r.phrase)) push(r);

    if (!isHistorical) {
      for (const r of CONTEXT_RULES) {
        let idx = line.indexOf(r.phrase);
        while (idx >= 0) {
          if (!hasNegativeBefore(line, idx, r.negative)) { push(r); break; }
          idx = line.indexOf(r.phrase, idx + 1);
        }
      }
    }
  }

  // ── 必填边界表述 ────────────────────────────────────────────
  for (const p of requiredPhrases) {
    if (!text.includes(p)) {
      findings.push({ file, line: 0, where: "body", ruleId: "R1", phrase: p, advice: `缺少边界表述「${p}」` });
    }
  }

  return { findings, fm, bodyLines, bodyStartLine };
}

/**
 * 校验豁免表自身：孤儿 / 超限 / 过期。
 * @param {Array} entries  allowlist entries
 * @param {Map<string,string[]>} lineHashesByFile  file -> [lineHash,...]
 * @param {string} today  YYYY-MM-DD
 */
export function validateAllowlist(entries, lineHashesByFile, today, limits = { maxEntries: 8, maxPerFile: 4 }) {
  const out = [];
  if (entries.length > limits.maxEntries) {
    out.push({ file: "copy-allowlist.json", ruleId: "A1", phrase: `${entries.length} 条`, advice: `豁免条目超过上限 ${limits.maxEntries}，请先把该改的改掉` });
  }
  const perFile = {};
  for (const e of entries) {
    perFile[e.file] = (perFile[e.file] || 0) + 1;
    const hashes = lineHashesByFile.get(e.file) || [];
    const hits = hashes.filter((h) => h === e.sha256).length;
    if (hits === 0) {
      out.push({ file: "copy-allowlist.json", ruleId: "A2", phrase: e.id, advice: `豁免失效：${e.file} 里已找不到对应行（内容改过或文件移走），请复核后删除该条` });
    } else if (hits > (e.maxHits || 1)) {
      out.push({ file: "copy-allowlist.json", ruleId: "A3", phrase: e.id, advice: `豁免命中 ${hits} 行，超过上限 ${e.maxHits || 1}` });
    }
    if (e.expires && e.expires < today) {
      out.push({ file: "copy-allowlist.json", ruleId: "A4", phrase: e.id, advice: `豁免已于 ${e.expires} 过期，请复核` });
    }
  }
  for (const [f, n] of Object.entries(perFile)) {
    if (n > limits.maxPerFile) {
      out.push({ file: "copy-allowlist.json", ruleId: "A5", phrase: f, advice: `单文件豁免 ${n} 条，超过上限 ${limits.maxPerFile}` });
    }
  }
  return out;
}

/** 把 findings 转成 gitHub actions 注解行（本地跑时为空）。 */
export function toActionsAnnotations(findings) {
  if (!process.env.GITHUB_ACTIONS) return [];
  return findings.map((f) => {
    const loc = f.line ? `file=${f.file},line=${f.line}` : `file=${f.file}`;
    return `::error ${loc}::[${f.ruleId}] ${f.phrase} — ${f.advice}`;
  });
}
