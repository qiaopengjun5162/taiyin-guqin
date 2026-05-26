import type { NoteColumn } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
  const res = await fetch(`${API_BASE}/api/v1/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, notes }),
  });
  if (!res.ok) throw new Error("createScore failed");
  return res.json();
}

export async function listScores(): Promise<ScoreListItem[]> {
  const res = await fetch(`${API_BASE}/api/v1/scores`);
  if (!res.ok) throw new Error("listScores failed");
  return res.json();
}

export async function getScore(id: string): Promise<Score> {
  const res = await fetch(`${API_BASE}/api/v1/scores/${id}`);
  if (!res.ok) throw new Error("getScore failed");
  return res.json();
}

export async function updateScore(
  id: string,
  data: { title?: string; notes?: NoteColumn[] },
): Promise<Score> {
  const res = await fetch(`${API_BASE}/api/v1/scores/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("updateScore failed");
  return res.json();
}

export async function deleteScore(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/scores/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("deleteScore failed");
}
