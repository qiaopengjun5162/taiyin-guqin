import type { NoteColumn } from "./types";
import { DEFAULT_TUNING, isTuningId, type TuningId } from "./tuning";
import {
  localCreateScore,
  localDeleteScore,
  localGetScore,
  localListScores,
  localUpdateScore,
} from "./local-score-store";
import { getStoredApiBase } from "./settings";
import { getOwnerToken } from "./owner-token";

/** 本地曲谱读写：连后端时，首页「本机」tab 用它们直接操作浏览器存储，
 *  不走 api 的 server/browser 分支判断（否则本地 id 会被误发到服务器）。 */
export { localListScores, localGetScore, localDeleteScore };

/**
 * 解析后端地址：运行时设置（设置面板）> 构建期环境变量 > 无。
 * 做成函数而非模块级常量，因为运行时设置可能随时变（用户在设置里改了后端地址）。
 * 返回 null 表示「未配置后端」——此时退回本地存储。
 */
export function getApiBase(): string | null {
  const runtime = getStoredApiBase();
  if (runtime) return runtime;
  return process.env.NEXT_PUBLIC_API_URL || null;
}

/** 解析实际请求基址：有配置用配置，否则退回本机 3001（dev 约定）。 */
function resolveBase(): string {
  return getApiBase() ?? "http://localhost:3001";
}

/**
 * 纯前端模式：没有配置后端地址，且当前不在本机开发环境。
 *
 * GitHub Pages 这类静态托管没有 Rust 后端，此时若继续打 localhost:3001，
 * 保存 / 加载 / 识别全部必然失败。曲谱改为存浏览器本地，
 * 保证「拼—听—存—取」这条最基本的链路在线上可用。
 */
export function isBrowserOnlyMode(): boolean {
  // 运行时或构建期配置了后端地址 → 走服务器（社区 / 分享可达）
  if (getApiBase() !== null) return false;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1";
}

/** 当前曲谱存储位置，供 UI 提示用。 */
export function scoreStorageMode(): "server" | "browser" {
  return isBrowserOnlyMode() ? "browser" : "server";
}
const DEFAULT_TIMEOUT = 10_000;

// 后端可选 API-key 闸门（纵深防御性设计）：配置后调用 /translate/select 需携带。
// 该 key 会出现在前端 JS 包中，仅用于阻止跨站/自动化滥用，并非机密。
const TRANSLATE_API_KEY = process.env.NEXT_PUBLIC_TRANSLATE_API_KEY;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TRANSLATE_API_KEY) {
    headers["x-api-key"] = TRANSLATE_API_KEY;
  }
  return headers;
}

/**
 * 所有权凭证头：改 / 删社区曲谱时必须带上。
 *
 * 不带也能发布（成为「无主谱」，此后谁也改不了），但本机创建时总会带，
 * 让「我发布的谱」在换页面、换标签后仍然改得动。
 */
function ownerHeaders(): Record<string, string> {
  const token = getOwnerToken();
  return token ? { "x-owner-token": token } : {};
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 静态站点没有后端时的识别提示（避免静默失败） */
const BROWSER_ONLY_RECOGNIZE_HINT =
  "识别功能需要后端服务。当前是纯前端版本（未连接后端），请在本机运行 just dev 后使用识别。";

async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeout = DEFAULT_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return (body as { error?: string }).error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json();
}

export interface ScoreListItem {
  id: string;
  title: string;
  /**
   * 该谱的定弦。后端总会给值（建表默认正调），
   * 但读端仍按 `isTuningId` 校验后再用——老接口/手工改库都可能给出意料外的字符串。
   */
  tuning: TuningId;
  /**
   * 打谱人署名。空串 = 匿名（迁移前的老谱、或发布时没填）。
   * 定为可选是因为「尚未升级的后端」不会返回该字段。
   */
  author?: string;
  created_at: string;
  updated_at: string;
}

export interface Score extends ScoreListItem {
  notes: NoteColumn[];
}

/**
 * 兜底校验后端返回的定弦。
 *
 * 正常情况后端只会存三种合法值，但接口层不该信任网络数据：
 * 万一拿到未知字符串，退回正调也比让 `openMidi[index]` 取到 undefined 崩掉好。
 */
function normalizeTuning<T extends { tuning: TuningId }>(score: T): T {
  return isTuningId(score.tuning) ? score : { ...score, tuning: DEFAULT_TUNING };
}

/**
 * 保存曲谱。连后端时即「发布到社区共享池」。
 *
 * `author` 只在服务器模式生效：本机存储是私有草稿，署不署名没有意义，
 * 所以本地分支忽略该参数（`localCreateScore` 也不存它）。
 */
