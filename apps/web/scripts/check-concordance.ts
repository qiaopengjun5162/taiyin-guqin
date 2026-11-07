/**
 * 谱例溯源的本地校验（jiti 跑真源码）。
 *
 * 为什么不用 vitest：这台机器上 vitest 起不来 worker（`Timeout waiting for worker`），
 * 而 `src/lib/__tests__/score-concordance.test.ts` 只能在 CI 里跑。
 * 本地要立刻知道「改坏了没有」，就走这个脚本——它和那个测试文件覆盖同一批行为，
 * 谁改了规则，两边都要动。
 *
 * 用法：npx jiti scripts/check-concordance.ts
 */

import {
  jianziSignature,
  findConcordance,
  countScores,
} from "../src/lib/score-concordance";
import type { JianziState, NoteColumn } from "../src/lib/types";
import type { ConcordanceScore } from "../src/lib/score-concordance";

let failed = 0;
let passed = 0;

function ok(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}`);
  if (detail !== undefined) console.error(`     实际：${JSON.stringify(detail)}`);
}

function eq(label: string, actual: unknown, expected: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(label, same, same ? undefined : { actual, expected });
}

function state(partial: Partial<JianziState>): JianziState {
  return {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: null,
    stringNumber: null,
    ...partial,
  };
}

const AN = state({
  toneType: "按",
  leftFinger: "大",
  hui: "九",
  fen: "六分",
  rightAction: "勹",
  stringNumber: "四",
});

function note(jianzi: JianziState): NoteColumn {
  return {
    id: `n${Math.random().toString(36).slice(2)}`,
    jianpuNumber: "1",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi,
  };
}

function score(
  id: string,
  title: string,
  notes: NoteColumn[],
  phrases: Array<{ start: number; end: number }> = [],
): ConcordanceScore {
  return { id, title, source: "示例", notes, phrases };
}

console.log("jianziSignature");
eq("完整按音", jianziSignature(AN), "按|大指|九|六分|-|勾|四");
eq("忽略弦号", jianziSignature(AN, { ignoreString: true }), "按|大指|九|六分|-|勾");
eq("偏旁与全字同键", jianziSignature({ ...AN, rightAction: "勾" }), jianziSignature(AN));
eq("劈与尸同键", jianziSignature({ ...AN, rightAction: "劈" }), jianziSignature({ ...AN, rightAction: "尸" }));
eq("左手全字同键", jianziSignature({ ...AN, leftFinger: "大指" }), jianziSignature(AN));
eq("缺音色不给键", jianziSignature(state({ rightAction: "勹" })), null);
eq("缺右手指法不给键", jianziSignature(state({ toneType: "按" })), null);
eq("节奏模式不进键", jianziSignature({ ...AN, rhythmMode: "散" }), jianziSignature(AN));
ok("走手音进键", jianziSignature({ ...AN, slide: "绰" }) !== jianziSignature(AN));

console.log("findConcordance");
const twoPhrases = findConcordance(AN, [
  score("s1", "良宵引", [note(AN), note(AN), note(AN)], [
    { start: 0, end: 1 },
    { start: 2, end: 2 },
  ]),
]);
eq("命中数", twoPhrases.length, 3);
eq("句号", twoPhrases.map((h) => h.phraseIndex), [0, 0, 1]);
ok("全部 exact", twoPhrases.every((h) => h.kind === "exact"));

const noPhrase = findConcordance(AN, [score("s1", "良宵引", [note(AN)])]);
eq("没切句时为 null", noPhrase[0]?.phraseIndex, null);

const mixed = findConcordance(AN, [
  score("s1", "甲", [note({ ...AN, stringNumber: "二" }), note(AN)]),
]);
eq("严匹配优先且不混入宽匹配", mixed.length, 1);
eq("命中的是原弦那一处", mixed[0]?.index, 1);

const looseOnly = findConcordance(AN, [score("s1", "甲", [note({ ...AN, stringNumber: "二" })])]);
eq("退到宽匹配", looseOnly[0]?.kind, "loose");

const noString = findConcordance({ ...AN, stringNumber: null }, [
  score("s1", "甲", [note({ ...AN, stringNumber: "二" })]),
]);
eq("弦号未选走宽匹配", noString[0]?.kind, "loose");

eq("半截字不查", findConcordance(state({ toneType: "按" }), [score("s1", "甲", [note(AN)])]), []);
eq("空曲库", findConcordance(AN, []), []);
eq("limit 截断", findConcordance(AN, [score("s1", "甲", Array.from({ length: 10 }, () => note(AN)))], { limit: 3 }).length, 3);

const crossScore = findConcordance(AN, [
  score("s1", "甲", [note(AN), note(AN)]),
  score("s2", "乙", [note(AN)]),
]);
eq("跨曲谱命中", crossScore.length, 3);
eq("曲谱计数", countScores(crossScore), 2);

console.log(`\n${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;
