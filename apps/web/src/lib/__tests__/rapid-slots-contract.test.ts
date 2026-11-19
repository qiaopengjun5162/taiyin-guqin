/**
 * @vitest-environment jsdom
 *
 * 连打码表契约：Rust（WASM）与前端静态回退表必须一致。
 *
 * 迁移前这里有两份完整码表（`jianzi_code.rs` 与 `jianzi-rapid.ts`），
 * 注释靠人记着「三处增删必须一起改」——那种约束迟早会破。
 * 现在真值只有 Rust 一份，TS 里剩下的 `RAPID_SLOTS_BY_TONE` 只是
 * 「WASM 未就绪时的回退」。本测试保证回退表不会悄悄与真值分家。
 *
 * 这是**跨语言契约**，不是功能测试：功能由 `jianzi-rapid.test.ts` 覆盖。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RAPID_SLOTS_BY_TONE, getRapidSlots } from "../jianzi-rapid";

beforeAll(async () => {
  const bytes = readFileSync(
    resolve(__dirname, "../../../wasm/taiyin_core_bg.wasm"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("taiyin_core_bg.wasm")) {
        return new Response(bytes, {
          status: 200,
          headers: { "Content-Type": "application/wasm" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const { initWasmSync } = await import("../taiyin-wasm");
  await initWasmSync();
});

describe("连打槽位表 · Rust 与前端回退一致", () => {
  it("三种音色的槽位顺序逐一相同", () => {
    const fromRust = getRapidSlots();
    for (const tone of ["散", "泛", "按"] as const) {
      expect(fromRust[tone], `${tone} 的槽位顺序`).toEqual(
        RAPID_SLOTS_BY_TONE[tone],
      );
    }
  });

  it("散音没有走手音槽——空弦滑不动", () => {
    expect(getRapidSlots()["散"]).not.toContain("slide");
  });

  it("只有按音有走手音槽", () => {
    const slots = getRapidSlots();
    expect(slots["按"]).toContain("slide");
    expect(slots["泛"]).not.toContain("slide");
  });

  it("回退表与真值都覆盖且只覆盖三种音色", () => {
    expect(Object.keys(getRapidSlots()).sort()).toEqual(["散", "按", "泛"].sort());
    expect(Object.keys(RAPID_SLOTS_BY_TONE).sort()).toEqual(["散", "按", "泛"].sort());
  });
});
