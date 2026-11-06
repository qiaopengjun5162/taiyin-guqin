/**
 * 跟弹判定：用户自己弹，我们听。
 *
 * ## 为什么不能放参考音
 *
 * 最自然的做法是「应用放一遍，你跟着弹」，但那样麦克风会同时收到参考音，
 * 判定结果必然是满分——**自己给自己打分**。所以这条链路里播放器必须静音，
 * 只留谱面高亮和预备拍。代价是用户得先听过旋律才会弹，收益是分数是真的。
 *
 * ## 为什么按「拨弦能量突增」切音，而不是按静音切
 *
 * 古琴散音能响三五秒，下一个音起来时上一个还在衰减，中间**没有静音**。
 * 拿「静音」当分界会把整句认成一个长音。每次拨弦都是一次新的激励，
 * 音量曲线上一定有个台阶——按台阶切才切得开。这也顺带解决了走手音：
 * 绰/注期间音量是平的，不会被误切成两个音。
 *
 * ## 为什么先做全局对齐再配对
 *
 * 跟弹时人几乎不会踩在预备拍的最后一下上，普遍晚 0.1–0.3 秒。
 * 不校正的话，第二三个音就会跳到「下一个音」的配对窗口里，越往后越错，
 * 最后报出一串莫名其妙的偏差——看起来像用户弹错了，其实是判定器错位了。
 * 校正量只取中位数并限幅，且**不参与通过判据**：晚一点不扣分，但会说给你听。
 */

import type { ScheduledNote } from "./player";

/** 麦克风采样的一帧。`t` 是相对起手的秒数。 */
export interface PitchSample {
  t: number;
  freq: number | null;
  clarity: number;
  rms: number;
}

/** 从采样里切出来的一个音。 */
export interface DetectedNote {
  /** 起音时刻（秒）。 */
  start: number;
  /** 代表音高（该音有效帧的中位数）。 */
  freq: number;
  /** 持续时长（秒）。 */
  duration: number;
}

/** 谱上要求弹的一个音。 */
export interface ExpectedNote {
  /** 在原始音符数组里的下标，用来回指谱面。 */
  index: number;
  /** 预期起音时刻（秒，相对句首）。 */
  start: number;
  duration: number;
  freq: number;
  /** 该音带绰/注：音高本来就在滑，不能按固定音分卡它。 */
  slide: boolean;
}

export type Verdict = "ok" | "sharp" | "flat" | "wrong" | "missed";

export interface JudgedNote {
  expected: ExpectedNote;
  detected: DetectedNote | null;
  /** 偏差音分，正=偏高，负=偏低；没检出为 null。 */
  cents: number | null;
  /** 起音时刻偏差（秒），正=晚了；没检出为 null。 */
  onsetOffset: number | null;
  verdict: Verdict;
}

export interface JudgeResult {
  notes: JudgedNote[];
  /** 配对上的音数。 */
  matched: number;
  /** 谱上有、没听见的。 */
  missed: number;
  /** 听见了但谱上没要求（重复拨弦、试音）。 */
  extra: number;
  /** 弹准的比例，分母是**全部期望音**——漏掉的算没弹对。 */
  pitchOkRatio: number;
  /** 整段相对拍子的中位偏移（秒），正=整体偏晚。 */
  offset: number;
  passed: boolean;
  /** 一句可以直接显示给人看的话。 */
  summary: string;
}

export const SEGMENT_DEFAULTS = {
  /** 相关系数下限，低于此值当噪声。 */
  minClarity: 0.55,
  /** 低于此 RMS 当静音。 */
  minRms: 0.004,
  /** 相对前一有效帧涨这么多倍，算一次新的拨弦。 */
  onsetRatio: 1.6,
  /** 绝对增量下限：极弱的地方 1.6 倍可能只是抖动。 */
  onsetDelta: 0.004,
  /** 断续超过这么久，这个音就结束了。 */
  gapSeconds: 0.12,
  /** 太短的段当杂音丢掉（指甲刮弦、椅子响）。 */
  minDurationSeconds: 0.05,
  /** 两个音的起点至少隔这么久，防止音量抖动被切成一串碎音。 */
  minNoteSeconds: 0.07,
} as const;

export const JUDGE_DEFAULTS = {
  /** 音准容差（音分）。古琴按音本来就常带微分，卡 50 已接近「调音器级」。 */
  toleranceCents: 50,
  /** 带绰/注的音放宽到这么多：它本来就在滑，卡死等于判它错。 */
  slideToleranceCents: 250,
  /** 偏差超过这个就当按错徽位/错弦，而不是「没调准」。 */
  wrongCents: 900,
  /** 通过线：弹准的比例。 */
  passRatio: 0.8,
  /** 允许漏几个音。整句十来个音，漏一两个是手滑，不是不会。 */
  maxMissed: 2,
  /** 全局对齐的最大校正量（秒）。超过说明不是「晚了一点」，是真的弹错了。 */
  maxOffsetSeconds: 0.5,
} as const;

