/**
 * 每句练到第几档速度 —— 这台设备上的一张练习备忘。
 *
 * ## 为什么要记
 *
 * 「这一句我练到 0.8× 了」是第二天坐下来最想先知道的一件事。
 * 不记的话，每次打开都要从最慢一档重新试：重复的试探会让人以为自己没长进，
 * 而这恰好是慢练最容易半途而废的地方。
 *
 * ## 为什么不是成就
 *
 * 曲谱一改，句的边界就变了，旧成绩立刻对不上（句的键里带着边界），
 * 宁可当没练过，也不留一个「已过原速」的假标记挂在别的句上。
 * 全部存在本机，不上传、不进社区：这是私人的练功记录，不是给人看的勋章。
 *
 * ## 为什么是 0.1 一档
 *
 * 老师傅调速度就一句话「再快十个数」。档位等距，`再快一档` 才永远指同一件事；
 * 原来那个 0.75× 看着合理，却让「再快一档」有时是 +0.1、有时是 +0.15，
 * 用户按两次就不知道自己在哪一档了。
 */

/** 慢练档位，等距 0.1。1× 就是谱面当前标注的速度，不是「这首曲子的标准速度」。 */
export const TEMPO_LADDER = [0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

/** 达到这一档就算「到原速」。浮点比较留一点余量。 */
const CLEARED_AT = 1;
const EPSILON = 1e-6;

/** 每个句键对应的最好成绩（倍率）。 */
export type PhraseProgress = Record<string, number>;

/** 这一档是否已到原速。 */
export function isCleared(tempo: number): boolean {
  return tempo >= CLEARED_AT - EPSILON;
}

/**
 * 下一档。已在顶档（或高于顶档）返回 null。
 *
 * 用「第一个严格更大的档位」而不是「下标 + 1」：旧版本存过 0.75×，
 * 按下标算会跳回 0.7×，等于原地踏步。
 */
export function nextTempo(tempo: number): number | null {
  for (const t of TEMPO_LADDER) {
    if (t > tempo + EPSILON) return t;
  }
  return null;
}

/** 把任意倍率吸附到最近的档位（用于旧数据 / 手滑传入）。 */
export function nearestTempo(tempo: number): number {
  let best: number = TEMPO_LADDER[0];
  for (const t of TEMPO_LADDER) {
    if (Math.abs(t - tempo) < Math.abs(best - tempo)) best = t;
  }
  return best;
}

/**
 * 一份谱的身份：社区 id（没有就 local）+ 曲名 + 音数。
 *
 * 音数是廉价的内容指纹：改了谱面音数一变，旧进度就不再被读出。
 * 改音不改数的情况拦不住，但那点成绩本来也只是备忘，
 * 不值得为了它算一遍全谱哈希。
 */
export function scoreProgressKey(
  scoreId: string | null,
  title: string,
  noteCount: number,
): string {
  return `${scoreId ?? "local"}|${title.trim()}|${noteCount}`;
}

const STORAGE_PREFIX = "taiyin.practiceProgress.v1:";

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

/** 读一份谱的进度。存储不可用 / 内容坏了都当「还没练过」。 */
export function readProgress(key: string): PhraseProgress {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: PhraseProgress = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeProgress(key: string, progress: PhraseProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(progress));
  } catch {
    // 隐私模式 / 配额满：记不住就算了，本次会话内的进度仍然有效
  }
}

/**
 * 记一条成绩，**只升不降**。
 *
 * 慢练时不升反降是常事（今天手冷，0.8× 走不下来），但那不该把昨天的记录抹掉——
 * 抹掉之后用户看到「退步」，实际上是「今天没到」。最好成绩只用来回答
 * 「我最多练到多快」，不回答「我今天怎么样」。
 */
export function recordTempo(
  progress: PhraseProgress,
  phraseKey: string,
  tempo: number,
): PhraseProgress {
  const prev = progress[phraseKey] ?? 0;
  if (tempo <= prev) return progress;
  return { ...progress, [phraseKey]: tempo };
}

/**
 * 合练用哪一档：**取两句里更慢的那一句**。
 *
 * 合练不是考试，是让手在气口处别停。只要有一句还没到这个速度，
 * 跨气口时就必然赶或者拖——那时练的已经不是连接，而是补救。
 * 快的那句等一等，慢的那句不追，这是唯一能让两句话都成立的速度。
 *
 * 没练过的那句（记 0）按当前手选的档位算：生地方不该比手选的更快。
 */
export function joinTempo(bestA: number, bestB: number, fallback: number): number {
  return Math.min(bestA || fallback, bestB || fallback);
}

/** 有几句到了原速。 */
export function clearedCount(
  phraseKeys: string[],
  progress: PhraseProgress,
): number {
  return phraseKeys.filter((k) => isCleared(progress[k] ?? 0)).length;
}

/** 下一个还没到原速的句（按谱面顺序），全过了返回 null。 */
export function nextUnclearedIndex(
  phraseKeys: string[],
  progress: PhraseProgress,
): number | null {
  for (let i = 0; i < phraseKeys.length; i++) {
    if (!isCleared(progress[phraseKeys[i]] ?? 0)) return i;
  }
  return null;
}
