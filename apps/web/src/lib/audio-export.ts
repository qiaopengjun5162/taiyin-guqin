/**
 * 旋律离线渲染为音频文件（WAV）。
 *
 * 用 OfflineAudioContext 跑一遍与实时播放完全相同的 Karplus-Strong 合成，
 * 可选把节拍器点击声一起烘进音轨（带伴奏节拍的练习轨），
 * 并支持在旋律前加若干小节预备拍（起手前先响几拍找速度），
 * 再把渲染出的 AudioBuffer 编码为 16-bit PCM WAV（无损、无需额外依赖）。
 * MP3 需引入编码库，WAV 已足够作为可分享/二次剪辑的母带。
 */
import type { NoteColumn, NoteType } from "./types";
import { buildSchedule } from "./player";
import { schedulePluck, scheduleClick, TONE_PROFILE } from "./audio-synth";

function tailOf(toneType: NoteType | null): number {
  return toneType ? TONE_PROFILE[toneType].tail : TONE_PROFILE["按"].tail;
}

export interface RenderOptions {
  /** 拍号（每小节拍数），用于烘入节拍点击声。 */
  beatsPerBar?: number;
  /** 是否把节拍器点击声烘进音轨，默认 false。 */
  withMetronome?: boolean;
  /** 旋律前预备拍小节数（起手前先响几拍找速度），默认 0。 */
  leadInBars?: number;
  /** 采样率，默认 44100。 */
  sampleRate?: number;
}

/**
 * 把乐谱离线渲染成 AudioBuffer。
 * 若 withMetronome 为真，会按 bpm/拍号在每个拍点叠加点击声，
 * 强拍（每小节第 1 拍）为低沉重音、其余为清亮轻拍。
 * 若 leadInBars > 0，旋律整体推迟对应小节数，预备拍区只响节拍、不响旋律。
 */
export async function renderScoreToBuffer(
  notes: NoteColumn[],
  bpm: number,
  opts: RenderOptions = {},
): Promise<AudioBuffer> {
  const { beatsPerBar = 4, withMetronome = false, leadInBars = 0, sampleRate = 44100 } = opts;
  const beatMs = 60000 / bpm;
  const beatSec = beatMs / 1000;
  const beatOffset = 0.05; // 与实时播放一样的起拍前导
  const leadInBeats = leadInBars * beatsPerBar;
  const startOffset = leadInBeats * beatSec;
  const schedule = buildSchedule(notes, beatMs);
  const total = schedule.reduce(
    (end, s) => Math.max(end, s.start + s.duration + tailOf(s.toneType)),
    0,
  );
  const length = Math.max(1, Math.ceil((startOffset + total + 0.3) * sampleRate));
  const ctx = new OfflineAudioContext(1, length, sampleRate);

  for (const s of schedule) {
    if (s.freq !== null) {
      schedulePluck(ctx, s.freq, s.start + startOffset, s.duration, s.toneType);
    }
  }

  if (withMetronome && beatsPerBar > 0) {
    const totalBeats = Math.ceil((total + 0.2) / beatSec) + leadInBeats;
    for (let k = 0; k <= totalBeats; k++) {
      const t = beatOffset + k * beatSec;
      if (t < length / sampleRate) {
        scheduleClick(ctx, t, k % beatsPerBar === 0);
      }
    }
  }

  return ctx.startRendering();
}

/**
 * AudioBuffer 编码为 16-bit PCM WAV（多声道按帧交错）。
 * WAV 容器 44 字节头 + 16-bit 样本；无损、通用、可二次剪辑。
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * numCh * bytesPerSample;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * bytesPerSample, true); // byte rate
  view.setUint16(32, numCh * bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  // 各声道交错写入
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return ab;
}

/** 触发浏览器下载一个 ArrayBuffer 为 .wav 文件。 */
export function downloadWav(buffer: AudioBuffer, filename: string): void {
  const ab = audioBufferToWav(buffer);
  const blob = new Blob([ab], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".wav") ? filename : `${filename}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
