/**
 * 练琴记录：打卡条目 + 练习录音。
 *
 * 两件事放一处，因为它们是同一次练习的两面：
 * 「今天练了 25 分钟《良宵引》」是记录，「这段录音」是证据。
 *
 * 为什么用 IndexedDB 而不是 localStorage：一段三分钟的 opus 录音就有 1MB 上下，
 * localStorage 只有 5MB 且只能存字符串，base64 编码后还要再胖三分之一。
 * 条目（纯 JSON）本可以进 localStorage，但拆两套存储会让「删录音时连带删记录」
 * 这类操作变成两处事务，不如统一放进 IndexedDB。
 *
 * 隐私模式 / 老浏览器下退化成内存：本次会话可用、刷新即失。UI 会如实说明，
 * 不假装已经存住。
 */

/** 一条练习记录。 */
export interface PracticeEntry {
  id: string;
  /** 练习发生的**本地**日期 `YYYY-MM-DD`（不是 UTC，否则晚上练琴会记到昨天）。 */
  date: string;
  createdAt: string;
  /** 曲目；空串会归到「未记曲目」。 */
  scoreTitle: string;
  seconds: number;
  note: string;
  /** 来自哪段录音（若有）。 */
  recordingId?: string;
  /** 怎么来的：录音结束 / 手动记一笔 / 专注计时 / 跟弹判定通过。 */
  source: "recording" | "manual" | "timer" | "judge";
}

/** 录音的元信息（不含音频本体，列表只读这份，避免把所有音频读进内存）。 */
export interface RecordingMeta {
  id: string;
  createdAt: string;
  name: string;
  scoreTitle: string;
  seconds: number;
  mime: string;
}

/** 一段时间内的汇总。 */
export interface RangeSummary {
  seconds: number;
  /** 有练习的天数（同一天记两笔只算一天）。 */
  days: number;
  entryCount: number;
  /** 按曲目聚合的时长，降序。 */
  byScore: { title: string; seconds: number }[];
}

const UNTITLED = "未记曲目";

// ──────────────────────────────────────────────
// 纯函数：日期与汇总（可单测，不碰存储）
// ──────────────────────────────────────────────

/** 本地日期键。`toISOString()` 是 UTC，晚上八点之后在东八区会退一天。 */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 本周范围，周一起算（琴课/练习周报都以周一开始，符合中文习惯）。 */
export function weekRange(today: Date): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const offset = (start.getDay() + 6) % 7; // 周一 = 0
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: localDateKey(start), to: localDateKey(end) };
}

/** 本月范围。 */
export function monthRange(today: Date): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: localDateKey(start), to: localDateKey(end) };
}

/**
 * 汇总 `[from, to]` 闭区间内的条目。
 *
 * 日期键是 `YYYY-MM-DD` 定长格式，故字符串比较即日期比较，不必解析成 Date
 * （解析还会被时区再坑一次）。
 */
export function summarize(entries: PracticeEntry[], from: string, to: string): RangeSummary {
  const byScore = new Map<string, number>();
  const days = new Set<string>();
  let seconds = 0;
  let entryCount = 0;

  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    seconds += e.seconds;
    entryCount += 1;
    days.add(e.date);
    const title = e.scoreTitle.trim() || UNTITLED;
    byScore.set(title, (byScore.get(title) ?? 0) + e.seconds);
  }

  return {
    seconds,
    days: days.size,
    entryCount,
    byScore: [...byScore.entries()]
      .map(([title, s]) => ({ title, seconds: s }))
      .sort((a, b) => b.seconds - a.seconds),
  };
}

/**
 * 连续练习天数。
 *
 * 今天还没练时从昨天往回数——早上打开 App 看到「连续 0 天」会把昨天之前的
 * 坚持一并抹掉，那是个假读数。
 */
