/**
 * 基频检测（自相关法），给古琴调音用。
 *
 * 为什么不用 FFT 取最大峰：古琴低音弦 C2 只有 65Hz，能量常常集中在二、三次
 * 谐波上，取「最强频点」会稳定地报高八度；自相关看的是一段波形与自身平移后
 * 的重合程度，周期 1/f 在所有谐波上都成立，因此拿到的是基频而不是最响的分音。
 *
 * 归一化：每个 lag 都用两段窗口各自能量的几何平均做分母，得到的相关系数
 * 与音量无关——同一根弦轻拨、重拨，读数一致。没这一步，拨得轻的散音会被判成噪声。
 *
 * 选峰：先把最大相关度找出来，再取「最早达到 0.9×最大」的那个 lag。
 * 若直接取全局最大，遇到 2T、3T 上的峰（相关系数几乎同样高）会报低一个八度。
 */

export interface PitchResult {
  /** 基频（Hz）；判不出时 null。 */
  freq: number | null;
  /** 0–1，周期性可信度。低于阈值即为噪声/杂音。 */
  clarity: number;
  /** 均方根音量（0–1）。 */
  rms: number;
}

export interface DetectOptions {
  /** 搜索下限（Hz），默认 55（低于古琴最低空弦 C2）。 */
  minFreq?: number;
  /** 搜索上限（Hz），默认 1200（覆盖高徽按音与泛音）。 */
  maxFreq?: number;
  /** 低于此 RMS 视为静音，默认 0.004。 */
  silenceRms?: number;
  /** 相关系数下限，低于此值判为噪声，默认 0.6。 */
  clarityThreshold?: number;
}

/** 基频检测：输入一段时域采样（-1..1），返回基频、可信度、音量。 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: DetectOptions = {},
): PitchResult {
  const {
    minFreq = 55,
    maxFreq = 1200,
    silenceRms = 0.004,
    clarityThreshold = 0.6,
  } = options;

  const n = samples.length;
  if (n < 64 || !(sampleRate > 0)) return { freq: null, clarity: 0, rms: 0 };

  // 去直流：麦克风常带一点偏置，不去会把相关度整体压低
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;

  const x = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] - mean;
    x[i] = v;
    energy += v * v;
  }
  const rms = Math.sqrt(energy / n);
  if (rms < silenceRms) return { freq: null, clarity: 0, rms };

  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minFreq));
  if (maxLag <= minLag) return { freq: null, clarity: 0, rms };

  // 前缀能量，供每个 lag 的分母使用（O(1) 取得两段窗口能量）
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i] * x[i];

  const corr = new Float32Array(maxLag + 2);
  let best = 0;
  // 从 lag=1 开始算（而不是 minLag）：高声区真正过零点可能落在 minLag 之前，
  // 只从 minLag 算会漏掉它，导致把「第二个周期」当成基频、整低一个八度。
  for (let lag = 1; lag <= maxLag; lag++) {
    const count = n - lag;
    let dot = 0;
    for (let i = 0; i < count; i++) dot += x[i] * x[i + lag];
    const e1 = prefix[count];
    const e2 = prefix[n] - prefix[lag];
    const denom = Math.sqrt(e1 * e2);
    const r = denom > 0 ? dot / denom : 0;
    corr[lag] = r;
    if (lag >= minLag && r > best) best = r;
  }

  if (best < clarityThreshold) return { freq: null, clarity: best, rms };

  // 跳过「波形还没分开」的起始段：纯音的自相关在 lag 很小时仍接近 1（形状几乎没变），
  // 那里的小 lag 会被误当成周期，直接读成 1kHz 以上的假高音。
  // 找到第一个相关系数转负的位置，可靠的峰一定在它之后。
  let searchFrom = minLag;
  for (let lag = 1; lag <= maxLag; lag++) {
    if (corr[lag] <= 0) {
      searchFrom = Math.max(minLag, lag);
      break;
    }
  }

  // 取最早一个达到 0.9×峰值的 lag，避开 2T/3T 上的次峰（否则会报低八度）
  const accept = best * 0.9;
  let chosen = -1;
  for (let lag = searchFrom; lag <= maxLag; lag++) {
    if (corr[lag] >= accept && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      chosen = lag;
      break;
    }
  }
  if (chosen < 0) return { freq: null, clarity: best, rms };

  // 抛物线插值：lag 是整数，直接取会让高音区音分读数跳得很厉害
  const y0 = corr[chosen - 1];
  const y1 = corr[chosen];
  const y2 = corr[chosen + 1];
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  const refined = chosen + Math.max(-0.5, Math.min(0.5, shift));

  return { freq: sampleRate / refined, clarity: best, rms };
}

/** 生成一段测试用的正弦（含可选谐波），供单测与自检使用。 */
export function toneBuffer(
  freq: number,
  sampleRate: number,
  length: number,
  harmonics: number[] = [1],
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let v = 0;
    for (const [k, gain] of harmonics.entries()) {
      v += gain * Math.sin((2 * Math.PI * freq * (k + 1) * i) / sampleRate);
    }
    out[i] = v;
  }
  return out;
}
