import type { NoteColumn } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const DEFAULT_TIMEOUT = 10_000;

async function fetchWithTimeout(url: string, options?: RequestInit, timeout = DEFAULT_TIMEOUT) {
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
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export async function listScores(): Promise<ScoreListItem[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/scores`);
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export async function getScore(id: string): Promise<Score> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/scores/${id}`);
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
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
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export async function deleteScore(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/v1/scores/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes, tuning }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}
