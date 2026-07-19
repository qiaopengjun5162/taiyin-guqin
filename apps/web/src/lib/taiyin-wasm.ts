/**
 * taiyin-core WASM 桥接 —— 动态加载封装。
 *
 * WASM 模块需要在客户端动态加载（Next.js SSR 下不可用）。
 * 所有函数接收和返回 JSON 字符串，通过 serde 序列化桥接。
 * 首次调用时自动初始化，后续复用缓存实例。
 */

"use client";

import { useEffect, useState } from "react";

// NOTE: 保持类型定义与 wasm/Cargo.toml 中 wasm.rs 的导出签名一致。
// 重新构建 WASM 后需手动同步类型。

interface WasmModule {
  translate_jianpu_to_jianzi(input_json: string): string;
  translate_jianpu_sequence_to_jianzi(input_json: string): string;
}

export type WasmLoadState = "idle" | "loading" | "ready" | "error";

let instance: WasmModule | null = null;
let loadState: WasmLoadState = "idle";
let loadError: Error | null = null;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: WasmLoadState, error: Error | null = null) {
  loadState = next;
  loadError = error;
  listeners.forEach((fn) => fn());
}

export function getWasmLoadState(): WasmLoadState {
  return loadState;
}

export function getWasmLoadError(): Error | null {
  return loadError;
}

/**
 * 主动触发 WASM 初始化。幂等：已加载或加载中时不重复执行。
 * 失败时状态置为 error，并抛出错误供调用方处理。
 */
export async function initWasm(): Promise<void> {
  if (loadState === "ready") return;
  if (loadPromise) {
    await loadPromise;
    return;
  }

  setState("loading", null);

  loadPromise = (async () => {
    try {
      // 动态导入 JS glue 代码（通过 @/wasm/ 别名解析到 wasm/taiyin_core.js）
      const mod = await import("@/wasm/taiyin_core");
      // 默认导出是 __wbg_init，接受可选的 path/URL 参数
      // 不传参时默认使用 import.meta.url + 'taiyin_core_bg.wasm'，
      // 但在 Next.js 打包后 import.meta.url 指向 chunk URL，路径解析会错误。
      // 因此显式传入通过 public/ 静态服务的 .wasm 文件 URL。
      // __wbg_init accepts { module_or_path: ... } | InitInput | Promise<InitInput>
      await (mod.default as (path: string) => Promise<unknown>)(
        "wasm/taiyin_core_bg.wasm",
      );
      instance = mod as unknown as WasmModule;
      setState("ready", null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState("error", error);
      throw error;
    } finally {
      loadPromise = null;
    }
  })();

  await loadPromise;
}

async function getWasm(): Promise<WasmModule> {
  if (instance) return instance;
  await initWasm();
  if (!instance) {
    throw new Error("WASM 模块未成功初始化");
  }
  return instance;
}

/**
 * React hook：订阅 WASM 加载状态。
 * 组件挂载时会自动尝试初始化。
 */
export function useWasmInit(): { state: WasmLoadState; error: Error | null } {
  const [state, setState] = useState<WasmLoadState>(loadState);
  const [error, setError] = useState<Error | null>(loadError);

  useEffect(() => {
    const update = () => {
      setState(loadState);
      setError(loadError);
    };
    update();
    listeners.add(update);
    initWasm().catch(() => {
      // 错误已通过 setState 传播
    });
    return () => {
      listeners.delete(update);
    };
  }, []);

  return { state, error };
}

// ── 导出函数（客户端可用） ──

export async function translateJianpuToJianzi(input: string): Promise<string> {
  const wasm = await getWasm();
  return wasm.translate_jianpu_to_jianzi(input);
}

export async function translateJianpuSequenceToJianzi(
  input: string,
): Promise<string> {
  const wasm = await getWasm();
  return wasm.translate_jianpu_sequence_to_jianzi(input);
}