export function streakDays(entries: PracticeEntry[], today: Date): number {
  const dates = new Set(entries.map((e) => e.date));
  if (dates.size === 0) return 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!dates.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (dates.has(localDateKey(cursor))) {
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

/** 人话时长：45 秒 / 12 分 30 秒 / 1 小时 5 分。 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} 秒`;
  const totalMinutes = Math.floor(s / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const rest = s % 60;
  if (h === 0) return rest === 0 ? `${m} 分钟` : `${m} 分 ${rest} 秒`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

/** 逐日格子：一天一格，用来看出「哪天断了」。 */
export interface DayCell {
  date: string;
  seconds: number;
  /** 有记录的条目数（同一天记多笔会 > 1）。 */
  entries: number;
  isToday: boolean;
}

/**
 * 最近 `days` 天的逐日汇总，**从最早排到今天**。
 *
 * 为什么不复用 `summarize`：「练习天数 5 天」回答不了「上一次练是几天前」。
 * 断没断这件事必须看得见连续的空格，而不是一个总数——这是「日课」和
 * 「本周小结」的区别。
 *
 * 没有记录的日子也要占位（`seconds: 0`），否则空格会被挤掉，
 * 补出来的条带看起来像「天天练」。
 */
export function recentDays(
  entries: PracticeEntry[],
  today: Date,
  days = 14,
): DayCell[] {
  const n = Math.max(1, Math.floor(days));
  const byDate = new Map<string, { seconds: number; entries: number }>();
  for (const e of entries) {
    const hit = byDate.get(e.date);
    if (hit) {
      hit.seconds += e.seconds;
      hit.entries += 1;
    } else {
      byDate.set(e.date, { seconds: e.seconds, entries: 1 });
    }
  }

  const todayKey = localDateKey(today);
  const out: DayCell[] = [];
  for (let back = n - 1; back >= 0; back -= 1) {
    // 用本地年月日构造，而不是 `today - back*86400e3`：
    // 后者在夏令时切换的那一天会漂掉一小时，进而算错日期键。
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const key = localDateKey(d);
    const hit = byDate.get(key);
    out.push({
      date: key,
      seconds: hit?.seconds ?? 0,
      entries: hit?.entries ?? 0,
      isToday: key === todayKey,
    });
  }
  return out;
}

// ──────────────────────────────────────────────
// 存储
// ──────────────────────────────────────────────

const DB_NAME = "taiyin.practice";
const DB_VERSION = 1;
const ENTRY_STORE = "entries";
const META_STORE = "recordings";
const BLOB_STORE = "recording-blobs";

/** IndexedDB 不可用时的兜底：只在内存里，刷新即失。 */
const memoryEntries = new Map<string, PracticeEntry>();
const memoryMetas = new Map<string, RecordingMeta>();
const memoryBlobs = new Map<string, Blob>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        db.createObjectStore(ENTRY_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    // 隐私模式、配额耗尽、被其他标签页占住：一律降级，不抛给调用方
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 操作失败"));
  });
}

/** 单店读写；数据库不可用或操作失败时返回 `null`，由调用方走内存兜底。 */
async function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await request(run(db.transaction(storeName, mode).objectStore(storeName)));
  } catch {
    return null;
  }
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function byCreatedDesc<T extends { createdAt: string }>(a: T, b: T): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** 录音能不能真正存住（决定 UI 要不要提示「本次有效」）。 */
export async function isPersistentStorage(): Promise<boolean> {
  return (await openDb()) !== null;
}

export async function listEntries(): Promise<PracticeEntry[]> {
  const rows = await tx<PracticeEntry[]>(ENTRY_STORE, "readonly", (s) => s.getAll());
  if (rows) return rows.sort(byCreatedDesc);
  return [...memoryEntries.values()].sort(byCreatedDesc);
}

export interface NewEntryInput {
  scoreTitle: string;
  seconds: number;
  note?: string;
  /** 缺省为今天。 */
  date?: string;
  recordingId?: string;
  source?: PracticeEntry["source"];
}

