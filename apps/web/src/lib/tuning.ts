/**
 * 定弦（调式）—— 七根空弦各自的音高。
 *
 * 为什么这件事必须做成数据而不是写死：
 * 减字只写「几弦几徽」，**弦的相对音高由定弦决定**。正调是 C–D–F–G–A–c–d，
 * 但琴友按曲子会紧五弦（蕤宾调，五弦升半音）或慢三弦（慢角调，三弦降半音）。
 * 若一律按正调反推音高，那根被改过的弦就整体差半音，而且错得很隐蔽——
 * 简谱看着像对的，弹出来是另一个音。
 *
 * 所有音高都以 MIDI 号存（A4=440 的等分律编号），播放/调音时再乘基准音：
 * f = concertPitch × 2^((midi−69)/12)。这样「换调」和「换基准音」互不干扰，
 * 425Hz 的正调与 440Hz 的慢角调是两个独立维度。
 *
 * 收录能确证的六种（正调/慢角/蕤宾/清商/太簇/凄凉，见下方的 TuningId 与 TUNINGS）。
 * 注意：简谱编排引擎只建模前三种（1=F 清乐七声），后三种只用于存谱/调音/播放；
 * 四份名单由 scripts/verify-tuning-contract.mjs 钉死，改一处必须同步另外三处。
 * 宁缺毋滥：定弦表错一个音，比没有这个功能更糟。
 */

export type TuningId = "zhengdiao" | "ruibin" | "manjiao" | "qingshang" | "taicu" | "qiliang";

export interface Tuning {
  id: TuningId;
  /** 常用名。 */
  name: string;
  /** 别称 + 宫音（1=某调）。 */
  alias: string;
  /** 一弦→七弦的空弦音名（显示用，降号按传统写法）。 */
  noteNames: readonly [string, string, string, string, string, string, string];
  /** 一弦→七弦的空弦 MIDI 号。 */
  openMidi: readonly [number, number, number, number, number, number, number];
  /** 这张定弦怎么来的（改哪根弦）。 */
  hint: string;
}

export const TUNINGS: readonly Tuning[] = [
  {
    id: "zhengdiao",
    name: "正调",
    alias: "仲吕调 · 1=F",
    noteNames: ["C2", "D2", "F2", "G2", "A2", "C3", "D3"],
    openMidi: [36, 38, 41, 43, 45, 48, 50],
    hint: "最常用的定弦，绝大多数入门曲用这一种。",
  },
  {
    id: "ruibin",
    name: "蕤宾调",
    alias: "紧五弦 · 1=B♭",
    noteNames: ["C2", "D2", "F2", "G2", "B♭2", "C3", "D3"],
    openMidi: [36, 38, 41, 43, 46, 48, 50],
    hint: "只把五弦紧半音（A→B♭），其余六弦同正调。",
  },
  {
    id: "manjiao",
    name: "慢角调",
    alias: "慢三弦 · 1=C",
    noteNames: ["C2", "D2", "E2", "G2", "A2", "C3", "D3"],
    openMidi: [36, 38, 40, 43, 45, 48, 50],
    hint: "只把三弦慢半音（F→E），其余六弦同正调。",
  },
  {
    id: "qingshang",
    name: "清商调",
    alias: "紧二五七弦 · 1=G",
    noteNames: ["C2", "D♯2", "F2", "G2", "A♯2", "C3", "D♯3"],
    openMidi: [36, 39, 41, 43, 46, 48, 51],
    hint: "把二、五、七弦各紧半音（D→D♯、A→A♯、d→d♯），其余同正调。多用於《秋鸿》等。",
  },
  {
    id: "taicu",
    name: "太簇调",
    alias: "紧三五七弦 · 1=bE",
    noteNames: ["C2", "D2", "F♯2", "G2", "A♯2", "C3", "D♯3"],
    openMidi: [36, 38, 42, 43, 46, 48, 51],
    hint: "把三、五、七弦各紧半音（F→F♯、A→A♯、d→d♯），其余同正调。",
  },
  {
    id: "qiliang",
    name: "凄凉调",
    alias: "紧二五弦 · 1=bB",
    noteNames: ["C2", "D♯2", "F2", "G2", "A♯2", "C3", "D3"],
    openMidi: [36, 39, 41, 43, 46, 48, 50],
    hint: "把二、五弦各紧半音（D→D♯、A→A♯），六、七弦同正调。多用於《秋风词》《长门怨》。",
  },
];

