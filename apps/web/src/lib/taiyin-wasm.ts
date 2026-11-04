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
  arrange_jianpu_sequence_to_jianzi(input_json: string): string;
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
export async function arrangeJianpuSequence(
  notes: { number: number; octave: number; duration_units?: number }[],
  tuning: string,
): Promise<JianpuArrangement> {
  const wasm = await getWasm();
  const raw = JSON.parse(
    wasm.arrange_jianpu_sequence_to_jianzi(JSON.stringify({ notes, tuning })),
  ) as Partial<JianpuArrangement> & { error?: string };
  if (raw.error) throw new Error(raw.error);
  return {
    candidates_per_note: raw.candidates_per_note ?? [],
    selections: raw.selections ?? [],
    total_cost: raw.total_cost ?? 0,
    stats: normalizeStats(raw.stats),
    greedy_stats: normalizeStats(raw.greedy_stats),
    identical_to_greedy: Boolean(raw.identical_to_greedy),
  };
}

/**
 * 把编排结果说成一句人话。
 *
 * 只说琴人能直接感觉到的五件事（快句换手 / 散音连缀 / 换弦 / 音色切换 / 挪手），
 * 并且**只说真的减少了的**：编排换了落点但移动次数没变时，不该编一句「已优化」来邀功；
 * 本来就最顺的时候，更应该直说「这条已经是最顺的」——否则用户下次不信这个按钮。
 *
 * 反过来，如果有指标**变多**了，也要说出来。全局编排在长音之后允许手多走一趟，
 * 换来的是快句里不再换手——这个取舍是对的，但用户盯着列表数换弦次数时会发现对不上，
 * 不说就成了另一种撒谎。
 */
export function describeArrangement(result: JianpuArrangement): string {
  if (result.identical_to_greedy) {
    return "这条已经是最顺的走法，逐音挑选和整句编排选的是同一个";
  }

  const parts: string[] = [];
  const rushedSaved =
    result.greedy_stats.rushed_moves - result.stats.rushed_moves;
  const stringSaved =
    result.greedy_stats.string_changes - result.stats.string_changes;
  const toneSaved =
    result.greedy_stats.technique_switches - result.stats.technique_switches;
  const shiftSaved =
    result.greedy_stats.finger_shifts - result.stats.finger_shifts;
  const openRunBefore = result.greedy_stats.longest_open_run;
  const openRunAfter = result.stats.longest_open_run;

  // 急处换手排最前：它是「弹得动 / 弹不动」的分界线，换弦次数只是它的粗略代理
  if (rushedSaved > 0) parts.push(`快句里少 ${rushedSaved} 次换手`);
  // 散音连缀紧跟其后：它说的不是手好不好动，而是这一句听起来连不连。
  // 一串空弦弹下来音高没错，但没有走手相连，这是排谱的人最容易被忽略的毛病。
  if (openRunBefore > openRunAfter) {
    parts.push(`最长一串散音从 ${openRunBefore} 个缩到 ${openRunAfter} 个`);
  }
  if (stringSaved > 0) parts.push(`少 ${stringSaved} 次换弦`);
  if (toneSaved > 0) parts.push(`少 ${toneSaved} 次音色切换`);
  if (shiftSaved > 0) parts.push(`少 ${shiftSaved} 次挪手`);

  if (parts.length === 0) {
    return "已重排：落点换了，手的移动次数和逐音挑选一样";
  }

  const extra =
    Math.max(0, -stringSaved) + Math.max(0, -shiftSaved);
  const caveat =
    extra > 0 ? `；换手总数多 ${extra} 次，但都落在来得及的地方` : "";
  return `已编排：${parts.join("、")}${caveat}`;
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
