/**
 * 古琴拨弦合成（Karplus-Strong）：噪声脉冲经带阻尼低通的反馈延迟线，
 * 音色接近拨弦而非电子音。
 *
 * ctx 接受任意 BaseAudioContext（实时 AudioContext 或 OfflineAudioContext），
 * 因此「实时播放」与「离线导出音频」共用同一套合成，导出音色与听感一致。
 */
import type { NoteType, PitchSlide } from "./types";

/** 古琴三种基本音技法的合成参数。 */
export const TONE_PROFILE: Record<NoteType, { damping: number; tail: number }> = {
  // 散音（空弦）：浑厚、余音长
  "散": { damping: 0.9975, tail: 2.0 },
  // 按音（按弦走手）：中等余音
  "按": { damping: 0.996, tail: 0.5 },
  // 泛音（徽位）：清亮、短促
  "泛": { damping: 0.99, tail: 0.05 },
};

/**
 * 走手音的起音偏离量（音分）与滑动时长。
 *
 * 绰/注在谱面上只标一个偏旁，但听感上音是从别处「走」过来的：
 * 绰从本位下方约一个全音（200 音分）滑上来，注相反。古琴走手音本来就很快，
 * 0.18 秒足够听出方向，又不会拖成花音；音符更短时按比例缩短。
 */
export const SLIDE_CENTS = 200;
export const SLIDE_SECONDS = 0.18;

/**
 * 单音拨弦合成。缓冲长度 = 该音符时值（最短 0.2s 保证可闻）+ 音色尾长，
 * 主体衰减交给 Karplus-Strong 阻尼（散音长、泛音短），缓冲播完即自动停止。
 * 包络只做起音渐入 + 尾部淡出（防爆音），让音色差异由阻尼体现。
 *
 * `slide` 给出绰/注时走「分数延迟」分支（「急」不会传进来：急弹不改音高），：延迟线长度随时间从偏离音高收到本位，
 * 音高就真的滑过来（不再是画一个偏旁、听一个直音）。
 */
export function schedulePluck(
  ctx: BaseAudioContext,
  freq: number,
  time: number,
  durationSec: number,
  toneType: NoteType | null,
  slide: PitchSlide | null = null,
): AudioBufferSourceNode {
  const sr = ctx.sampleRate;
  const profile = toneType ? TONE_PROFILE[toneType] : TONE_PROFILE["按"];
  const length = Math.floor(sr * (Math.max(durationSec, 0.2) + profile.tail));
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

  if (slide) {
    renderSlide(data, length, sr, freq, slide, profile.damping);
  } else {
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;

    let idx = 0;
    for (let i = 0; i < length; i++) {
      const current = ring[idx];
      ring[idx] = 0.5 * (current + ring[(idx + 1) % period]) * profile.damping;
      const t = i / length;
      // 起音 10ms 渐入 + 尾部 30ms 淡出（防爆音），中间保持 1，衰减交给 KS 阻尼
      const fadeIn = t < 0.01 ? t / 0.01 : 1;
      const fadeOut = t > 1 - 0.03 ? Math.max(0, (1 - t) / 0.03) : 1;
      data[i] = current * fadeIn * fadeOut;
      idx = (idx + 1) % period;
    }
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(time); // 缓冲播完自动停止，无需 src.stop()
  return src;
}

/**
 * 带滑音的 Karplus-Strong（分数延迟 + 线性插值）。
 *
 * 整数周期只能发固定音高；把「读指针落后写指针多少样本」变成时间的函数，
 * 延迟长度连续变化，音高就跟着滑。读取位置落在两个采样之间时线性插值，
 * 否则低音区（C2 周期约 674 样本）一个样本的跳变就接近 3 个音分，会听出阶梯。
 */
function renderSlide(
  data: Float32Array,
  length: number,
  sr: number,
  freq: number,
  slide: PitchSlide,
  damping: number,
): void {
  const ratio = Math.pow(2, SLIDE_CENTS / 1200);
  // 绰：起音在下方 → 起音频率低；注：起音在上方
  const from = slide === "绰" ? freq / ratio : freq * ratio;
  const maxPeriod = Math.ceil(sr / Math.min(from, freq)) + 4;

  const ring = new Float32Array(maxPeriod);
  for (let i = 0; i < maxPeriod; i++) ring[i] = Math.random() * 2 - 1;

  const slideLen = Math.max(1, Math.min(Math.floor(SLIDE_SECONDS * sr), length));
  let write = 0;
  let prev = ring[0];

  for (let i = 0; i < length; i++) {
    // 起音到本位是等比过渡（音分线性），到点后保持本位
    const k = Math.min(1, i / slideLen);
    const f = from * Math.pow(freq / from, k);
    const lag = sr / f;

    let read = write - lag;
    while (read < 0) read += maxPeriod;
    const i0 = Math.floor(read);
    const frac = read - i0;
    const a = ring[i0 % maxPeriod];
    const b = ring[(i0 + 1) % maxPeriod];
    const cur = a + (b - a) * frac;

    // 与上一拍平均 = 一阶低通，这是 KS 衰减的来源
    const lp = 0.5 * (cur + prev);
    prev = cur;
    ring[write] = lp * damping;
    write = (write + 1) % maxPeriod;

    const t = i / length;
    const fadeIn = t < 0.01 ? t / 0.01 : 1;
    const fadeOut = t > 1 - 0.03 ? Math.max(0, (1 - t) / 0.03) : 1;
    data[i] = lp * fadeIn * fadeOut;
  }
}

/**
 * 节拍器点击声（木鱼/板鼓质感）：短促脉冲 + 快速指数衰减，
 * 叠加少量噪声模拟敲击瞬态。强拍（accent）基音低沉、幅度大；弱拍清亮、轻。
 * 同一函数供实时节拍器与离线导出共用，保证听感一致。
 */
export function scheduleClick(
  ctx: BaseAudioContext,
  time: number,
  isAccent: boolean,
): AudioBufferSourceNode {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * 0.04); // 40ms
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  const freq = isAccent ? 1200 : 2000;
  const amp = isAccent ? 0.9 : 0.5;
  const decay = isAccent ? 26 : 34; // 弱拍衰减更快更"脆"
  let seed = isAccent ? 1234 : 5678;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let i = 0; i < length; i++) {
    const t = i / length;
    const env = Math.exp(-t * decay);
    const tone = Math.sin((2 * Math.PI * freq * i) / sr);
    const noise = rand() * 0.4;
    data[i] = (tone + noise) * env * amp;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(time);
  return src;
}
