import type { NoteColumn } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
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

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

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
  created_at: string;
  updated_at: string;
}

export interface Score extends ScoreListItem {
  notes: NoteColumn[];
}

export async function createScore(
  title: string,
  notes: NoteColumn[],
): Promise<Score> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, notes }),
  });
  return handleResponse(res);
}

export async function listScores(): Promise<ScoreListItem[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/scores`);
  return handleResponse(res);
}

export async function getScore(id: string): Promise<Score> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/scores/${id}`);
  return handleResponse(res);
}

export async function updateScore(
  id: string,
  data: { title?: string; notes?: NoteColumn[] },
): Promise<Score> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/scores/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteScore(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/scores/${id}`, {
    method: "DELETE",
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
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/translate/select`, {
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
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/jianzi/recognize`, {
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
  method: "llm" | "unavailable";
  /** 识别出的所有字格（坐标可能非连续，前端按 row/col 重排为网格） */
  cells: RecognizeSheetCell[];
}

/**
 * 整页减字谱图像识别：base64 图片 → Claude 多模态 → 按网格坐标排布的各减字文本。
 * 后端未配置 ANTHROPIC_API_KEY 时返回 method="unavailable" + 503。
 */
export async function recognizeJianziSheet(
  imageBase64: string,
  mediaType: string,
): Promise<RecognizeSheetResponse> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/jianzi/recognize-sheet`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType }),
  });
  return handleResponse(res);
}
