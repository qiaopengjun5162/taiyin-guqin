/**
 * `isComplete` 的跨语言真值表（真实 WASM 产物，不用替身）。
 *
 * ## 为什么需要这条闸门
 *
 * 「一个减字算不算填完了」这条判断，两侧各有一份实现：
 * - 前端 `apps/web/src/lib/jianzi.ts::isComplete` —— 渲染路径上每帧要问好几次，
 *   走 WASM 往返不划算，故意留在 TS（理由见该文件头「留在前端的部分」）。
 * - Rust `crates/taiyin-core/src/jianzi_text.rs::is_complete` —— 供
 *   `jianzi_code::encode` / `jianzi_dictionary` 用，改码表与字典时都靠它把关。
 *
 * 两份实现本身没问题，问题是**没有任何东西证明它们一致**：改了 Rust 的必需部件、
 * 或前端漏了一个音色分支，两边测试各自全绿，用户却会看到「界面说能入谱、
 * 后端编不出码」。这正是本项目反复踩过的「验证真空带」。
 *
 * ## 为什么不用替身、也不导出一条 `is_complete`
 *
 * 替身要和 Rust 保持同步，而真实产物不会撒谎。也不必为此新增 WASM 导出：
 * `encode` 的第一句就是 `if !is_complete(state) { return Err }`，
 * 「编不出码」就是「不完整」的**可观测后果**——用现成的 `encode_jianzi_batch`
 * 驱动，验的是用户真正会遇到的那条链路，而不是一个内部谓词。
 *
 * ## 覆盖范围
 *
 * 判断只取决于 5 个字段有没有值，所以不必跑全部组合（那会是几万条）：
 * 3 个合法音色 + 2 个越界音色 × 4 个字段的 16 种有无 = 80 条，等价于全真值表。
 * 越界音色（`""` / `"花"`）是故意放的：Rust 用 `match` 兜 `_ => false`，
 * 前端过去写的是 `toneType !== null && …`——脏数据一进来两边就反着答。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadRealWasm } from "@/lib/__tests__/load-wasm";
import { encodeJianziBatchSync } from "@/lib/taiyin-wasm";
import { isComplete, createEmptyState } from "@/lib/jianzi";
import type { JianziState } from "@/lib/types";

beforeAll(loadRealWasm);

/** 四个「有没有」字段，以及填进去用的合法值（散音会忽略左手三项）。 */
const PARTS = [
  ["leftFinger", "大"],
  ["hui", "九"],
  ["rightAction", "勾"],
  ["stringNumber", "三"],
] as const;

/** 合法音色 + 两个越界值。越界值在前端只可能来自脏 JSON，但必须与 Rust 同答。 */
const TONES = ["散", "泛", "按", "", "花"] as const;

function build(tone: string, mask: number): JianziState {
  const state: JianziState = {
    ...createEmptyState(),
    toneType: tone as JianziState["toneType"],
  };
  PARTS.forEach(([field, value], i) => {
    if (mask & (1 << i)) {
      // 逐字段赋值：字段名与取值都是一一对应的字面量，动态键只能走断言
      (state as unknown as Record<string, string | null>)[field] = value;
    }
  });
  return state;
}

/** 「Rust 认为完整」= 编得出码。 */
function rustSaysComplete(states: JianziState[]): boolean[] {
  return encodeJianziBatchSync(states).map((code) => code !== null);
}

function label(state: JianziState): string {
  const present = PARTS.filter(([field]) => (state as unknown as Record<string, unknown>)[field] !== null)
    .map(([field]) => field)
    .join("+");
  return `音色「${state.toneType ?? "null"}」有 ${present || "（无）"}`;
}

describe("isComplete · 前端判断与 Rust 编码结果逐条对齐", () => {
  const cases: JianziState[] = [];
  for (const tone of TONES) {
    for (let mask = 0; mask < 1 << PARTS.length; mask += 1) {
      cases.push(build(tone, mask));
    }
  }

  it("80 条真值表全部一致", () => {
    const rust = rustSaysComplete(cases);
    const mismatched = cases.filter((state, i) => isComplete(state) !== rust[i]).map(label);

    expect(rust).toHaveLength(cases.length);
    expect(mismatched).toEqual([]);
  });

  it("真值表不是一边倒（防止断言在空集上碰巧通过）", () => {
    const rust = rustSaysComplete(cases);
    expect(rust.filter(Boolean).length).toBeGreaterThan(0);
    expect(rust.filter((v) => !v).length).toBeGreaterThan(0);
  });

  it("合法音色的「最少必需部件」与注释里写的一致", () => {
    // 散：右手指法 + 弦序（左手三项有没有都不影响）
    const sanBare = build("散", 0b1100);
    expect(isComplete(sanBare)).toBe(true);
    expect(rustSaysComplete([sanBare])[0]).toBe(true);
    // 泛 / 按：少任何一个都编不出码
    for (const tone of ["泛", "按"]) {
      const full = build(tone, 0b1111);
      expect(isComplete(full)).toBe(true);
      PARTS.forEach((_, i) => {
        const missing = build(tone, 0b1111 & ~(1 << i));
        expect(isComplete(missing), `${tone} 缺第 ${i} 个部件`).toBe(false);
      });
      expect(rustSaysComplete([full])[0]).toBe(true);
    }
  });

  it("空状态不完整（此时 toneType 为 null，Rust 侧根本没有这个输入）", () => {
    // encode 的入参 tone_type 是 String，不存在「没选音色」的表示法，
    // 所以 null 这一格由前端单独负责——不在这张真值表里，但必须为 false。
    expect(isComplete(createEmptyState())).toBe(false);
  });

  it("装饰记号不影响完整性：三个音色带上走手音都照样能编码", () => {
    for (const tone of ["散", "泛", "按"]) {
      for (const slide of ["绰", "注", "急", "吟"] as const) {
        const state: JianziState = { ...build(tone, 0b1111), slide };
        expect(isComplete(state), `${tone}+${slide}`).toBe(true);
        expect(rustSaysComplete([state])[0], `${tone}+${slide}`).toBe(true);
      }
    }
  });
});
