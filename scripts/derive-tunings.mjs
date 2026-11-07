// 定弦规则推导 / 自证闸门（不进产品，供文档复核用）。
//
// 背景：爱搜减字的音位图生成器列了 16 种定弦（见 docs/competitive-analysis.md 17.5 ①），
// 但只给了「紧几弦 / 慢几弦」的做法，没给音高。要不要把它抄进 lib/tuning.ts，
// 取决于「紧 = 升半音、慢 = 降半音」这个读法能不能自己证明自己。
//
// 判据：把七弦音高算出来，看能不能找到一个宫音，使七个音**全部落在该宫音的清乐七声**
// （五声 + 清角 + 变宫）里。能容纳 → 这个读法与该调自报的调名不矛盾。
//
// 三条结论（2026-11-07 跑出来）：
//   1. 按半音读，慢商调（标 C）、无射调（标 bB）都无宫可容；把「（全）」读成全音，两条同时对上
//      → 「（全）」= 全音。
//   2. 全音修正后 8 条自证通过；侧商调在五种规则读法下都给不出它标的 D。
//   3. 其余未标宫音的条目，判据给不出唯一解，需要《琴学备要》原文。
//
// 用法：node scripts/derive-tunings.mjs
//   退出码 1 = 那 6 条自证项有一条不再成立（说明改动过判据或数据，先看文档 17.5 ①）。

/** 一~七弦「正调」的音高（半音编号，C=0）：C D F G A c d。 */
const ZHENG_DIAO = [0, 2, 5, 7, 9, 0, 2];

/** 音名（降号按传统写法，与 lib/tuning.ts 的 noteNames 一致）。 */
const NOTE_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/** 清乐七声相对宫音的半音数：宫 商 角 清角 徵 羽 变宫。 */
const QING_YUE = [0, 2, 4, 5, 7, 9, 11];

/**
 * 各调的紧慢规则：键是弦序（一~七），值是半音数（+1 紧、-1 慢、-2 慢全音）。
 * `declared` 是源站自己标的调名（只取宫音那部分），用来交叉验证。
 */
const CASES = [
  { name: "正调", rule: {}, declared: "F" },
  { name: "蕤宾调", rule: { 5: +1 }, declared: "B♭" },
  { name: "慢角调", rule: { 3: -1 }, declared: "C" },
  { name: "清商调", rule: { 2: +1, 5: +1, 7: +1 }, declared: "E♭" },
  { name: "慢商调", rule: { 2: -2 }, declared: "C" },
  { name: "无射调", rule: { 1: -2, 5: +1 }, declared: "B♭" },
  { name: "商调", rule: { 1: -1, 3: -1, 4: -1, 6: -1 }, declared: "D" },
  { name: "慢宫调", rule: { 1: -1, 3: -1, 6: -1 }, declared: "G" },
  // 判据给不出唯一宫音（源站也没标），留给《琴学备要》核
  { name: "凄凉调", rule: { 2: +1, 5: +1 }, declared: null },
  { name: "离忧调", rule: { 1: -1, 2: -1, 5: +1 }, declared: null },
  { name: "间弦调", rule: { 3: -1, 5: +1 }, declared: null },
  { name: "无媒调", rule: { 3: -1, 6: -1 }, declared: null },
  { name: "碧玉调", rule: { 1: -1, 3: +1, 4: -1, 6: -1 }, declared: null },
  { name: "玉女调", rule: { 1: -1, 3: -1 }, declared: null },
  // 与源站标注矛盾的那条，单独列出以便复现（已知矛盾，不计为失败）
  { name: "侧商调", rule: { 3: -1, 4: -1, 6: -1 }, declared: "D", knownMismatch: true },
  // 反证用：慢商/无射若「（全）」按半音读——两条都无宫可容
  { name: "慢商调(半音读)", rule: { 2: -1 }, declared: "C", expectFail: true },
  { name: "无射调(半音读)", rule: { 1: -1, 5: +1 }, declared: "B♭", expectFail: true },
];

/** 从正调出发施加紧慢规则，得到七弦音高。 */
function openPitchClasses(rule) {
  return ZHENG_DIAO.map((pc, i) => (pc + (rule[i + 1] ?? 0) + 12) % 12);
}

/** 枚举所有「能把七弦全部装进清乐七声」的候选宫音。 */
function candidateRoots(pitchClasses) {
  return Array.from({ length: 12 }, (_, root) => root).filter((root) =>
    pitchClasses.every((pc) => QING_YUE.some((step) => (root + step) % 12 === pc)),
  );
}

const EXPECTED_SELF_PROVEN = ["正调", "蕤宾调", "慢角调", "清商调", "慢商调", "无射调", "商调", "慢宫调"];

let failures = 0;
const proved = [];

for (const { name, rule, declared, expectFail, knownMismatch } of CASES) {
  const pcs = openPitchClasses(rule);
  const roots = candidateRoots(pcs);
  const names = roots.map((r) => NOTE_NAMES[r]);
  const matched = declared !== null && names.includes(declared);

  let verdict;
  if (expectFail) {
    verdict = matched ? "⚠️ 反证失效（半音读竟然也能解释）" : "（反证成立：无宫可容）";
    if (matched) failures += 1;
  } else if (declared === null) {
    verdict = names.length === 0 ? "（无宫可容）" : "（源站未标，判据不唯一）";
  } else if (matched) {
    verdict = "✅ 自证";
    proved.push(name);
  } else if (knownMismatch) {
    verdict = `⚠️ 与标注 ${declared} 矛盾（已知，见文档 17.5 ①(b)）`;
  } else {
    verdict = `❌ 不含标注的 ${declared}`;
    failures += 1;
  }

  console.log(
    `${name.padEnd(14)} 音=${pcs.map((p) => NOTE_NAMES[p]).join(" ").padEnd(28)}` +
      `候选宫=${(names.join("/") || "—").padEnd(22)} 标注=${String(declared ?? "—").padEnd(3)} ${verdict}`,
  );
}

const missing = EXPECTED_SELF_PROVEN.filter((n) => !proved.includes(n));
if (missing.length > 0) {
  console.log(`\n✗ 应自证却未通过：${missing.join("、")}`);
  failures += 1;
}

console.log(`\n自证通过 ${proved.length} 条：${proved.join(" · ")}`);
console.log(failures === 0 ? "✓ 结论与文档 17.5 ① 一致" : `✗ ${failures} 处与文档不一致`);
process.exit(failures === 0 ? 0 : 1);
