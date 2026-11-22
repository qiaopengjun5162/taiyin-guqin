/**
 * taiyin-core WASM 桥接 —— 动态加载封装。
 *
 * WASM 模块需要在客户端动态加载（Next.js SSR 下不可用）。
 * 所有函数接收和返回 JSON 字符串，通过 serde 序列化桥接。
 * 首次调用时自动初始化，后续复用缓存实例。
 *
 * S2（2026-11-16）：初始化成功后，wasm-bindgen glue 的 9 个导出本身就是同步的。
 * 因此这里在保留原 async API（兼容既有调用方与测试）之外，另给 9 个 `...Sync`
 * 同步 getter：只要初始化就绪，渲染与事件都能直接同步调用，不需要 await。
 * 同步预加载走 `initSync({ module })`（真实产物）并回退到原 `default(url)`，
 * 由 `WasmBootstrap` 在客户端挂载时触发；两条路径共用同一个 instance 单例。
 */

"use client";

import { useEffect, useState } from "react";

/**
 * WASM 模块的导出签名 —— **从 wasm-pack 生成的声明派生，不再手抄一份**。
 *
 * 这里原本是手写 26 个函数的 `interface`，注释还写着「重新构建 WASM 后需手动同步」。
 * 那是个沉默故障源：Rust 侧改掉一个导出名，TS 这份抄件照旧编译通过，
 * 要等真跑到那一步才炸——和「端点只在路由层测过」是同一类问题。
 *
 * 现在直接取 `apps/web/wasm/taiyin_core.d.ts`（wasm-pack 每次构建都会重写它），
 * 只 `Omit` 掉 glue 自带的两个初始化入口（本文件自己封装成 async / sync 两条路径）。
 * Rust 少导一个、改个名，`tsc` 立刻红，不需要任何人记得去同步。
 */
type WasmModule = Omit<
  typeof import("@/wasm/taiyin_core"),
  "default" | "initSync"
>;

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
 * 同步取已初始化的 WASM 实例。
 *
 * 未就绪时直接抛错，不在这里隐式初始化——那会把 await 偷偷带进渲染路径，
 * 正是 S2 要避免的。调用方要么等 `initWasm()` / `initWasmSync()`，
 * 要么先用 `isWasmReady()` 走 TS 降级。
 */
export function getWasmSync(): WasmModule {
  if (!instance) {
    throw new Error("WASM 尚未初始化：请等待 initWasm() 或挂载 WasmBootstrap");
  }
  return instance;
}

/** WASM 是否已就绪；同步调用方据此决定是否走降级。 */
export function isWasmReady(): boolean {
  return instance !== null;
}

/**
 * S2 同步预加载：fetch → WebAssembly.compile → initSync({ module })。
 *
 * 与 `initWasm()` 共用 instance 与 loadPromise，谁先成功谁占用，避免重复初始化 glue。
 * 失败不把状态钉死在 error：原 async 路径仍可接手，界面不该因为预加载失败卡住。
 * SSR 下直接返回（模块顶层不能碰 fetch / WebAssembly）。
 */
