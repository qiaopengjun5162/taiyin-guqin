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
