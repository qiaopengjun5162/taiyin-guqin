/**
 * 测试用的真实 WASM 装载器。
 *
 * ## 为什么需要
 *
 * 越来越多领域逻辑迁进了 Rust（连打解析、联袂、简谱解析、**音高推算**），
 * 前端只剩薄壳调 WASM。这些薄壳在引擎未就绪时一律返回空值——
 * 于是任何依赖它们的测试都会「突然」失败，原因却不在被测组件本身。
 *
 * 在测试里把 `fetch` 指向仓库里的 `.wasm` 产物、再 `initWasmSync()`，
 * 就能让薄壳跑真实逻辑。比给每个模块写替身可靠：替身要和 Rust 保持同步，
 * 而真实产物不会撒谎。
 *
 * ## 用法
 *
 * ```ts
 * import { loadRealWasm } from "@/lib/__tests__/load-wasm";
 * beforeAll(loadRealWasm);
 * ```
 *
 * 只对**依赖领域逻辑**的测试需要。纯 UI 组件（按钮文案、布局）不必装。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initWasmSync } from "@/lib/taiyin-wasm";

/**
 * 让后续的 WASM 调用走真实产物。
 *
 * 幂等：`initWasmSync` 内部已缓存实例，多个测试文件各自调用不会重复编译。
 *
 * ⚠ 路径必须用**别名** `@/lib/taiyin-wasm`，不能写相对路径 `../taiyin-wasm`。
 * vitest 会把「别名解析」和「相对路径解析」当成两个不同模块，各自持有一份
 * 模块级单例——于是这里初始化成功，测试文件那边仍报 `isWasmReady() === false`。
 * （2026-11-18 实测：midi-export 算出 48 而非 45，debug 打出来 ready: false。）
 */
export async function loadRealWasm(): Promise<void> {
  /*
   * node 环境的测试（`@vitest-environment node`）里没有 `window`，
   * 而 `initWasmSync()` 开头有一句 `if (typeof window === "undefined") return;`
   * ——那是 SSR 的正确保护（服务端渲染时不能碰 WebAssembly/fetch），
   * 但会让 node 下的测试**静默不初始化**：beforeAll 不报错，之后每次调用
   * 都拿到 null，症状是「音高算成 48 而不是 45」这种莫名其妙的数字。
   *
   * 测试里补一个最小 `window` 桩即可——它只用来通过那句类型检查，
   * 真实逻辑（fetch + WebAssembly.compile）在 node 里本来就跑得通。
   */
  if (typeof (globalThis as { window?: unknown }).window === "undefined") {
    (globalThis as { window?: unknown }).window = globalThis;
  }

  // `__dirname` 在 vitest 里指向本文件所在目录（src/lib/__tests__）
  const wasmPath = resolve(__dirname, "../../../wasm/taiyin_core_bg.wasm");
  const bytes = readFileSync(wasmPath);

  // 只拦我们自己的 wasm：其它 fetch（组件里若有）保持原样
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("taiyin_core_bg.wasm")) {
      return new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "application/wasm" },
      });
    }
    if (typeof original === "function") return original(input, init);
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  await initWasmSync();
}
