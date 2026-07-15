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
console.log("\nall wasm contract checks passed");
