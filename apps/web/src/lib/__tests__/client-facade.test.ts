/**
 * 门面层（`@/lib/client`）的公开面守卫。
 *
 * ## 为什么这条测试值得存在
 *
 * `lib/client/index.ts` 是纯 re-export，没有任何可执行逻辑——但它**就是**约束本身：
 * 组件只许通过这一层接触绑定层。`client-boundary.test.ts` 守的是一头
 * （「组件别绕过去直连」），这里守另一头（「门面承诺过的名字还在」）。
 *
 * 少了这一头会出现这种情况：整理门面时顺手删掉一个 re-export，
 * 静态扫描照样全绿（组件确实只 import 了门面），`tsc` 也只在**恰好用到它**的
 * 组件上报错；用不到就一路安静。而这个文件在覆盖率报表里长期 0%，
 * 连「有没有被加载过」都没人知道。
 *
 * 断言方向是**子集**而不是全等：新增导出是自由，删掉承诺过的才该红。
 * 也不逐项列全（后端面故意做成 `api` 命名空间，就是为了不维护巨清单）。
 */
import { describe, it, expect } from "vitest";
import * as facade from "@/lib/client";

/** 每个功能块各取一两个代表，缺任何一块都说明门面被拆漏了。 */
const PROMISED = [
  // 引擎可用性
  "getWasmLoadState",
  "getWasmLoadError",
  "isWasmReady",
  "useWasmInit",
  // 同步 getter（S2）
  "translateJianpuToJianziSync",
  "arrangeJianpuSequenceSync",
  "splitPhrasesSync",
  // 减字编解码
  "encodeJianziBatchSync",
  "decodeJianziBatchSync",
  // 简谱 ↔ 减字
  "translateJianpuToJianzi",
  "describeArrangement",
  // 字典 / 联袂 / 连打
  "getJianziDictionary",
  "normalizeLianmei",
  "lianmeiRelation",
  "parseRapidInput",
  "getRapidSlots",
  // 断网降级
  "isBackendUnreachable",
  "localCreateScore",
] as const;

describe("@/lib/client · 公开面", () => {
  it("承诺过的函数都还在，且都是可调用的", () => {
    const missing = PROMISED.filter((name) => typeof facade[name] !== "function");
    expect(missing).toEqual([]);
  });

  it("后端能力以命名空间暴露（不是逐项 re-export）", () => {
    // 逐项列会变成一份要人肉维护的清单，后端加个函数就漏同步。
    expect(typeof facade.api).toBe("object");
    expect(facade.api).not.toBeNull();
  });

  it("门面不是空壳（模块真被加载了）", () => {
    // 没有这条，第一条在「模块整体没加载」时也可能空真：PROMISED 全 undefined 才红，
    // 但真出问题的方式往往是 import 直接抛错，那时第一条根本执行不到。
    expect(Object.keys(facade).length).toBeGreaterThan(PROMISED.length);
    expect(typeof facade.getWasmLoadState()).toBe("string");
  });
});
