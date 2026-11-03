/**
 * 自动草稿（localStorage）。
 *
 * 背景：曲谱此前只活在页面内存里。上一版加了「覆盖前确认 + beforeunload」，
 * 但用户点了「离开」、或移动端被系统回收标签页时，内容仍然全丢。
 * 这里补最后一层：有未保存修改时把当前谱快照写进 localStorage，
 * 下次打开若编辑区还是空的，就提示恢复。
 *
 * 与「保存到曲谱库」的区别：
 * - 草稿只有一份，代表「最近一次没保存的编辑」，会被后续快照覆盖；
 * - 保存成功 / 明确载入别的谱后即清空，避免「都存好了还提示有草稿」。
 */

import type { NoteColumn } from "./types";
import { DEFAULT_TUNING, isTuningId, type TuningId } from "./tuning";

const STORAGE_KEY = "taiyin.draft.v1";

export interface ScoreDraft {
  title: string;
  notes: NoteColumn[];
  tuning: TuningId;
  /**
   * 这份草稿是从哪首已保存的谱改来的（null = 新谱）。
   *
   * 必须记住：否则恢复后一保存就新建一份副本，而不是更新原来那首，
   * 用户会在社区里看到自己的谱莫名多出一个重名版本。
   */
  scoreId: string | null;
  /** 写入时间戳（ms），用于「多久之前」提示，也便于将来做多标签页取较新的一份。 */
  updatedAt: number;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // 隐私模式 / 禁用存储时 setItem 会抛错，先探测再使用
    const probe = "__taiyin_draft_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 读草稿。任何异常（没存过、JSON 坏了、字段类型不对、存储不可用）都退化成 null——
 * 草稿是「尽力而为」的兜底，不该让首页开不起来。
 */
export function readDraft(): ScoreDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const d = parsed as Partial<ScoreDraft>;
    // notes 必须是数组：类型不对的草稿恢复出来只会让编辑器崩
    if (typeof d.title !== "string" || !Array.isArray(d.notes)) return null;
    return {
      title: d.title,
      notes: d.notes,
      tuning: isTuningId(d.tuning) ? d.tuning : DEFAULT_TUNING,
      scoreId: typeof d.scoreId === "string" ? d.scoreId : null,
      updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** 写草稿。返回是否真的写进去了（配额满 / 隐私模式时为 false，但不该打断编辑）。 */
export function writeDraft(draft: Omit<ScoreDraft, "updatedAt">): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/** 清草稿。清不掉也不影响当前编辑，因此吞掉异常。 */
export function clearDraft(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // ignored
  }
}

/**
 * 把时间戳说成人话（「3 分钟前」）。
 *
 * 抽成纯函数是为了能在界面上直接用，也便于单测各种边界。
 * `now` 可注入，测试里不必依赖真实时钟。
 */
export function formatDraftAge(updatedAt: number, now: number = Date.now()): string {
  if (!updatedAt || updatedAt > now) return "刚刚";
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