export async function addEntry(input: NewEntryInput): Promise<PracticeEntry> {
  const now = new Date();
  const entry: PracticeEntry = {
    id: newId(),
    date: input.date ?? localDateKey(now),
    createdAt: now.toISOString(),
    scoreTitle: input.scoreTitle.trim(),
    seconds: Math.max(0, Math.round(input.seconds)),
    note: input.note?.trim() ?? "",
    recordingId: input.recordingId,
    source: input.source ?? "manual",
  };
  const stored = await tx(ENTRY_STORE, "readwrite", (s) => s.put(entry));
  if (stored === null) memoryEntries.set(entry.id, entry);
  return entry;
}

export async function updateEntryNote(id: string, note: string): Promise<void> {
  const all = await listEntries();
  const found = all.find((e) => e.id === id);
  if (!found) return;
  const next: PracticeEntry = { ...found, note: note.trim() };
  const stored = await tx(ENTRY_STORE, "readwrite", (s) => s.put(next));
  if (stored === null) memoryEntries.set(next.id, next);
}

export async function deleteEntry(id: string): Promise<void> {
  const stored = await tx(ENTRY_STORE, "readwrite", (s) => s.delete(id));
  if (stored === null) memoryEntries.delete(id);
}

export interface SaveRecordingInput {
  blob: Blob;
  seconds: number;
  scoreTitle?: string;
  name?: string;
}

export async function saveRecording(input: SaveRecordingInput): Promise<RecordingMeta> {
  const now = new Date();
  const meta: RecordingMeta = {
    id: newId(),
    createdAt: now.toISOString(),
    name: input.name?.trim() || defaultRecordingName(input.scoreTitle),
    scoreTitle: input.scoreTitle?.trim() ?? "",
    seconds: Math.max(0, Math.round(input.seconds)),
    mime: input.blob.type || "audio/webm",
  };
  const [metaOk, blobOk] = await Promise.all([
    tx(META_STORE, "readwrite", (s) => s.put(meta)),
    tx(BLOB_STORE, "readwrite", (s) => s.put({ id: meta.id, blob: input.blob })),
  ]);
  if (metaOk === null || blobOk === null) {
    memoryMetas.set(meta.id, meta);
    memoryBlobs.set(meta.id, input.blob);
  }
  return meta;
}

/**
 * 录音默认名。
 *
 * 只放曲名，不带日期：列表第二行已经写着「11-02 14:04 · 2 秒」，
 * 名字里再来一遍时间只会让人多读一遍同样的字。
 */
export function defaultRecordingName(scoreTitle?: string): string {
  return scoreTitle?.trim() || "练习";
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const rows = await tx<RecordingMeta[]>(META_STORE, "readonly", (s) => s.getAll());
  if (rows) return rows.sort(byCreatedDesc);
  return [...memoryMetas.values()].sort(byCreatedDesc);
}

export async function getRecordingBlob(id: string): Promise<Blob | null> {
  const row = await tx<{ id: string; blob: Blob } | undefined>(
    BLOB_STORE,
    "readonly",
    (s) => s.get(id),
  );
  if (row) return row.blob;
  return memoryBlobs.get(id) ?? null;
}

export async function renameRecording(id: string, name: string): Promise<void> {
  const all = await listRecordings();
  const found = all.find((r) => r.id === id);
  if (!found) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const next: RecordingMeta = { ...found, name: trimmed };
  const stored = await tx(META_STORE, "readwrite", (s) => s.put(next));
  if (stored === null) memoryMetas.set(next.id, next);
}

export async function deleteRecording(id: string): Promise<void> {
  const [a, b] = await Promise.all([
    tx(META_STORE, "readwrite", (s) => s.delete(id)),
    tx(BLOB_STORE, "readwrite", (s) => s.delete(id)),
  ]);
  if (a === null || b === null) {
    memoryMetas.delete(id);
    memoryBlobs.delete(id);
  }
}

/** 只给测试用：清空内存兜底并允许重新探测 IndexedDB。 */
export function __resetPracticeStoreForTests(): void {
  memoryEntries.clear();
  memoryMetas.clear();
  memoryBlobs.clear();
  dbPromise = null;
}
