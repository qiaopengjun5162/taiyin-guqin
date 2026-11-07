// 传统谱字文本解析的体检 / 闸门。
//
// 为什么需要它：`parseJianziText` 有三条分支（散 / 泛 / 按），三条的入口条件不同，
// 曾经各自维护一份右手指法表。散音那份只有单指法，于是谱本里常见的「散勾剔二」
// 只吃掉一个「勾」，剩下「剔二」对不上，最后返回一个**缺弦序的半残对象**；
// 而识别面板是按「非 null 即成功」统计的，就把它算成了解析成功——
// 到播放时才因为没弦序静默不出声。这类错误没有任何现有测试盯着。
//
// 用法：cd apps/web && npx jiti scripts/check-parse.ts
//   退出码 1 = 有样例与预期不符（正例解析失败 / 负例意外成功 / 字段不对）。
//
// 注意：本模型的按音与泛音**同形**（泛音字也带左手指法，见 jianzi.test.ts 的「泛 名十勾三」），
// 所以「泛七勾二」这种不带左手的写法本来就该失败，不要当成 bug。

import { createEmptyState, jianziToText, parseJianziText } from "../src/lib/jianzi";
import type { JianziState } from "../src/lib/types";
import { leftFingerInfo, rightActionInfo } from "../src/lib/jianzi-explain";

type Case = {
  text: string;
  /** false = 预期解析失败（缺部件 / 顺序不合法）。 */
  expect: boolean;
  /** 解析成功时顺带核对的字段。 */
  check?: Record<string, string | null>;
  note?: string;
};

const CASES: Case[] = [
  // ── 散音：单指法 ──
  { text: "散勾三", expect: true, check: { rightAction: "勾", stringNumber: "三" } },
  { text: "散挑七", expect: true, check: { rightAction: "挑", stringNumber: "七" } },
  { text: "散木四", expect: true, check: { rightAction: "木" }, note: "偏旁写法" },

  // ── 散音：复合指法（本次修复点） ──
  { text: "散勾剔二", expect: true, check: { rightAction: "勾剔", stringNumber: "二" } },
  { text: "散抹挑一", expect: true, check: { rightAction: "抹挑", stringNumber: "一" } },
  { text: "散打摘四", expect: true, check: { rightAction: "打摘", stringNumber: "四" } },

  // ── 散音：缺弦序必须判失败（曾经返回半残对象） ──
  { text: "散勾", expect: false, note: "没有弦序" },
  { text: "散", expect: false, note: "只有音色前缀" },

  // ── 按音：复合指法、两位数徽位、分、走手音两个位置 ──
  { text: "大九勾剔四", expect: true, check: { rightAction: "勾剔", stringNumber: "四" } },
  { text: "大十一徽三分勾四", expect: true, check: { hui: "十一", fen: "三分" } },
  { text: "大十徽三分勾四", expect: true, check: { hui: "十", fen: "三分" } },
  { text: "大九六勾四", expect: true, check: { hui: "九", fen: "六分" }, note: "分数位只写数字" },
  { text: "大九绰六勾四", expect: true, check: { slide: "绰", fen: "六分" }, note: "口语序：走手音在分前" },
  { text: "大九六绰勾四", expect: true, check: { slide: "绰", fen: "六分" }, note: "字体序：走手音在分后" },
  { text: "大七半勾二", expect: true, check: { fen: "半" } },

  // ── 泛音：与按音同形，带左手指法 ──
  { text: "泛名十勾三", expect: true, check: { toneType: "泛", leftFinger: "名", hui: "十" } },
  { text: "泛大十三挑一", expect: true, check: { toneType: "泛", hui: "十三" } },
  { text: "泛七勾二", expect: false, note: "缺左手指法：本模型泛音与按音同形" },

  // ── 跪指 ──
  { text: "跪五四勾三", expect: true, check: { leftFinger: "跪", hui: "五", fen: "四分" } },
];

let failures = 0;

for (const { text, expect, check, note } of CASES) {
  const state = parseJianziText(text);
  const ok = expect ? state !== null : state === null;

  let detail = "";
  if (ok && expect && check) {
    for (const [field, want] of Object.entries(check)) {
      const got = (state as unknown as Record<string, string | null>)[field];
      if (got !== want) {
        detail = `（${field} 期望 ${want}，实得 ${got}）`;
        break;
      }
    }
  }
  const pass = ok && detail === "";

  if (!pass) failures += 1;
  const desc = state === null ? "解析失败" : `${state.rightAction} ${state.stringNumber ?? "缺弦"}`;
  console.log(`${pass ? "✓" : "✗"} ${text.padEnd(16)} ${desc.padEnd(12)} ${note ?? ""}${detail}`);
}

// ── 往返：键盘能造出的每一种字，序列化成文本后必须能被自己读回来 ──
//
// 这条不变量比任何单例都重要：键盘的指法表（DEFAULT_KEYBOARD.rightActions）里
// 有 勾剔/抹挑/抹勾/打摘，所以「散勾剔二」是产品真的会写出来的字。
// 序列化出去、解析不回来 = 用户复制这段文本给琴友，对方看到的是半截。
const ROUNDTRIP: JianziState[] = [
  { ...createEmptyState(), toneType: "散", rightAction: "勾剔", stringNumber: "二" },
  { ...createEmptyState(), toneType: "散", rightAction: "抹挑", stringNumber: "一" },
  { ...createEmptyState(), toneType: "散", rightAction: "勹", stringNumber: "三" },
  {
    ...createEmptyState(),
    toneType: "按",
    leftFinger: "大",
    hui: "十一",
    fen: "三分",
    slide: "绰",
    rightAction: "勾剔",
    stringNumber: "四",
  },
  {
    ...createEmptyState(),
    toneType: "泛",
    leftFinger: "名",
    hui: "十",
    rightAction: "挑",
    stringNumber: "一",
  },
];

let roundtripFailures = 0;
for (const state of ROUNDTRIP) {
  const text = jianziToText(state);
  const back = parseJianziText(text);
  const fields = [
    "toneType",
    "leftFinger",
    "hui",
    "fen",
    "slide",
    "rightAction",
    "stringNumber",
  ] as const;
  // 状态存的是偏旁（勹），文本存的是全字（勾）：序列化时按字形表换过写法，
  // 所以比较前要先归一，否则「散勹三」会被误判成不一致。
  const norm = (v: JianziState): Record<(typeof fields)[number], string | null> => ({
    toneType: v.toneType,
    leftFinger: leftFingerInfo(v.leftFinger)?.name ?? v.leftFinger,
    hui: v.hui,
    fen: v.fen,
    slide: v.slide,
    rightAction: rightActionInfo(v.rightAction)?.name ?? v.rightAction,
    stringNumber: v.stringNumber,
  });
  const diff = back
    ? fields.filter((f) => norm(back)[f] !== norm(state)[f])
    : fields;
  const pass = back !== null && diff.length === 0;
  if (!pass) roundtripFailures += 1;
  console.log(
    `${pass ? "✓" : "✗"} 往返 ${text.padEnd(14)} ` +
      (back === null ? "解析不回来" : diff.length ? `字段不一致：${diff.join(",")}` : ""),
  );
}

console.log(`\n往返 ${ROUNDTRIP.length} 例，不一致 ${roundtripFailures} 例`);
failures += roundtripFailures;
console.log(`\n文本样例 ${CASES.length} 例；合计不符合预期 ${failures} 例`);
process.exit(failures === 0 ? 0 : 1);
