/**
 * 纯前端模式下的曲谱存储（localStorage）。
 *
 * 背景：GitHub Pages 只托管静态前端，没有 Rust 后端。若不兜底，
 * 「保存 / 加载曲谱」在线上必然失败，用户连最基本的「拼—听—存—取」都走不通。
 *
 * 取舍：这里不追求多端同步，只保证同一台设备同一浏览器里曲谱不丢。
 * 数据结构与后端 /api/v1/scores 返回的 Score 完全一致，将来接上后端可直接迁移。
 */

import type { NoteColumn } from "./types";

const STORAGE_KEY = "taiyin.scores.v1";

export interface StoredScore {
  id: string;
  title: string;
  notes: NoteColumn[];
  created_at: string;
  updated_at: string;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // 隐私模式 / 禁用存储时 setItem 会抛错，先探测再使用
    const probe = "__taiyin_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): StoredScore[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredScore[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: StoredScore[]): void {
  const store = storage();
  if (!store) {
    throw new Error("浏览器不允许本地存储（可能处于隐私模式），曲谱无法保存");
  }
  store.setItem(STORAGE_KEY, JSON.stringify(list));
}

function newId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function localCreateScore(title: string, notes: NoteColumn[]): StoredScore {
  const now = new Date().toISOString();
  const score: StoredScore = {
    id: newId(),
    title: title.trim() || "未命名曲谱",
    notes,
    created_at: now,
    updated_at: now,
  };
  const list = readAll();
  list.unshift(score);
  writeAll(list);
  return score;
}

export function localListScores(): StoredScore[] {
  return readAll().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function localGetScore(id: string): StoredScore {
  const found = readAll().find((s) => s.id === id);
  if (!found) throw new Error("曲谱不存在或已被删除");
  return found;
}

export function localUpdateScore(
  id: string,
  data: { title?: string; notes?: NoteColumn[] },
): StoredScore {
  const list = readAll();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error("曲谱不存在或已被删除");
  const prev = list[idx];
  const next: StoredScore = {
    ...prev,
    title: data.title !== undefined ? data.title.trim() || prev.title : prev.title,
    notes: data.notes ?? prev.notes,
    updated_at: new Date().toISOString(),
  };
  list[idx] = next;
  writeAll(list);
  return next;
}

export function localDeleteScore(id: string): void {
  const list = readAll().filter((s) => s.id !== id);
  writeAll(list);
}
