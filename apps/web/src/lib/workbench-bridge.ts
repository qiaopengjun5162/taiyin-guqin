/**
 * 单功能页 → 打谱工作台的「带回结果」通道。
 *
 * 2026-11-28 拆页后，识别 / 简谱录入各自独立成页；用户在校对完结果后
 * 需要把谱字带回工作台。两张页之间不该共享整棵 React 状态树（那等于把
 * 所有功能又塞回一页），所以用 sessionStorage 传一次性消息：
 *
 *   功能页 queueNotes(notes) → router.push("/") → 工作台 mount 时 takeNotes()
 *
 * 只保留最近一条、5 分钟过期、取走即删。会话结束自动清空，不会变成
 * 一份「幽灵草稿」在下次打开时突然冒出来。SSR 期间 window 不存在，
 * 所有函数都做守卫，调用方只在事件 / effect 里用。
 */

import type { NoteColumn } from "./types";

const NOTES_KEY = "taiyin:bridge:notes:v1";
const PHRASE_KEY = "taiyin:bridge:phrase:v1";
const MAX_AGE_MS = 5 * 60 * 1000;

interface Envelope<T> {
  value: T;
  at: number;
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: Envelope<T> = { value, at: Date.now() };
    window.sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // 隐私模式 / 存储配额满：静默放弃「带回」能力，不影响本页功能
  }
}

function read<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key); // 取走即删，重复刷新不会重复入谱
    const parsed = JSON.parse(raw) as Envelope<unknown>;
    if (!parsed || Date.now() - parsed.at > MAX_AGE_MS) return null;
    return isValid(parsed.value) ? parsed.value : null;
  } catch {
    return null;
  }
}

const isNotes = (v: unknown): v is NoteColumn[] =>
  Array.isArray(v) && v.every((n) => n && typeof n === "object" && "jianzi" in n);

/** 功能页调用：把确认后的谱字交给工作台，然后跳转回首页。 */
export function queueNotesForWorkbench(notes: NoteColumn[]): void {
  if (notes.length > 0) write(NOTES_KEY, notes);
}

/** 工作台 mount 时调用：取出待入谱的谱字；没有就返回空数组。 */
export function takeQueuedNotes(): NoteColumn[] {
  return read(NOTES_KEY, isNotes) ?? [];
}

/** 日志页点「练这一句」时回工作台，并带上句号。 */
export function queuePhraseForWorkbench(index: number): void {
  write(PHRASE_KEY, index);
}

export function takeQueuedPhrase(): number | null {
  return read(PHRASE_KEY, (v): v is number => typeof v === "number" && v >= 0);
}
