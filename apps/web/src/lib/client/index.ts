/**
 * 客户端门面 —— UI 与「绑定层」之间唯一的接触面。
 *
 * ## 为什么需要这一层
 *
 * 领域逻辑现在有两个执行出口：浏览器内 WASM（`@/lib/taiyin-wasm`）与 HTTP
 * （`@/lib/api`）。在这之前，每个组件各自 import 这两个模块：
 * 7 个组件直连 WASM、7 个直连 api。后果是：
 *
 * - 换实现（改函数名、改返回形状、加一次 await）会波及整片 UI；
 * - 组件测试必须知道「WASM 怎么初始化」，被迫写一堆 `vi.mock`；
 * - 同一个能力在「离线可用」与「必须后端」之间怎么降级，散落在每个组件里。
 *
 * 这一层的职责就是把这两件事收拢：**组件只依赖这里的函数签名与类型**，
 * 底下走 WASM 还是 HTTP 由这里决定。
 *
 * ## 设计边界（刻意保持薄）
 *
 * - 这里**不放业务规则**。规则在 Rust（`taiyin-core`）；这里只做搬运与降级。
 * - 不重新发明类型：一律 re-export 领域类型，避免出现「门面类型」与
 *   「领域类型」两套需要同步的东西。
 * - 不做缓存、不做请求合并：那是调用方或数据层的判断，塞进来会让行为难以推理。
 *
 * ## 分层
 *
 * ```text
 * components/*            ← 只 import @/lib/client
 *        │
 * @/lib/client/index.ts   ← 本文件：唯一接触面
 *        │
 *   ┌────┴────┐
 *   ▼         ▼
 * taiyin-wasm  api        ← 绑定层（浏览器 WASM / HTTP）
 *   │         │
 *   └────┬────┘
 *        ▼
 * taiyin-core (Rust)       ← 领域逻辑唯一实现
 * ```
 *
 * 后续把 `page.tsx` 的 23 个 `useState` 拆成若干 hook 时，那些 hook 也只依赖这一层。
 */

// ──────────────────────────────────────────────
// 引擎可用性（组件渲染「引擎装载中 / 失败」提示用）
// ──────────────────────────────────────────────
export {
  getWasmLoadState,
  getWasmLoadError,
  isWasmReady,
  useWasmInit,
  type WasmLoadState,
} from "@/lib/taiyin-wasm";

// ──────────────────────────────────────────────
// 减字编码 / 解码（导出文本谱、整段粘贴回来）
// ──────────────────────────────────────────────
export {
  encodeJianziBatch,
  encodeJianziBatchSync,
  decodeJianziBatch,
  decodeJianziBatchSync,
} from "@/lib/taiyin-wasm";
export type {
  DecodeBatchResult,
  JianziDictEntry,
  FreqResult,
  VariantGroup,
} from "@/lib/jianzi-dictionary-types";

// ──────────────────────────────────────────────
// 简谱 ↔ 减字（翻译、编排、分句）
// ──────────────────────────────────────────────
export {
  translateJianpuToJianzi,
  translateJianpuSequenceToJianzi,
  arrangeJianpuSequence,
  splitPhrases,
  describeArrangement,
  describePhrases,
  type JianpuArrangement,
  type PathStats,
  type PhraseSpan,
} from "@/lib/taiyin-wasm";

// ──────────────────────────────────────────────
// 减字字典 / 字频 / 变体
// ──────────────────────────────────────────────
export {
  getJianziDictionary,
  analyzeJianziFrequency,
  getJianziVariantGroups,
} from "@/lib/taiyin-wasm";

// ──────────────────────────────────────────────
// 联袂指法（成组 / 解组 / 音程判定）
// ──────────────────────────────────────────────
export {
  LIANMEI_OPTIONS,
  normalizeLianmei,
  linkLianmei,
  clearLianmei,
  lianmeiGroups,
  lianmeiRoleAt,
  lianmeiRelation,
  relationFits,
  type LianmeiOption,
  type LianmeiGroup,
  type LianmeiRelation,
} from "@/lib/lianmei";

// ──────────────────────────────────────────────
// 连打输入（键盘盲打录谱）
// ──────────────────────────────────────────────
export {
  parseRapidInput,
  normalizeRapidInput,
  getRapidSlots,
  RAPID_SLOTS_BY_TONE,
  RAPID_SLOT_ORDER,
  RAPID_SLOT_LABEL,
  RAPID_CHEATSHEET,
  type RapidParse,
  type RapidSlot,
  type RapidToken,
} from "@/lib/jianzi-rapid";

// ──────────────────────────────────────────────
// 后端能力（只有这部分需要网络）
//
// 导出成命名空间而不是逐项 re-export：后端面很大（曲谱 CRUD、收藏、账号、
// 举报、认领、识别），逐项列会变成一份需要人肉维护的清单。
// 命名空间既保留 `client.api.xxx` 的显式，又不会因为后端加一个函数就漏同步。
// ──────────────────────────────────────────────
export * as api from "@/lib/api";

// UI 需要在「后端连不上」时自行决定降级，所以这两个从绑定层直接暴露：
// 前者判断是否网络故障，后者是本地存储的写入口。
export { isBackendUnreachable } from "@/lib/net-error";
export { localCreateScore } from "@/lib/local-score-store";

// 后端返回形状的类型：UI 渲染列表/表单时要用，且不该为了类型再去 import 绑定层。
export type {
  Score,
  ScoreListItem,
  ScorePage,
  AuthResult,
  ReportResult,
  CandidateSelection,
  SelectCandidatesResponse,
  RecognizeJianziResponse,
  RecognizeSheetCell,
  RecognizeSheetResponse,
} from "@/lib/api";