export const DEFAULT_TUNING: TuningId = "zhengdiao";

/** 存储：与基准音一致，存本机 localStorage，不上传。 */
const STORAGE_KEY = "taiyin.tuning.v1";

let cached: TuningId | null = null;
const listeners = new Set<() => void>();

export function isTuningId(v: unknown): v is TuningId {
  return (
    v === "zhengdiao" ||
    v === "ruibin" ||
    v === "manjiao" ||
    v === "qingshang" ||
    v === "taicu" ||
    v === "qiliang"
  );
}

/**
 * 按标识取定弦表项，未知标识退回正调。
 *
 * 参数放宽到 `string | null | undefined`：调用方经常拿的是接口返回值/旧存档字段，
 * 类型上不该逼它们先断言一遍——真正的守卫在 `isTuningId`，这里只保证不返回 undefined。
 */
export function getTuningById(id: TuningId | string | null | undefined): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

/** 弦序（一～七）→ 该定弦下的空弦 MIDI 号；非法弦序返回 null。 */
export function openStringMidi(stringNumber: string | null, tuning: TuningId): number | null {
  if (!stringNumber) return null;
  const index = "一二三四五六七".indexOf(stringNumber);
  if (index < 0) return null;
  return getTuningById(tuning).openMidi[index] ?? null;
}

/** 弦序 → 空弦频率（Hz）；基准音可调，默认 440。 */
export function openStringFrequency(
  stringNumber: string | null,
  tuning: TuningId,
  concertPitch = 440,
): number | null {
  const midi = openStringMidi(stringNumber, tuning);
  if (midi === null) return null;
  return concertPitch * Math.pow(2, (midi - 69) / 12);
}

function readStored(): TuningId {
  if (typeof window === "undefined") return DEFAULT_TUNING;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isTuningId(raw) ? raw : DEFAULT_TUNING;
  } catch {
    return DEFAULT_TUNING;
  }
}

/** 客户端快照（useSyncExternalStore 用）。 */
export function getTuning(): TuningId {
  cached ??= readStored();
  return cached;
}

/** 服务端/水合快照：恒为默认定弦，避免水合不一致。 */
export function getServerTuning(): TuningId {
  return DEFAULT_TUNING;
}

export function setTuning(value: TuningId): TuningId {
  const next = isTuningId(value) ? value : DEFAULT_TUNING;
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 隐私模式：本次会话内仍然生效
  }
  for (const listener of listeners) listener();
  return next;
}

export function subscribeTuning(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅供测试：丢弃缓存。 */
export function resetTuningCache(): void {
  cached = null;
}

/** 实测频率相对目标音的偏差（音分，1200 音分 = 一个八度）。 */
export function centsFrom(freq: number, target: number): number {
  if (!(freq > 0) || !(target > 0)) return 0;
  return 1200 * Math.log2(freq / target);
}

export interface StringMatch {
  /** 弦序（一～七）。 */
  stringNumber: string;
  /** 0 起算的索引。 */
  index: number;
  /** 该弦目标频率。 */
  target: number;
  /** 实测相对该弦的音分偏差（正 = 偏高）。 */
  cents: number;
}

/**
 * 把实测频率匹配到最近的一根空弦。
 *
 * 用音分而不是 Hz 比较：低音区差 3Hz 已经跑调，高音区差 3Hz 几乎听不出来，
 * 直接比绝对频率会把高音弦「抢走」所有读数。
 */
export function nearestString(
  freq: number,
  tuning: TuningId,
  concertPitch = 440,
): StringMatch | null {
  if (!(freq > 0)) return null;
  const t = getTuningById(tuning);
  let best: StringMatch | null = null;
  for (let i = 0; i < t.openMidi.length; i++) {
    const target = concertPitch * Math.pow(2, (t.openMidi[i] - 69) / 12);
    const c = centsFrom(freq, target);
    if (best === null || Math.abs(c) < Math.abs(best.cents)) {
      best = { stringNumber: "一二三四五六七"[i], index: i, target, cents: c };
    }
  }
  return best;
}