export async function createScore(
  title: string,
  notes: NoteColumn[],
  tuning: TuningId = DEFAULT_TUNING,
  author?: string,
): Promise<Score> {
  if (isBrowserOnlyMode()) return localCreateScore(title, notes, tuning);
  const name = author?.trim();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    // 空署名不传字段：让后端落默认匿名，而不是存一个空字符串以外的脏值
    body: JSON.stringify({ title, notes, tuning, ...(name ? { author: name } : {}) }),
  });
  return normalizeTuning(await handleResponse<Score>(res));
}

export async function listScores(): Promise<ScoreListItem[]> {
  if (isBrowserOnlyMode()) return localListScores();
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores`);
  const list = await handleResponse<ScoreListItem[]>(res);
  return list.map(normalizeTuning);
}

export async function getScore(id: string): Promise<Score> {
  if (isBrowserOnlyMode()) return localGetScore(id);
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}`);
  return normalizeTuning(await handleResponse<Score>(res));
}

export async function updateScore(
  id: string,
  data: { title?: string; notes?: NoteColumn[]; tuning?: TuningId; author?: string },
): Promise<Score> {
  if (isBrowserOnlyMode()) return localUpdateScore(id, data);
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify(data),
  });
  return normalizeTuning(await handleResponse<Score>(res));
}

export async function deleteScore(id: string): Promise<void> {
  if (isBrowserOnlyMode()) {
    localDeleteScore(id);
    return;
  }
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/scores/${id}`, {
    method: "DELETE",
    headers: ownerHeaders(),
  });
  await handleResponse(res);
}

export interface CandidateSelection {
  note_index: number;
  candidate_index: number;
  reason: string;
}

export interface SelectCandidatesResponse {
  method: "llm" | "heuristic";
  selections: CandidateSelection[];
}

export async function selectCandidates(
  notes: { number: number; octave: number }[],
  tuning: string,
): Promise<SelectCandidatesResponse> {
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/translate/select`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ notes, tuning }),
  });
  return handleResponse(res);
}

export interface RecognizeJianziResponse {
  method: "llm" | "unavailable";
  /** 模型给出的规范减字文本，如「散挑一」「大九勾四」；为空表示识别失败 */
  glyph: string | null;
  /** 识别依据（可解释性） */
  explanation: string | null;
  /** 0~1 置信度 */
  confidence: number | null;
}

/**
 * 减字谱单字图像识别：base64 图片 → Claude 多模态 → 规范减字文本。
 * 后端未配置 ANTHROPIC_API_KEY 时返回 method="unavailable" + 503。
 */
export async function recognizeJianzi(
  imageBase64: string,
  mediaType: string,
): Promise<RecognizeJianziResponse> {
  if (isBrowserOnlyMode()) throw new ApiError(BROWSER_ONLY_RECOGNIZE_HINT, 503);
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/jianzi/recognize`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType }),
  });
  return handleResponse(res);
}

/** 整页识别中的单个字格。 */
export interface RecognizeSheetCell {
  /** 行号：从上到下，首行 = 0 */
  row: number;
  /** 列号：从左到右，最左列 = 0（减字谱实际阅读为同排从右到左，前端导入时换算） */
  col: number;
  /** 规范减字文本；看不清为 null */
  glyph: string | null;
  /** 识别依据（可解释性） */
  explanation: string | null;
  /** 0~1 置信度 */
  confidence: number | null;
}

export interface RecognizeSheetResponse {
  /** template=模板切分+逐格匹配（电子谱面确定性路径）；llm=视觉模型识别 */
  method: "template" | "llm" | "unavailable";
  /** 识别出的所有字格（坐标可能非连续，前端按 row/col 重排为网格） */
  cells: RecognizeSheetCell[];
}

/**
 * 整页减字谱图像识别：base64 图片 → 电子谱面走模板切分（method="template"，
 * 字高 ≥72px 时逐格 100%），其余落 Claude 多模态（method="llm"）。
 * LLM 未配置且模板无结果时 503。
 */
export async function recognizeJianziSheet(
  imageBase64: string,
  mediaType: string,
): Promise<RecognizeSheetResponse> {
  if (isBrowserOnlyMode()) throw new ApiError(BROWSER_ONLY_RECOGNIZE_HINT, 503);
  const res = await fetchWithTimeout(`${resolveBase()}/api/v1/jianzi/recognize-sheet`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType }),
  });
  return handleResponse(res);
}