export async function initWasmSync(): Promise<void> {
  if (instance) return;
  if (typeof window === "undefined") return;
  if (loadPromise) {
    await loadPromise;
    return;
  }

  setState("loading", null);
  loadPromise = (async () => {
    try {
      const mod = await import("@/wasm/taiyin_core");
      const wasmUrl = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/wasm/taiyin_core_bg.wasm`;
      // Vitest 的模块 mock 是 Proxy：访问未声明的导出会抛错而非返回 undefined。
      // 真实 glue 有 initSync，测试替身没有，所以这里必须安全探测。
      let initSync:
        | ((arg: { module: WebAssembly.Module }) => void)
        | undefined;
      try {
        initSync = (
          mod as unknown as {
            initSync?: (arg: { module: WebAssembly.Module }) => void;
          }
        ).initSync;
      } catch {
        initSync = undefined;
      }

      if (typeof initSync === "function") {
        const response = await fetch(wasmUrl);
        if (!response.ok) {
          throw new Error(`WASM 加载失败: ${response.status}`);
        }
        const bytes = await response.arrayBuffer();
        initSync({ module: await WebAssembly.compile(bytes) });
      } else {
        // 测试替身或旧 glue 没有 initSync：沿用原异步初始化，效果相同。
        await (mod.default as (path: string) => Promise<unknown>)(wasmUrl);
      }

      instance = mod as unknown as WasmModule;
      setState("ready", null);
    } catch {
      // 预加载失败不致命：async 路径仍可用，回到 idle 让它接手。
      setState("idle", null);
    } finally {
      loadPromise = null;
    }
  })();

  await loadPromise;
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

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function translateJianpuToJianziSync(input: string): string {
  return getWasmSync().translate_jianpu_to_jianzi(input);
}

export async function translateJianpuSequenceToJianzi(
  input: string,
): Promise<string> {
  const wasm = await getWasm();
  return wasm.translate_jianpu_sequence_to_jianzi(input);
}

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function translateJianpuSequenceToJianziSync(input: string): string {
  return getWasmSync().translate_jianpu_sequence_to_jianzi(input);
}

/**
 * 按时值切句 —— 谱面上画「第 N 句」、按句循环慢练都问这一处。
 *
 * 入参是每个音的时值，单位 1/8 拍（四分 = 8、二分 = 16），`null` 表示这个音
 * 没给时值。**阈值不在这里**：判据（两拍及以上算气口）只在 Rust 有一份，
 * 前端抄一份就会各自漂——谱面分成 5 句、编排按 4 句算，用户点「第 3 句」
 * 练到的却是别处，而且没有任何地方会报错。
 *
 * 返回闭区间，下标取自入参。
 */
function parsePhrases(rawText: string): { start: number; end: number }[] {
  const raw = JSON.parse(rawText) as {
    phrases?: { start: number; end: number }[];
    error?: string;
  };
  if (raw.error) throw new Error(raw.error);
  return raw.phrases ?? [];
}

export async function splitPhrases(
  units: (number | null)[],
): Promise<{ start: number; end: number }[]> {
  const wasm = await getWasm();
  return parsePhrases(wasm.split_phrases_to_json(JSON.stringify({ units })));
}

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function splitPhrasesSync(
  units: (number | null)[],
): { start: number; end: number }[] {
  return parsePhrases(
    getWasmSync().split_phrases_to_json(JSON.stringify({ units })),
  );
}

/** 一条指法路径的活动量——界面用它把「编排省了什么」说成人话。 */
export interface PathStats {
  /** 换弦次数。 */
  string_changes: number;
  /** 同指挪位次数（同一根手指跨徽，整只手要动）。 */
  finger_shifts: number;
  /** 散 / 泛 / 按 之间的切换次数。 */
  technique_switches: number;
  /**
   * 「赶不上的换手」次数：前一个音是八分或更短，手却要换弦或挪位。
   *
   * 比单纯数换弦更贴近弹琴时的抱怨：换三次弦落在二分音符之间叫从容，
   * 落在十六分连奏里叫弹不出来。
   */
  rushed_moves: number;
  /**
   * 最长的一串连续散音有几个音（没有散音时为 0）。
   *
   * 连着四五个散音听着就是一路空弦「干敲」：每根弦音色不同，音与音之间
   * 也没有走手相连。编排会把这串散音断开一处改走泛音，这个数就是
   * 「最长一串散音从 7 个缩到 4 个」的来源。
   */
  longest_open_run: number;
}

/**
 * 一个乐句的编排结果。
 *
 * `start` / `end` 是**传给 Rust 的那个数组**的下标（含两端）。调用方把休止符
 * 滤掉再送进去，就要自己换算回带休止符的行号——这里不猜：猜错一步，
 * 界面上标句的分隔线就会整体错位一行。
 */
export interface PhraseSpan {
  /** 第几句（0 起）。 */
  index: number;
  /** 起始音下标（含）。 */
  start: number;
  /** 结束音下标（含）。 */
  end: number;
  /** 这一句有几个音（含排不出落点的音——它仍占谱面一行）。 */
  note_count: number;
  /** 这一句内部的活动量（跨气口的那次转移不算进任何一句）。 */
  stats: PathStats;
}

/** 全局指法编排结果。候选与选中项出自同一次计算，索引天然对齐。 */
export interface JianpuArrangement {
  /** 每个音的候选减字（被选中的那一个恒排首位）。 */
  candidates_per_note: import("./generated/taiyin").JianziCandidate[][];
  /** 每个音选中的候选下标；该音无合法落点时为 null。 */
  selections: (number | null)[];
  /** 整句总代价，越小越顺。 */
  total_cost: number;
  /** 编排结果的活动量。 */
  stats: PathStats;
  /** 同一段简谱逐音取第一名时的活动量，作为对照。 */
  greedy_stats: PathStats;
  /** 编排结果与逐音挑选是否完全一样（此时不该夸「已优化」）。 */
  identical_to_greedy: boolean;
  /**
   * 按气口切出来的乐句，逐句报账。
   *
   * 短曲只有一句（整段就是一句），此时界面不必画分隔线；
   * 旧版 wasm 没有这个字段，补成空数组——界面按「没分句」处理，不是报错。
   */
  phrases: PhraseSpan[];
}

const EMPTY_STATS: PathStats = {
  string_changes: 0,
  finger_shifts: 0,
  technique_switches: 0,
  rushed_moves: 0,
  longest_open_run: 0,
};

/**
 * 补齐缺失字段。
 *
 * wasm 产物在浏览器里是带缓存的：用户可能拿到「有编排、没有 rushed_moves」的旧文件。
 * 少一个字段就让 `greedy - stats` 变成 NaN，文案会静默退化成一串空话——
 * 补 0 至少还是「这项没省」这个诚实的答案。
 */
function normalizeStats(stats: Partial<PathStats> | undefined): PathStats {
  return { ...EMPTY_STATS, ...stats };
}

/**
 * 整段简谱的全局指法编排（Rust 端 Viterbi 动态规划）。
 *
 * 逐音贪心只看前一个音，容易在第一音就锁死一个孤立但舒服的落点，
 * 后面每个音都在补偿；编排把整句当路径求全局最优，整句更少换把、更少跨弦。
 * 算法在 Rust（`jianpu::arrange_sequence`），这里只做 JSON 桥接。
 *
 * `duration_units` 是这个音占多少「1/8 拍」（四分 = 8）。Rust 端用它判断
 * 手有没有时间换把：八分连八分里的换把按 1.5 倍计费，二分音符之后的按 0.6 倍。
 * 不给的话一律按四分音符处理，与加这个参数之前的结果完全一致。
 */
function parseArrangement(rawText: string): JianpuArrangement {
  const raw = JSON.parse(rawText) as Partial<JianpuArrangement> & {
    error?: string;
  };
  if (raw.error) throw new Error(raw.error);
  return {
    candidates_per_note: raw.candidates_per_note ?? [],
    selections: raw.selections ?? [],
    total_cost: raw.total_cost ?? 0,
    stats: normalizeStats(raw.stats),
    greedy_stats: normalizeStats(raw.greedy_stats),
    identical_to_greedy: Boolean(raw.identical_to_greedy),
    // 旧 wasm 没有这个字段：空数组表示「没分句」，界面不该因此报错，
    // 也不该假装有一句（那样会画一条没有意义的「第 1 句」分隔线）。
    phrases: (raw.phrases ?? []).map((p, i) => ({
      index: p.index ?? i,
      start: p.start ?? 0,
      end: p.end ?? 0,
      note_count: p.note_count ?? 0,
      stats: normalizeStats(p.stats),
    })),
  };
}

export async function arrangeJianpuSequence(
  notes: { number: number; octave: number; duration_units?: number }[],
  tuning: string,
): Promise<JianpuArrangement> {
  const wasm = await getWasm();
  return parseArrangement(
    wasm.arrange_jianpu_sequence_to_jianzi(JSON.stringify({ notes, tuning })),
  );
}

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function arrangeJianpuSequenceSync(
  notes: { number: number; octave: number; duration_units?: number }[],
  tuning: string,
): JianpuArrangement {
  return parseArrangement(
    getWasmSync().arrange_jianpu_sequence_to_jianzi(
      JSON.stringify({ notes, tuning }),
    ),
  );
}

/**
 * 调核心的文案接口，统一处理「这段话说不出」的情况。
 *
 * 措辞与排序口径都在核心 `crates/taiyin-core/src/describe.rs` 一份——
 * 网页、小程序、App 必须说同一句话，两处各写一套只会让用户怀疑自己记错了。
 *
 * 三种说不出话的情况**都从这一个出口降级成空串**，不抛错、不猜：
 *
 * 1. 引擎未就绪（SSR / 首屏渲染）——`getWasmSync()` 会抛；
 * 2. 用户浏览器缓存着**旧** wasm 产物、glue 上没有这个导出——调用即 TypeError；
 * 3. 核心返回 `{"error":…}`（载荷拼错了）——不把 JSON 摊到界面上。
 *
 * 不另加 `isWasmReady()` 早退：那只是同一件事的第二层，删掉任一层行为都不变，
 * 反而让「到底哪一层在兜底」说不清。调试时把 catch 里的 return 换成 throw 即可。
 */
function callDescribe(
  name: "describe_phrases" | "describe_arrangement",
  payload: unknown,
): string {
  try {
    const out = getWasmSync()[name](JSON.stringify(payload));
    return out && !out.includes('"error"') ? out : "";
  } catch {
    return "";
  }
}

/**
 * 分句那一句人话。只有一句（或旧 wasm 没给）时返回空串——
 * 短曲上标「第 1 句」纯属噪声，用户还会以为按钮坏了。
 *
 * 排序只看**一个**指标：快句里赶不上的换手次数。它决定「这一句能不能弹下来」，
 * 换弦次数只是它的粗略代理。这些判断连同措辞都已搬进核心，这里只做桥接。
 */
export function describePhrases(phrases: PhraseSpan[]): string {
  return callDescribe("describe_phrases", { phrases });
}

/**
 * 把编排结果说成一句人话。
 *
 * 只说琴人能直接感觉到的五件事，且**只说真的减少了的**；指标变多时也要说出来。
 * 措辞在核心 `describe.rs`，这里只把文案真正用到的四个字段发过去：
 * 候选列表与落点索引在长曲里是几百个对象，文案一个都不看——裁掉之后
 * 载荷从几十 KB 降到几百字节。
 */
export function describeArrangement(result: JianpuArrangement): string {
  const { stats, greedy_stats, identical_to_greedy, phrases } = result;
  return callDescribe("describe_arrangement", {
    stats,
    greedy_stats,
    identical_to_greedy,
    phrases,
  });
}

/**
 * 减字字典（字全表）：向 Rust 端查询经筛选 / 搜索后的减字目录。
 *
 * 字典数据、筛选与搜索逻辑全部在 Rust（`jianzi_dictionary` 模块），
 * 这里只负责调用 wasm 并把返回的状态补上 `rhythmMode: null` 以贴合前端 `JianziState`。
 */
function parseDictionary(rawText: string): {
  total: number;
  entries: import("./jianzi-dictionary-types").JianziDictEntry[];
} {
  const parsed = JSON.parse(rawText) as {
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

export async function getJianziDictionary(
  filter: import("./jianzi-dictionary-types").DictFilter,
): Promise<{
  total: number;
  entries: import("./jianzi-dictionary-types").JianziDictEntry[];
}> {
  const wasm = await getWasm();
  return parseDictionary(wasm.get_jianzi_dictionary(JSON.stringify(filter)));
}

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function getJianziDictionarySync(
  filter: import("./jianzi-dictionary-types").DictFilter,
): {
  total: number;
  entries: import("./jianzi-dictionary-types").JianziDictEntry[];
} {
  return parseDictionary(
    getWasmSync().get_jianzi_dictionary(JSON.stringify(filter)),
  );
}

/**
 * 批量编减字码（如 `ad9g4`）——导出文本谱、按码检索都靠它。
 *
 * 编码在 Rust（`jianzi_code`），与前端连打文法同一张码表；
 * 不完整的减字返回 `null`，不让整份导出失败。
 */
function encodePayload(notes: import("./types").JianziState[]) {
  return {
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
}

function parseCodes(rawText: string): (string | null)[] {
  const parsed = JSON.parse(rawText) as {
    codes?: (string | null)[];
    error?: string;
  };
  if (parsed.error) throw new Error(parsed.error);
  return parsed.codes ?? [];
}

export async function encodeJianziBatch(
  notes: import("./types").JianziState[],
): Promise<(string | null)[]> {
  const wasm = await getWasm();
  return parseCodes(
    wasm.encode_jianzi_batch(JSON.stringify(encodePayload(notes))),
  );
}

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function encodeJianziBatchSync(
  notes: import("./types").JianziState[],
): (string | null)[] {
  return parseCodes(
    getWasmSync().encode_jianzi_batch(JSON.stringify(encodePayload(notes))),
  );
}

/**
 * 批量解减字码：把整段粘回来的文本收回成减字。
 *
 * 切词（滤掉简谱数字、小节线、标题里的中文）与解码都在 Rust `jianzi_code`，
 * 前端只拿结果去建音符列。坏码一条只坏一条，不连坐——
 * 返回 `entries` 里每条都带 `code`，失败的那条另有 `error` 说明原因。
 */
function parseDecodeBatch(
  rawText: string,
): import("./jianzi-dictionary-types").DecodeBatchResult {
  const parsed = JSON.parse(rawText) as {
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

export async function decodeJianziBatch(
  text: string,
): Promise<import("./jianzi-dictionary-types").DecodeBatchResult> {
  const wasm = await getWasm();
  return parseDecodeBatch(wasm.decode_jianzi_batch(JSON.stringify({ text })));
}

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function decodeJianziBatchSync(
  text: string,
): import("./jianzi-dictionary-types").DecodeBatchResult {
  return parseDecodeBatch(
    getWasmSync().decode_jianzi_batch(JSON.stringify({ text })),
  );
}

/**
 * 减字字频统计：给一首曲谱的减字，向 Rust 端要「每个字母出现几次、占比多少」。
 * 归一化（名/夕、食/亻、省写→全字）在 Rust 端完成，因此同一个字的不同写法
 * 会合并为同一行；原始写法回列在 `leftVariants` / `actionVariants`。
 */
function frequencyPayload(notes: import("./types").JianziState[]) {
  return {
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
}

function parseFrequency(
  rawText: string,
): import("./jianzi-dictionary-types").FreqResult {
  const parsed = JSON.parse(rawText) as {
    error?: string;
  } & import("./jianzi-dictionary-types").FreqResult;
  if (parsed.error) throw new Error(parsed.error);
  return { total: parsed.total, rows: parsed.rows };
}

export async function analyzeJianziFrequency(
  notes: import("./types").JianziState[],
): Promise<import("./jianzi-dictionary-types").FreqResult> {
  const wasm = await getWasm();
  return parseFrequency(
    wasm.analyze_jianzi_frequency(JSON.stringify(frequencyPayload(notes))),
  );
}

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function analyzeJianziFrequencySync(
  notes: import("./types").JianziState[],
): import("./jianzi-dictionary-types").FreqResult {
  return parseFrequency(
    getWasmSync().analyze_jianzi_frequency(
      JSON.stringify(frequencyPayload(notes)),
    ),
  );
}

/** 减字写法变体对照表（勾/勹、挑/乚、名/夕…），由 Rust `get_jianzi_variant_groups` 提供。 */
export async function getJianziVariantGroups(): Promise<
  import("./jianzi-dictionary-types").VariantGroup[]
> {
  const wasm = await getWasm();
  return JSON.parse(wasm.get_jianzi_variant_groups()) as import("./jianzi-dictionary-types").VariantGroup[];
}

/** 同步版：仅初始化就绪后可用，输出与 async 版逐字节一致。 */
export function getJianziVariantGroupsSync(): import("./jianzi-dictionary-types").VariantGroup[] {
  return JSON.parse(
    getWasmSync().get_jianzi_variant_groups(),
  ) as import("./jianzi-dictionary-types").VariantGroup[];
}