/**
 * 从播放排程里取出某一段音，转成判定用的期望序列。
 *
 * 静默音（`freq === null`，休止或没标简谱）不参与判定：它们本来就不该有声音，
 * 把它们算成「漏弹」，用户会莫名其妙地不及格。
 */
export function expectedFromSchedule(
  schedule: readonly ScheduledNote[],
  from: number,
  to: number,
): ExpectedNote[] {
  const base = schedule[from]?.start ?? 0;
  const out: ExpectedNote[] = [];
  for (let i = from; i <= to && i < schedule.length; i++) {
    const note = schedule[i];
    if (note.freq === null) continue;
    out.push({
      index: i,
      start: note.start - base,
      duration: note.duration,
      freq: note.freq,
      slide: note.slide !== null && note.slide !== undefined,
    });
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 把采样流切成一个个音。
 *
 * 只用音量台阶与静音断续两种信号，不看音高跳变——同弦上相邻两徽只差一百音分，
 * 按音高切会把它们误判成两个音；而每次拨弦的音量台阶一定存在。
 */
export function segmentNotes(
  samples: readonly PitchSample[],
  options: Partial<typeof SEGMENT_DEFAULTS> = {},
): DetectedNote[] {
  const opt = { ...SEGMENT_DEFAULTS, ...options };
  const out: DetectedNote[] = [];

  let current: { start: number; freqs: number[]; lastT: number } | null = null;

  const flush = () => {
    if (!current) return;
    if (current.lastT - current.start >= opt.minDurationSeconds && current.freqs.length > 0) {
      out.push({
        start: current.start,
        freq: median(current.freqs),
        duration: current.lastT - current.start,
      });
    }
    current = null;
  };

  let lastRms = 0;

  for (const sample of samples) {
    const freq = sample.freq;

    if (freq === null || sample.clarity < opt.minClarity || sample.rms < opt.minRms) {
      // 断续够久就收尾；不够久只是掉了一两帧，继续攒着
      if (current && sample.t - current.lastT > opt.gapSeconds) flush();
      continue;
    }

    if (current) {
      const gap = sample.t - current.lastT;
      const stepped = sample.rms >= lastRms * opt.onsetRatio && sample.rms - lastRms >= opt.onsetDelta;
      const separated = sample.t - current.start >= opt.minNoteSeconds;
      if (gap > opt.gapSeconds || (stepped && separated)) flush();
    }

    if (!current) current = { start: sample.t, freqs: [], lastT: sample.t };
    current.freqs.push(freq);
    current.lastT = sample.t;
    lastRms = sample.rms;
  }
  flush();

  return out;
}

/** 两个频率之间的音分差。 */
export function centsBetween(freq: number, reference: number): number {
  if (!(freq > 0) || !(reference > 0)) return 0;
  return 1200 * Math.log2(freq / reference);
}

/** 一次配对尝试的结果。 */
interface Pairing {
  pairs: { expected: ExpectedNote; detected: DetectedNote | null }[];
  offset: number;
}

/**
 * 把期望音与实际听到的音一一配对。
 *
 * `shift` 会把整段期望音轴的起点往后挪，用于校正「整体晚了一点」。
 * 配对时要求单调：后一个期望音不能被配到前一个已用掉的实际音上，
 * 否则一次手滑会让后面整段错位。
 */
function pair(expected: readonly ExpectedNote[], detected: readonly DetectedNote[], shift: number): Pairing {
  const used = new Array<boolean>(detected.length).fill(false);
  const pairs: Pairing["pairs"] = [];

  for (const note of expected) {
    const target = note.start + shift;
    // 窗口跟着时值走：长音允许偏得多一点，短音严一些；但有上下限，
    // 否则连续十六分音符的窗口会互相重叠，配出的对是随机的。
    const window = Math.min(0.6, Math.max(0.15, note.duration * 0.5));
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < detected.length; i++) {
      if (used[i]) continue;
      const dist = Math.abs(detected[i].start - target);
      if (dist <= window && dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    if (best >= 0) used[best] = true;
    pairs.push({ expected: note, detected: best >= 0 ? detected[best] : null });
  }

  return { pairs, offset: shift };
}

/** 用第一次配对的中位偏差估计「整体晚/早了多少」。 */
function estimateOffset(pairs: Pairing["pairs"]): number {
  const deltas = pairs
    .filter((p) => p.detected !== null)
    .map((p) => p.detected!.start - p.expected.start);
  return deltas.length === 0 ? 0 : median(deltas);
}

function describe(
  notes: readonly JudgedNote[],
  matched: number,
  missed: number,
  extra: number,
  offset: number,
  passed: boolean,
  opts: { toleranceCents: number },
): string {
  if (matched === 0) {
    return missed > 0
      ? "这段没听到声音。检查麦克风是否被静音，或者离琴太远——面板上的电平条要跟着你弹跳起来。"
      : "谱上没有可判定的音。";
  }

  const off = notes.filter((n) => n.verdict === "sharp" || n.verdict === "flat");
  const wrong = notes.filter((n) => n.verdict === "wrong");

  const parts: string[] = [];
  parts.push(`${notes.length} 个音，${notes.length - missed - off.length - wrong.length} 个准`);

  if (wrong.length > 0) {
    // 按错徽位是硬错，要单独说，不然会被当成「没调准」糊过去
    parts.push(`${wrong.length} 个按错位置（第 ${wrong.map((n) => n.expected.index + 1).join("、")} 音）`);
  }
  if (off.length > 0) {
    const avg = Math.round(
      off.reduce((sum, n) => sum + Math.abs(n.cents ?? 0), 0) / off.length,
    );
    const dir = off.filter((n) => n.cents! > 0).length >= off.length / 2 ? "偏高" : "偏低";
    parts.push(`${off.length} 个${dir}约 ${avg} 音分`);
  }
  if (missed > 0) parts.push(`漏 ${missed} 个`);

  let tail = "";
  if (passed) {
    tail = " · 这一句过了";
  } else if (offset > 0.18) {
    tail = ` · 整体比拍子晚 ${offset.toFixed(2)} 秒，先跟着预备拍数一遍再弹`;
  } else if (off.length > 0 && Math.abs(median(off.map((n) => n.cents ?? 0))) > opts.toleranceCents) {
    tail = " · 整句同向偏，先校一下基准音或定弦";
  } else if (extra > missed) {
    tail = " · 多弹了几个音，是不是重复拨弦了";
  } else {
    tail = " · 慢一档再来一遍";
  }

  return parts.join("，") + tail;
}

/**
 * 判定一次跟弹。
 *
 * 两遍配对：第一遍用宽窗口找出大致对齐关系，取中位偏移，第二遍按校正后的
 * 时间轴重新配。只校正一次，不做迭代——迭代会把「真的抢拍」也吃成「对齐了」。
 */
export function judgeTake(
  expected: readonly ExpectedNote[],
  detected: readonly DetectedNote[],
  options: Partial<typeof JUDGE_DEFAULTS> = {},
): JudgeResult {
  const opt = { ...JUDGE_DEFAULTS, ...options };

  if (expected.length === 0) {
    return {
      notes: [],
      matched: 0,
      missed: 0,
      extra: detected.length,
      pitchOkRatio: 0,
      offset: 0,
      passed: false,
      summary: describe([], 0, 0, detected.length, 0, false, opt),
    };
  }

  const first = pair(expected, detected, 0);
  const rawOffset = estimateOffset(first.pairs);
  const shift =
    Math.abs(rawOffset) > 0.05 && Math.abs(rawOffset) <= opt.maxOffsetSeconds ? rawOffset : 0;
  const final = shift === 0 ? first : pair(expected, detected, shift);

  let matched = 0;
  let missed = 0;
  let ok = 0;

  const notes: JudgedNote[] = final.pairs.map(({ expected: e, detected: d }) => {
    if (!d) {
      missed++;
      return { expected: e, detected: null, cents: null, onsetOffset: null, verdict: "missed" };
    }
    matched++;
    const cents = centsBetween(d.freq, e.freq);
    const tolerance = e.slide ? opt.slideToleranceCents : opt.toleranceCents;
    let verdict: Verdict;
    if (Math.abs(cents) >= opt.wrongCents) verdict = "wrong";
    else if (Math.abs(cents) <= tolerance) verdict = "ok";
    else verdict = cents > 0 ? "sharp" : "flat";
    if (verdict === "ok") ok++;
    return {
      expected: e,
      detected: d,
      cents,
      onsetOffset: d.start - (e.start + shift),
      verdict,
    };
  });

  const extra = Math.max(0, detected.length - matched);
  const pitchOkRatio = ok / expected.length;
  const passed = pitchOkRatio >= opt.passRatio && missed <= opt.maxMissed;

  return {
    notes,
    matched,
    missed,
    extra,
    pitchOkRatio,
    offset: shift,
    passed,
    summary: describe(notes, matched, missed, extra, shift, passed, opt),
  };
}
