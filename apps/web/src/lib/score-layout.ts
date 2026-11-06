/**
 * 谱面排版偏好 —— 布局模式 / 疏密 / 行宽。
 *
 * 为什么要持久化：排版是"读谱时的眼睛舒适度"，属于个人习惯而不是谱子内容。
 * 每次打开都要重设一遍，用户就会退回默认档，三档布局等于白做。
 *
 * 为什么不用 effect 里同步 setState：React 19 禁止（会触发额外渲染并告警），
 * 且 localStorage 是浏览器专属值，SSR 阶段读不到。所以沿用项目已有做法——
 * 模块内缓存 + `useSyncExternalStore`，读取函数两次调用之间必须返回**同一个对象**，
 * 否则订阅端会无限重渲染（这是 useSyncExternalStore 最经典的坑）。
 */

export type ScoreLayout = "flow" | "barline" | "equal";
export type ScoreDensity = "compact" | "normal" | "loose";
export type ScoreWidth = "narrow" | "normal" | "wide";

export interface ScoreLayoutPref {
  layout: ScoreLayout;
  density: ScoreDensity;
  width: ScoreWidth;
}

export const LAYOUT_OPTIONS: Array<{
  id: ScoreLayout;
  label: string;
  hint: string;
}> = [
  {
    id: "flow",
    label: "自然流式",
    hint: "音符按顺序铺满一行再换行，小节线跟着流走。最紧凑，适合快速通读。",
  },
  {
    id: "barline",
    label: "小节换行",
    hint: "一个小节不拆到两行，整节一起换行。小节线永远落在一行的末尾或行首，便于对谱。",
  },
  {
    id: "equal",
    label: "等宽小节",
    hint: "每个小节宽度一致，右边缘对齐成一条线。最像印出来的谱，适合打印与教学。",
  },
];

export const DENSITY_OPTIONS: Array<{ id: ScoreDensity; label: string }> = [
  { id: "compact", label: "紧凑" },
  { id: "normal", label: "标准" },
  { id: "loose", label: "疏朗" },
];

export const WIDTH_OPTIONS: Array<{ id: ScoreWidth; label: string }> = [
  { id: "narrow", label: "窄" },
  { id: "normal", label: "中" },
  { id: "wide", label: "宽" },
];

/** 疏密 → 相邻音符列的间距（px）。与 `NOTE_COLUMN_GAP` 同单位，等宽小节算宽度要用它。 */
export const DENSITY_GAP: Record<ScoreDensity, number> = {
  compact: 6,
  normal: 12,
  loose: 20,
};

/** 疏密 → 音符列内的额外上下留白（px），让"疏朗"不只是横向拉开。 */
export const DENSITY_PADDING: Record<ScoreDensity, number> = {
  compact: 8,
  normal: 12,
  loose: 18,
};

/**
 * 行宽 → 谱面区最大宽度（rem）。
 *
 * 窄档与改造前的 `max-w-xl`（36rem）等价，所以"看起来没变"这条退路还在。
 * 中档是新的默认：576px 一行只放得下 4 个音，一部长曲要滚很多屏。
 */
export const WIDTH_MAX_REM: Record<ScoreWidth, number> = {
  narrow: 36,
  normal: 48,
  wide: 68,
};

export const DEFAULT_LAYOUT_PREF: ScoreLayoutPref = {
  layout: "flow",
  density: "normal",
  width: "normal",
};

const STORAGE_KEY = "taiyin.scoreLayout.v1";

/** 缓存快照：useSyncExternalStore 要求同一状态返回同一引用。 */
let cached: ScoreLayoutPref = DEFAULT_LAYOUT_PREF;
let cachedRaw: string | null = null;
let loaded = false;

const listeners = new Set<() => void>();

function isLayout(v: unknown): v is ScoreLayout {
  return v === "flow" || v === "barline" || v === "equal";
}
function isDensity(v: unknown): v is ScoreDensity {
  return v === "compact" || v === "normal" || v === "loose";
}
function isWidth(v: unknown): v is ScoreWidth {
  return v === "narrow" || v === "normal" || v === "wide";
}

/**
 * 逐字段校验后回退。
 *
 * 不整体校验就退回默认：老版本存下的 JSON 少了新字段（比如后来才加的 width），
 * 整体判非法会让用户已选的 layout 也一起丢掉。
 */
function parse(raw: string | null): ScoreLayoutPref {
  if (!raw) return DEFAULT_LAYOUT_PREF;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return {
      layout: isLayout(obj.layout) ? obj.layout : DEFAULT_LAYOUT_PREF.layout,
      density: isDensity(obj.density) ? obj.density : DEFAULT_LAYOUT_PREF.density,
      width: isWidth(obj.width) ? obj.width : DEFAULT_LAYOUT_PREF.width,
    };
  } catch {
    // 存了半截 JSON / 被别的东西覆盖：当作没设置过
    return DEFAULT_LAYOUT_PREF;
  }
}

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // 隐私模式 / 存储被禁用
    return null;
  }
}

/** 读当前偏好。同状态必须返回同一引用——`useSyncExternalStore` 靠它判断有没有变。 */
export function getLayoutPref(): ScoreLayoutPref {
  const raw = readRaw();
  if (!loaded || raw !== cachedRaw) {
    cached = parse(raw);
    cachedRaw = raw;
    loaded = true;
  }
  return cached;
}

/** 服务端渲染 / 首帧水合用：恒定默认值，避免 hydration mismatch。 */
export function getLayoutPrefServerSnapshot(): ScoreLayoutPref {
  return DEFAULT_LAYOUT_PREF;
}

/** 局部更新（只传要改的字段），写盘并通知订阅者。 */
export function setLayoutPref(patch: Partial<ScoreLayoutPref>): void {
  const next: ScoreLayoutPref = { ...getLayoutPref(), ...patch };
  const raw = JSON.stringify(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      // 存储不可用时只在本次会话生效，不阻断操作
    }
  }
  cached = next;
  cachedRaw = raw;
  loaded = true;
  for (const listener of listeners) listener();
}

export function subscribeLayoutPref(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 测试用：清掉模块内缓存，让下次读取重新走 localStorage。 */
export function resetLayoutPrefCache(): void {
  cached = DEFAULT_LAYOUT_PREF;
  cachedRaw = null;
  loaded = false;
}
