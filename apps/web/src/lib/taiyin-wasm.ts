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
  get_jianzi_dictionary(input_json: string): string;
  analyze_jianzi_frequency(input_json: string): string;
  get_jianzi_variant_groups(): string;
  encode_jianzi_batch(input_json: string): string;
  decode_jianzi_batch(input_json: string): string;
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
      // 默认导出是 __wbg_init，接受可选的 path/URL 参数。
      // 不传参时用 import.meta.url + 'taiyin_core_bg.wasm'，打包后 chunk URL 解析会错，
      // 所以显式传 public/ 下的静态路径。
      // 但必须给**绝对**路径：写相对的 "wasm/taiyin_core_bg.wasm" 时，
      // 页面地址是 /taiyin-guqin（无尾斜杠）会解析成 /wasm/... → 404，
      // 只有地址恰好带尾斜杠（生产的 GitHub Pages）才碰巧对。
      const wasmUrl = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/wasm/taiyin_core_bg.wasm`;
      await (mod.default as (path: string) => Promise<unknown>)(wasmUrl);
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

/**
 * 减字字典（字全表）：向 Rust 端查询经筛选 / 搜索后的减字目录。
 *
 * 字典数据、筛选与搜索逻辑全部在 Rust（`jianzi_dictionary` 模块），
 * 这里只负责调用 wasm 并把返回的状态补上 `rhythmMode: null` 以贴合前端 `JianziState`。
 */
export async function getJianziDictionary(
  filter: import("./jianzi-dictionary-types").DictFilter,
): Promise<{
  total: number;
  entries: import("./jianzi-dictionary-types").JianziDictEntry[];
}> {
  const wasm = await getWasm();
  const raw = wasm.get_jianzi_dictionary(JSON.stringify(filter));
  const parsed = JSON.parse(raw) as {
    total: number;
    entries: Array<{
      id: string;
      state: Omit<
        import("./types").JianziState,
        "rhythmMode"
      > & { rhythmMode?: null };
      note?: string;
      common?: boolean;
      code: string;
      searchText: string;
    }>;
  };
  return {
    total: parsed.total,
    entries: parsed.entries.map((e) => ({
      id: e.id,
      state: { ...e.state, rhythmMode: null },
      note: e.note,
      common: e.common,
      code: e.code,
      searchText: e.searchText,
    })),
  };
}

/**
 * 批量编减字码（如 `ad9g4`）——导出文本谱、按码检索都靠它。
 *
 * 编码在 Rust（`jianzi_code`），与前端连打文法同一张码表；
 * 不完整的减字返回 `null`，不让整份导出失败。
 */
export async function encodeJianziBatch(
  notes: import("./types").JianziState[],
): Promise<(string | null)[]> {
  const wasm = await getWasm();
  const payload = {
    notes: notes.map((n) => ({
      toneType: n.toneType ?? "散",
      leftFinger: n.leftFinger,
      hui: n.hui,
      fen: n.fen,
      slide: n.slide,
      rightAction: n.rightAction,
      stringNumber: n.stringNumber,
    })),
  };
  const parsed = JSON.parse(wasm.encode_jianzi_batch(JSON.stringify(payload))) as {
    codes?: (string | null)[];
    error?: string;
  };
  if (parsed.error) throw new Error(parsed.error);
  return parsed.codes ?? [];
}

/**
 * 批量解减字码：把整段粘回来的文本收回成减字。
 *
 * 切词（滤掉简谱数字、小节线、标题里的中文）与解码都在 Rust `jianzi_code`，
 * 前端只拿结果去建音符列。坏码一条只坏一条，不连坐——
 * 返回 `entries` 里每条都带 `code`，失败的那条另有 `error` 说明原因。
 */
export async function decodeJianziBatch(
  text: string,
): Promise<import("./jianzi-dictionary-types").DecodeBatchResult> {
  const wasm = await getWasm();
  const parsed = JSON.parse(wasm.decode_jianzi_batch(JSON.stringify({ text }))) as {
    error?: string;
    total?: number;
    ok?: number;
    failed?: number;
    entries?: Array<{
      code: string;
      state: Omit<import("./types").JianziState, "rhythmMode"> | null;
      error: string | null;
      duration: import("./types").Duration | null;
      dotted: boolean;
      isRest: boolean;
    }>;
  };
  if (parsed.error) throw new Error(parsed.error);
  return {
    total: parsed.total ?? 0,
    ok: parsed.ok ?? 0,
    failed: parsed.failed ?? 0,
    entries: (parsed.entries ?? []).map((e) => ({
      code: e.code,
      state: e.state ? { ...e.state, rhythmMode: null } : null,
      error: e.error ?? null,
      duration: e.duration ?? null,
      dotted: Boolean(e.dotted),
      isRest: Boolean(e.isRest),
    })),
  };
}

/**
 * 减字字频统计：给一首曲谱的减字，向 Rust 端要「每个字母出现几次、占比多少」。
 * 归一化（名/夕、食/亻、省写→全字）在 Rust 端完成，因此同一个字的不同写法
 * 会合并为同一行；原始写法回列在 `leftVariants` / `actionVariants`。
 */
export async function analyzeJianziFrequency(
  notes: import("./types").JianziState[],
): Promise<import("./jianzi-dictionary-types").FreqResult> {
  const wasm = await getWasm();
  const payload = {
    notes: notes
      .filter((n) => n.toneType != null)
      .map((n) => ({
        toneType: n.toneType,
        leftFinger: n.leftFinger,
        hui: n.hui,
        fen: n.fen,
        slide: n.slide,
        rightAction: n.rightAction,
        stringNumber: n.stringNumber,
      })),
  };
  const parsed = JSON.parse(wasm.analyze_jianzi_frequency(JSON.stringify(payload))) as {
    error?: string;
  } & import("./jianzi-dictionary-types").FreqResult;
  if (parsed.error) throw new Error(parsed.error);
  return { total: parsed.total, rows: parsed.rows };
}

/** 减字写法变体对照表（勾/勹、挑/乚、名/夕…），由 Rust `get_jianzi_variant_groups` 提供。 */
export async function getJianziVariantGroups(): Promise<
  import("./jianzi-dictionary-types").VariantGroup[]
> {
  const wasm = await getWasm();
  return JSON.parse(wasm.get_jianzi_variant_groups()) as import("./jianzi-dictionary-types").VariantGroup[];
}
