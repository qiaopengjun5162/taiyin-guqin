/**
 * 古琴拨弦合成（Karplus-Strong）：噪声脉冲经带阻尼低通的反馈延迟线，
 * 音色接近拨弦而非电子音。
 *
 * ctx 接受任意 BaseAudioContext（实时 AudioContext 或 OfflineAudioContext），
 * 因此「实时播放」与「离线导出音频」共用同一套合成，导出音色与听感一致。
 */
import type { NoteType } from "./types";

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
 * 单音拨弦合成。缓冲长度 = 该音符时值（最短 0.2s 保证可闻）+ 音色尾长，
 * 主体衰减交给 Karplus-Strong 阻尼（散音长、泛音短），缓冲播完即自动停止。
 * 包络只做起音渐入 + 尾部淡出（防爆音），让音色差异由阻尼体现。
 */
export function schedulePluck(
  ctx: BaseAudioContext,
  freq: number,
  time: number,
  durationSec: number,
  toneType: NoteType | null,
): AudioBufferSourceNode {
  const sr = ctx.sampleRate;
  const period = Math.max(2, Math.round(sr / freq));
  const profile = toneType ? TONE_PROFILE[toneType] : TONE_PROFILE["按"];
  const length = Math.floor(sr * (Math.max(durationSec, 0.2) + profile.tail));
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

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

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(time); // 缓冲播完自动停止，无需 src.stop()
  return src;
}
