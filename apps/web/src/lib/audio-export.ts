/**
 * 旋律离线渲染为音频文件（WAV）。
 *
 * 用 OfflineAudioContext 跑一遍与实时播放完全相同的 Karplus-Strong 合成，
 * 可选把节拍器点击声一起烘进音轨（带伴奏节拍的练习轨），
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
  /** 采样率，默认 44100。 */
  sampleRate?: number;
}

/**
 * 把乐谱离线渲染成 AudioBuffer。
 * 若 withMetronome 为真，会按 bpm/beatsPerBar 在每个拍点叠加点击声，
 * 强拍（每小节第 1 拍）为低沉重音、其余为清亮轻拍。
 */
export async function renderScoreToBuffer(
  notes: NoteColumn[],
  bpm: number,
  opts: RenderOptions = {},
): Promise<AudioBuffer> {
  const { beatsPerBar = 4, withMetronome = false, sampleRate = 44100 } = opts;
  const beatMs = 60000 / bpm;
  const beatOffset = 0.05; // 与实时播放一样的起拍前导
  const schedule = buildSchedule(notes, beatMs);
  const total = schedule.reduce(
    (end, s) => Math.max(end, s.start + s.duration + tailOf(s.toneType)),
    0,
  );
  const length = Math.max(1, Math.ceil((total + 0.3) * sampleRate));
  const ctx = new OfflineAudioContext(1, length, sampleRate);

  for (const s of schedule) {
    if (s.freq !== null) {
      schedulePluck(ctx, s.freq, s.start, s.duration, s.toneType);
    }
  }

  if (withMetronome && beatsPerBar > 0) {
    const beatSec = beatMs / 1000;
    const totalBeats = Math.ceil((total + 0.2) / beatSec);
    for (let k = 0; k <= totalBeats; k++) {
      const t = beatOffset + k * beatSec;
      if (t < length / sampleRate) {
        scheduleClick(ctx, t, k % beatsPerBar === 0);
      }
    }
  }

  return ctx.startRendering();
}

/** 把 AudioBuffer 编码为 16-bit PCM WAV Blob（多声道交织）。 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  let offset = 0;
  const writeString = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };
  const writeUint32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };
  const writeUint16 = (v: number) => {
    view.setUint16(offset, v, true);
    offset += 2;
  };

  writeString("RIFF");
  writeUint32(36 + dataSize);
  writeString("WAVE");
  writeString("fmt ");
  writeUint32(16);
  writeUint16(1); // PCM
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(sampleRate * blockAlign);
  writeUint16(blockAlign);
  writeUint16(16); // bits per sample
  writeString("data");
  writeUint32(dataSize);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

/** 把渲染结果直接触发浏览器下载。 */
export function downloadWav(buffer: AudioBuffer, filename: string): void {
  const blob = audioBufferToWav(buffer);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
