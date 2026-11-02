/**
 * 我的减字 —— 把常用的谱字存下来，下次一键填回。
 *
 * 包松平那款输入法 2.6 版更新里有一条说得最实在：
 * 「只需要把自己分步骤录入组合好的减字，导入进去，下次就不再分步录入。
 *   重装系统前可以导出来备份，装好后再导入进去。」
 *
 * 我们这边「分步录入」就是 散/泛/按 → 左手 → 徽分 → 绰注 → 右手 → 弦序 六步。
 * 同一首曲子里同一个谱字要出现几十次，每次重走六步纯属浪费；
 * 换台电脑、换个人，这些攒下来的谱字也该能带走。
 *
 * 存的是**语义**（弦序/徽位/指法），不是字形图片：
 * 将来字体换一版、SVG 积木改一次，库里那些字跟着一起变，
 * 不会像位图那样留下一批看不清的旧图。
 */

import type { JianziState } from "./types";
import { jianziToText } from "./jianzi";

const STORAGE_KEY = "taiyin.custom-jianzi.v1";
/** 签名里参与比较的字段，顺序固定——排序影响去重，不能随手改。 */
const FIELDS = [
  "toneType",
  "rhythmMode",
  "leftFinger",
  "hui",
  "fen",
  "slide",
  "rightAction",
  "stringNumber",
] as const;

export interface SavedJianzi {
  id: string;
  /** 展示名，默认取「大九勾四」这种读法。 */
  label: string;
  /** 去重签名。 */
  key: string;
  state: JianziState;
  /** 被用了几次，用来把常用的排前面。 */
  uses: number;
  createdAt: number;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  error?: string;
}

/** 一个减字的稳定签名：只由这八个字段决定。 */
export function jianziKey(state: JianziState): string {
  return FIELDS.map((f) => state[f] ?? "").join("|");
}

function readAll(): SavedJianzi[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedJianzi);
  } catch {
    return [];
  }
}

function writeAll(items: SavedJianzi[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 隐私模式/配额满：本次会话内不持久化，但不该让录入流程崩掉
  }
  invalidateSnapshot();
}

/* ── 订阅：组件用 useSyncExternalStore 读，切字库时自动重渲染 ── */

const EMPTY: SavedJianzi[] = [];
const listeners = new Set<() => void>();
let snapshot: SavedJianzi[] | null = null;

function invalidateSnapshot(): void {
  snapshot = null;
  for (const listener of listeners) listener();
}

export function subscribeSaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 客户端快照（引用稳定，未变更时不会触发额外渲染）。 */
export function getSavedSnapshot(): SavedJianzi[] {
  if (typeof window === "undefined") return EMPTY;
  snapshot ??= readAll().sort(byUsage);
  return snapshot;
}

/** 服务端/水合快照：永远空，避免 hydration 不一致。 */
export function getServerSavedSnapshot(): SavedJianzi[] {
  return EMPTY;
}

/**
 * 严格校验一个减字是否「填得出来」。
 *
 * 不能直接用 `isComplete`：那个函数判的是 `!== null`，而 JSON 里缺字段是
 * `undefined`，`undefined !== null` 为真——坏数据会被当成完整字收进库，
 * 之后点一下就往谱面塞一个空壳。这里只认非空字符串。
 */
function isUsableState(value: unknown): value is JianziState {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  const filled = (v: unknown) => typeof v === "string" && v.length > 0;
  if (s.toneType === "散") return filled(s.rightAction) && filled(s.stringNumber);
  return (
    filled(s.toneType) &&
    filled(s.leftFinger) &&
    filled(s.hui) &&
    filled(s.rightAction) &&
    filled(s.stringNumber)
  );
}

function isSavedJianzi(value: unknown): value is SavedJianzi {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedJianzi>;
  return (
    typeof item.id === "string" &&
    typeof item.label === "string" &&
    typeof item.key === "string" &&
    isUsableState(item.state)
  );
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `jz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 常用程度：用得多的在前，同样多则新的在前。 */
function byUsage(a: SavedJianzi, b: SavedJianzi): number {
  return b.uses - a.uses || b.createdAt - a.createdAt;
}

export function listSaved(): SavedJianzi[] {
  return readAll().sort(byUsage);
}

/**
 * 存一个减字。已经存在就只累加使用次数（不产生重复条目）。
 * 返回 null 表示这个减字还没填完整，不该入库。
 */
export function saveJianzi(
  state: JianziState,
  label?: string,
): { item: SavedJianzi; isNew: boolean } | null {
  if (!isUsableState(state)) return null;
  const key = jianziKey(state);
  const all = readAll();
  const existing = all.find((s) => s.key === key);
  if (existing) {
    existing.uses += 1;
    if (label?.trim()) existing.label = label.trim();
    writeAll(all);
    return { item: existing, isNew: false };
  }
  const item: SavedJianzi = {
    id: newId(),
    label: label?.trim() || jianziToText(state),
    key,
    state: { ...state },
    uses: 1,
    createdAt: Date.now(),
  };
  writeAll([...all, item]);
  return { item, isNew: true };
}

export function removeSaved(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}

/** 被选用一次：次数 +1，让常用的浮到前面。 */
export function touchSaved(id: string): void {
  const all = readAll();
  const item = all.find((s) => s.id === id);
  if (!item) return;
  item.uses += 1;
  writeAll(all);
}

/** 导出为可读 JSON（换机器、发给琴友都能用）。 */
export function exportSaved(): string {
  return JSON.stringify(
    {
      version: 1,
      app: "taiyin-guqin",
      exportedAt: new Date().toISOString(),
      items: listSaved(),
    },
    null,
    2,
  );
}

/**
 * 导入：按签名合并，已有的只累加次数，不会把库撑成两份一样的字。
 * 单条坏数据只跳过它，不让整包导入失败。
 */
export function importSaved(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { added: 0, updated: 0, skipped: 0, error: "不是合法的 JSON 文件。" };
  }

  const incoming = Array.isArray(parsed)
    ? parsed
    : (parsed as { items?: unknown })?.items;
  if (!Array.isArray(incoming)) {
    return { added: 0, updated: 0, skipped: 0, error: "文件里没有 items 列表。" };
  }

  const all = readAll();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of incoming) {
    if (!isSavedJianzi(raw)) {
      skipped += 1;
      continue;
    }
    const key = jianziKey(raw.state);
    const existing = all.find((s) => s.key === key);
    if (existing) {
      existing.uses += Math.max(0, raw.uses || 0);
      if (raw.label?.trim()) existing.label = raw.label.trim();
      updated += 1;
    } else {
      all.push({
        id: newId(),
        label: raw.label?.trim() || jianziToText(raw.state),
        key,
        state: { ...raw.state },
        uses: Math.max(0, raw.uses || 1),
        createdAt: raw.createdAt || Date.now(),
      });
      added += 1;
    }
  }

  writeAll(all);
  return { added, updated, skipped };
}

/** 测试用：清空。 */
export function __resetCustomJianziForTests(): void {
  writeAll([]);
}
