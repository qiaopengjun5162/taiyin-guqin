/**
 * 真实 WASM 产物契约验证（不经过 mock）。
 *
 * 用法：node scripts/verify-wasm.mjs
 * 前置：just build-wasm（生成 apps/web/wasm/）
 *
 * 校验：
 * 1. 单音翻译返回非空候选，枚举序列化与前端映射表兼容
 * 2. 序列翻译接受 {notes, tuning} 对象形式
 * 3. tuning 参数确实改变候选（蕤宾调五弦散音为 4）
 * 4. 指法编排：候选与选中项同源、活动量齐全、时值真的进到代价表
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(here, "../apps/web/wasm");

const mod = await import(join(wasmDir, "taiyin_core.js"));
const wasmBytes = readFileSync(join(wasmDir, "taiyin_core_bg.wasm"));
await mod.default({ module_or_path: wasmBytes });

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1. 单音：5（中央组）应至少有一个候选，且 note_type 可序列化为已知值
const single = JSON.parse(
  mod.translate_jianpu_to_jianzi(JSON.stringify({ number: 5, octave: 0 })),
);
check("single: candidates non-empty", single.candidates?.length > 0);
const noteTypes = new Set(single.candidates.map((c) => c.note.note_type));
check(
  "single: note_type values",
  [...noteTypes].every((t) => ["SanYin", "FanYin", "AnYin", "散", "泛", "按"].includes(t)),
  [...noteTypes].join(","),
);
const rightActions = new Set(single.candidates.map((c) => c.note.right_action));
console.log(`info note_type=${[...noteTypes]} right_action=${[...rightActions]}`);

// 2. 序列：{notes, tuning} 对象形式
const seq = JSON.parse(
  mod.translate_jianpu_sequence_to_jianzi(
    JSON.stringify({ notes: [{ number: 5, octave: 0 }, { number: 6, octave: 0 }], tuning: "zheng" }),
  ),
);
check("sequence: two candidate lists", seq.candidates_per_note?.length === 2);

// 2b. 全局指法编排：候选与选中项出自同一次计算，选中的恒排首位
const arranged = JSON.parse(
  mod.arrange_jianpu_sequence_to_jianzi(
    JSON.stringify({
      notes: [
        { number: 5, octave: 0 },
        { number: 6, octave: 0 },
        { number: 1, octave: 1 },
        { number: 2, octave: 1 },
        { number: 3, octave: 1 },
      ],
      tuning: "zheng",
    }),
  ),
);
check(
  "arrange: one candidate list per note",
  arranged.candidates_per_note?.length === 5,
  `len=${arranged.candidates_per_note?.length}`,
);
check(
  "arrange: one selection per note",
  arranged.selections?.length === 5,
  `len=${arranged.selections?.length}`,
);
check(
  "arrange: every note has a pick",
  arranged.selections?.every((s) => typeof s === "number"),
  JSON.stringify(arranged.selections),
);
check(
  "arrange: selection points at the head of its list",
  arranged.candidates_per_note?.every((cands, i) => {
    const sel = arranged.selections[i];
    return cands.length > 0 && (sel === 0 || sel === null);
  }),
);
check("arrange: total cost present", typeof arranged.total_cost === "number");

// 活动量：界面要靠它把「省了几次换弦」说成琴人能懂的话
check(
  "arrange: stats present",
  typeof arranged.stats?.string_changes === "number" &&
    typeof arranged.stats?.finger_shifts === "number" &&
    typeof arranged.stats?.technique_switches === "number",
  JSON.stringify(arranged.stats),
);
check(
  "arrange: greedy_stats present",
  typeof arranged.greedy_stats?.string_changes === "number" &&
    typeof arranged.greedy_stats?.finger_shifts === "number",
  JSON.stringify(arranged.greedy_stats),
);
check(
  "arrange: identical flag is boolean",
  typeof arranged.identical_to_greedy === "boolean",
);

// 急处换手：界面「快句里少 N 次换手」这句话的唯一来源
check(
  "arrange: rushed_moves present",
  typeof arranged.stats?.rushed_moves === "number" &&
    typeof arranged.greedy_stats?.rushed_moves === "number",
  JSON.stringify(arranged.stats),
);

// 时值必须真的走进代价表。
//
// 同一段音高，全按十六分（2 单位）算与全按全音符（32 单位）算，
// 倍率不同 —— 总代价不可能一样。这条同时挡住两种静默故障：
// wasm 没重编（还在跑旧产物）、duration_units 在 JSON 边界上被丢掉。
const pitches = [
  { number: 5, octave: 0 },
  { number: 6, octave: 0 },
  { number: 1, octave: 1 },
  { number: 2, octave: 1 },
  { number: 3, octave: 1 },
];
const costWith = (units) =>
  JSON.parse(
    mod.arrange_jianpu_sequence_to_jianzi(
      JSON.stringify({
        notes: pitches.map((p) => ({ ...p, duration_units: units })),
        tuning: "zheng",
      }),
    ),
  ).total_cost;
const fastCost = costWith(2);
const slowCost = costWith(32);
check(
  "arrange: duration_units reaches the cost model",
  typeof fastCost === "number" &&
    typeof slowCost === "number" &&
    fastCost !== slowCost,
  `fast=${fastCost} slow=${slowCost}`,
);

// 不给时值必须与「全四分」等价：老调用方（只传音高）的结果不许悄悄变
const noUnits = costWith(undefined);
const quarters = costWith(8);
check(
  "arrange: unspecified duration == quarter notes",
  noUnits === quarters,
  `none=${noUnits} quarter=${quarters}`,
);

// 时值要真的**改变落点**，而不只是改一个数字。
//
// 用一段含 4（清角）、7（变宫）与高八度的旋律：这些音没有散音可用，
// 必须落指，于是「贴着走」还是「四处游走」才有得选。
// 八分连奏时手来不及动，编排应该把落点收拢；二分音符之后则可以放开。
// 这条失败通常意味着两件事之一：代价表里时值又被忽略了，
// 或者阈值调得让倍率不再影响任何选择——两种都该回来看一眼。
const articulate = [
  [4, 1], [7, 1], [4, 2], [7, 2], [1, 2], [3, 2],
  [4, 1], [3, 1], [2, 1], [4, 1], [7, 0], [6, 0],
];
const picksWith = (units) =>
  JSON.parse(
    mod.arrange_jianpu_sequence_to_jianzi(
      JSON.stringify({
        notes: articulate.map(([number, octave]) => ({
          number,
          octave,
          duration_units: units,
        })),
        tuning: "zheng",
      }),
    ),
  ).candidates_per_note.map((c) => `${c[0].note.note_type}${c[0].note.string_number}`);

const fastPicks = picksWith(4);
const slowPicks = picksWith(32);
check(
  "arrange: tempo actually changes the fingering",
  fastPicks.some((pick, i) => pick !== slowPicks[i]),
  `八分与二分的落点完全一样：${fastPicks.join(",")}`,
);
// 换弦次数不可能超过相邻音对数（5 个音最多 4 次）
check(
  "arrange: string_changes within bounds",
  arranged.stats.string_changes <= 4 && arranged.greedy_stats.string_changes <= 4,
  `${arranged.stats.string_changes}/${arranged.greedy_stats.string_changes}`,
);
console.log(
  `info arrange stats=${JSON.stringify(arranged.stats)} greedy=${JSON.stringify(
    arranged.greedy_stats,
  )} identical=${arranged.identical_to_greedy}`,
);

// 同音反复不该换弦横跳——这条能挡住「wasm 没重编、还在跑旧产物」
const repeated = JSON.parse(
  mod.arrange_jianpu_sequence_to_jianzi(
    JSON.stringify({
      notes: Array.from({ length: 4 }, () => ({ number: 5, octave: 0 })),
    }),
  ),
);
const repeatedStrings = repeated.candidates_per_note.map(
  (c) => c[0].note.string_number,
);
check(
  "arrange: repeated note stays on one string",
  repeatedStrings.every((s) => s === repeatedStrings[0]),
  repeatedStrings.join(","),
);
// 同音反复时逐音挑选本来就选对了，界面不该硬夸「已优化」
check(
  "arrange: repeated note reports identical to greedy",
  repeated.identical_to_greedy === true,
  `identical=${repeated.identical_to_greedy}`,
);

// 3. 蕤宾调：4 应出现五弦散音候选；正调则没有
const ruibin = JSON.parse(
  mod.translate_jianpu_to_jianzi(JSON.stringify({ number: 4, octave: 1, tuning: "ruibin" })),
);
check(
  "ruibin: open string 5 candidate for 4",
  ruibin.candidates.some((c) => c.note.string_number === 5 && c.note.note_type === "散"),
);
const zheng4 = JSON.parse(
  mod.translate_jianpu_to_jianzi(JSON.stringify({ number: 4, octave: 1 })),
);
check(
  "zheng: no open string 5 candidate for 4",
  !zheng4.candidates.some((c) => c.note.string_number === 5 && c.note.note_type === "散"),
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

// 4. 减字字典（字全表）：返回 total/entries，且筛选生效
const dictAll = JSON.parse(mod.get_jianzi_dictionary("{}"));
check("dict: total = 50", dictAll.total === 50, `total=${dictAll.total}`);
check("dict: returns 50 entries", dictAll.entries?.length === 50);
const entry0 = dictAll.entries[0];
check(
  "dict: entry has id/state/searchText",
  typeof entry0?.id === "string" &&
    typeof entry0?.state?.toneType === "string" &&
    typeof entry0?.searchText === "string",
);
const dictSan = JSON.parse(mod.get_jianzi_dictionary(JSON.stringify({ tone: "散" })));
check("dict: tone filter (散) returns 8", dictSan.entries?.length === 8, `len=${dictSan.entries?.length}`);
const dictQuery = JSON.parse(mod.get_jianzi_dictionary(JSON.stringify({ query: "泛音" })));
check("dict: query 泛音 returns 8", dictQuery.entries?.length === 8, `len=${dictQuery.entries?.length}`);

// 5. 减字字频 / 变体归并：名/夕、勾/勹 应合并为同一个减字
const freq = JSON.parse(
  mod.analyze_jianzi_frequency(
    JSON.stringify({
      notes: [
        { toneType: "按", leftFinger: "名", hui: "九", fen: null, slide: null, rightAction: "勾", stringNumber: "四" },
        { toneType: "按", leftFinger: "夕", hui: "九", fen: null, slide: null, rightAction: "勹", stringNumber: "四" },
        { toneType: "散", leftFinger: null, hui: null, fen: null, slide: null, rightAction: "挑", stringNumber: "三" },
      ],
    }),
  ),
);
check("freq: total = 3", freq.total === 3, `total=${freq.total}`);
check("freq: 名/夕 + 勾/勹 merged into 2 rows", freq.rows?.length === 2, `rows=${freq.rows?.length}`);
const merged = freq.rows?.find((r) => r.id === "名九勾四");
check("freq: merged row 名九勾四 count = 2", merged?.count === 2, `count=${merged?.count}`);
check(
  "freq: variant forms recorded (left 名/夕, action 勾/勹)",
  merged?.leftVariants?.length === 2 && merged?.actionVariants?.length === 2,
);
check("freq: ratio ~ 2/3", merged && Math.abs(merged.ratio - 2 / 3) < 1e-6, `ratio=${merged?.ratio}`);

// 6. 变体对照表
const variantGroups = JSON.parse(mod.get_jianzi_variant_groups());
check("variants: groups non-empty", Array.isArray(variantGroups) && variantGroups.length >= 6);
check(
  "variants: 勾 group contains 勹",
  variantGroups.some((g) => g.canonical === "勾" && g.variants.includes("勹")),
);

// 7. 减字编码：字典条目带码，码可批量生成，且编码规则与连打文法一致
check(
  "code: dict entry carries code",
  typeof entry0?.code === "string" && entry0.code.length > 0,
  `code=${entry0?.code}`,
);
const codedSan = dictAll.entries.find((e) => e.state.toneType === "散" && e.state.rightAction === "勾");
check("code: 散勾三 = sg3", codedSan?.code === "sg3", `code=${codedSan?.code}`);
const codedAn = dictAll.entries.find(
  (e) => e.state.toneType === "按" && e.state.leftFinger === "大" && e.state.hui === "九" &&
         e.state.rightAction === "勾" && e.state.stringNumber === "四",
);
check("code: 大九勾四 = ad9g4", codedAn?.code === "ad9g4", `code=${codedAn?.code}`);

const batch = JSON.parse(
  mod.encode_jianzi_batch(
    JSON.stringify({
      notes: [
        { toneType: "散", leftFinger: null, hui: null, fen: null, slide: null, rightAction: "勾", stringNumber: "三" },
        { toneType: "按", leftFinger: "夕", hui: "十", fen: "六分", slide: "注", rightAction: "挑", stringNumber: "六" },
        { toneType: "泛", leftFinger: "大", hui: "七", fen: null, slide: null, rightAction: "抹", stringNumber: "二" },
        { toneType: "按", leftFinger: "大", hui: null, fen: null, slide: null, rightAction: "勾", stringNumber: "四" },
      ],
    }),
  ),
);
check("code: batch returns one code per note", batch.codes?.length === 4, `len=${batch.codes?.length}`);
check("code: batch[0] = sg3", batch.codes?.[0] === "sg3", `got=${batch.codes?.[0]}`);
check("code: batch[1] normalizes 夕→m and 注→z = am10f6zt6", batch.codes?.[1] === "am10f6zt6", `got=${batch.codes?.[1]}`);
check("code: batch[2] = fd7m2", batch.codes?.[2] === "fd7m2", `got=${batch.codes?.[2]}`);
check("code: incomplete note yields null", batch.codes?.[3] === null, `got=${batch.codes?.[3]}`);

// 8. 减字解码：把整段粘回来的文本收回成减字（导出 → 再导入的闭环）
const pasted = "# 花非花\n定弦：正调 · 1=F\n1·  |  2   |\nad9g4 | sg3 - st5\n共 3 音";
const decoded = JSON.parse(mod.decode_jianzi_batch(JSON.stringify({ text: pasted })));
check(
  "decode: noise filtered, 3 codes parsed",
  decoded.total === 3 && decoded.ok === 3 && decoded.failed === 0,
  `total=${decoded.total} ok=${decoded.ok}`,
);
const d0 = decoded.entries?.[0]?.state;
check(
  "decode: ad9g4 → 按 · 大 · 九 · 勾 · 四",
  d0?.toneType === "按" && d0?.leftFinger === "大" && d0?.hui === "九" &&
    d0?.rightAction === "勾" && d0?.stringNumber === "四",
  JSON.stringify(d0),
);
check("decode: sg3 → 散音", decoded.entries?.[1]?.state?.toneType === "散");
check(
  "decode: st5 → 挑五弦",
  decoded.entries?.[2]?.state?.rightAction === "挑" && decoded.entries?.[2]?.state?.stringNumber === "五",
);

const badDecode = JSON.parse(mod.decode_jianzi_batch(JSON.stringify({ text: "ad9g4 d9g4" })));
check(
  "decode: 坏码单条失败、好码照常",
  badDecode.ok === 1 && badDecode.failed === 1 && typeof badDecode.entries?.[1]?.error === "string",
  `ok=${badDecode.ok} failed=${badDecode.failed}`,
);
check("decode: 坏码不带 state", badDecode.entries?.[1]?.state == null);

// 编 → 粘回 → 解：三条码必须回到同一批减字
const roundText = batch.codes.slice(0, 3).join(" ");
const roundTrip = JSON.parse(mod.decode_jianzi_batch(JSON.stringify({ text: roundText })));
check(
  "decode: encode → paste → decode roundtrip",
  roundTrip.ok === 3 &&
    roundTrip.entries[1].state.leftFinger === "名" &&
    roundTrip.entries[1].state.slide === "注" &&
    roundTrip.entries[2].state.toneType === "泛",
  JSON.stringify(roundTrip.entries?.map((e) => e.state)),
);

// 9. 时值随码走：`:1/:2/:4/:8/:16` + 附点 + 休止符 r
// 这张表必须与 apps/web/src/lib/score-export.ts 的 DURATION_CODE 一致。
const rhythm = JSON.parse(
  mod.decode_jianzi_batch(
    JSON.stringify({ text: "ad9g4:1 sg3:2 st5:4 am7f6cm2:8 fd9g4:16." }),
  ),
);
check(
  "rhythm: 1/2/4/8/16 mapped to 全/二分/四分/八分/十六分",
  rhythm.entries.map((e) => e.duration).join(",") === "全,二分,四分,八分,十六分",
  rhythm.entries.map((e) => e.duration).join(","),
);
check("rhythm: 附点只在标了的条目上", rhythm.entries[4].dotted === true && rhythm.entries[0].dotted === false);

const rest = JSON.parse(mod.decode_jianzi_batch(JSON.stringify({ text: "r:2 sg3" })));
check("rhythm: 休止符 r:2 算成功且带时值", rest.ok === 2 && rest.entries[0].isRest === true && rest.entries[0].duration === "二分");
check(
  "rhythm: 没写时值时为 null（前端退回四分）",
  rest.entries[1].duration === null && rest.entries[1].isRest === false,
  `duration=${rest.entries[1].duration}`,
);

const badRhythm = JSON.parse(mod.decode_jianzi_batch(JSON.stringify({ text: "ad9g4:5" })));
check(
  "rhythm: 认不出的时值报错而不是当四分",
  badRhythm.failed === 1 && /时值/.test(badRhythm.entries[0].error ?? ""),
  badRhythm.entries[0].error,
);



if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall wasm contract checks passed");
