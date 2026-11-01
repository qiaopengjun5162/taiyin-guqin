/**
 * 基准音（concert pitch）—— A4 的频率，全谱音高的唯一基准。
 *
 * 十二平均律下所有音都是相对 A4 的比例：f = A4 × 2^((midi−69)/12)。
 * 所以一床琴整体偏低时，只需改这一个数，整谱就跟着对齐，不必逐音移调。
 *
 * 古琴定音常整体低于 440Hz，丝弦琴尤其如此（常见 425–435）。
 * 下限 390 覆盖「比标准低两个半音」的老弦，上限 445 给到略高的情形；
 * 超出范围一律夹紧，避免误输入把整谱推到听不出来的音区。
 *
 * 存储：localStorage（曲谱存本机，这个偏好也存本机，不上传）。
 */

const STORAGE_KEY = "taiyin.concertPitch.v1";

export const CONCERT_PITCH_MIN = 390;
export const CONCERT_PITCH_MAX = 445;
export const CONCERT_PITCH_DEFAULT = 440;

/** 模块级缓存：localStorage 只在首次读取，之后靠这个缓存保证快照稳定。 */
let cached: number | null = null;
const listeners = new Set<() => void>();

export function clampConcertPitch(value: number): number {
  if (!Number.isFinite(value)) return CONCERT_PITCH_DEFAULT;
  return Math.min(CONCERT_PITCH_MAX, Math.max(CONCERT_PITCH_MIN, Math.round(value)));
}

function readStored(): number {
  if (typeof window === "undefined") return CONCERT_PITCH_DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return CONCERT_PITCH_DEFAULT;
    return clampConcertPitch(Number(raw));
  } catch {
    return CONCERT_PITCH_DEFAULT;
  }
}

/** 客户端快照（useSyncExternalStore 用）。 */
export function getConcertPitch(): number {
  cached ??= readStored();
  return cached;
}

/** 服务端/水合快照：恒为标准音高，避免水合不一致。 */
export function getServerConcertPitch(): number {
  return CONCERT_PITCH_DEFAULT;
}

/** 写入并广播；返回夹紧后的实际值。 */
export function setConcertPitch(value: number): number {
  const next = clampConcertPitch(value);
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // 隐私模式 / 配额满：本次会话内仍然生效，不阻断播放
  }
  for (const listener of listeners) listener();
  return next;
}

export function subscribeConcertPitch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅供测试：丢弃缓存，使下次读取回到 localStorage。 */
export function resetConcertPitchCache(): void {
  cached = null;
}
