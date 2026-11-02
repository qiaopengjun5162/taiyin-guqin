/**
 * 减字谱 / 简谱 → 标准 MIDI 文件（SMF format 0）。
 *
 * 为什么要有它：WAV 是「声音」、PNG/SVG 是「图片」，都不是「乐谱数据」。
 * 做了半天谱子却没法拿到别的软件里（打谱、DAW 加混响、AI 歌声合成、
 * 发给琴友做伴奏），等于被锁在本站。MIDI 是最小代价的解锁方式：
 * 一个文件，任何打谱/编曲软件都能打开。
 *
 * 诚实的边界（写进文件注释里，不藏）：
 * - 音高与播放同源：**谱字优先**（音色 + 弦序 + 徽位 → 定弦下的实际音高），
 *   只有简谱、没有谱字的音才按简谱推算（1 = F2，正调三弦）。
 * - 音高按十二平均律取整：古琴徽位是纯律，与平均律最多差十几音分，
 *   记进 MIDI 只能就近取整。
 * - MIDI 的音高号固定按 A4=440 的等分律编号，本机「基准音」设置（例如
 *   415Hz）只影响播放与 WAV，**不会**改变本文件；需要偏低整床时在
 *   编曲软件里整体移调即可。
 * - 减字里的绰注、吟猱、撞、进复等手法 MIDI 表达不了，只保留触发点。
 */
import type { NoteColumn, NoteType } from "./types";
import { durationToBeats } from "./jianzi";
import { columnMidi } from "./player";
import { DEFAULT_TUNING, type TuningId } from "./tuning";

/** 每四分音符的时间片数（ticks per quarter note）。480 可整除三连音与十六分。 */
export const TICKS_PER_QUARTER = 480;

/** 按音技法给的力度：散音最响（空弦全琴共鸣），泛音最轻（轻触即起）。 */
const VELOCITY: Record<NoteType, number> = {
  散: 96,
  按: 88,
  泛: 76,
};
const DEFAULT_VELOCITY = 88;

/** GM 音色号（0 起算）：106 = Koto（十三弦筝），是目前 GM 里最接近弹拨长弦的音色。 */
export const GM_KOTO = 106;

export interface MidiExportOptions {
  /** 轨道名（曲名）。写入 UTF-8 文本事件。 */
  title?: string;
  /** 每分钟四分音符数，写入 tempo 事件。 */
  bpm?: number;
  /** 每小节拍数，写入拍号事件（分母固定为 4）。 */
  beatsPerBar?: number;
  /** GM 音色号（0 起算），默认 106 Koto。 */
  program?: number;
  /** 发音占时值的比例（0–1），留一点点缝更接近拨弦；默认 0.9。 */
  gate?: number;
  /** 通道（0–15），默认 0。 */
  channel?: number;
  /** 仅用于写入文件注释：告知 MIDI 不随本机基准音变化。 */
  concertPitch?: number;
  /** 定弦，默认正调；决定谱字对应的实际音高。 */
  tuning?: TuningId;
}

interface RawEvent {
  tick: number;
  /** 同一 tick 内的先后：0 = 文本，1 = 关音，2 = 开音（先关后开，避免粘连）。 */
  rank: number;
  bytes: number[];
}

/** 变长数量（VLQ）：MIDI 的 delta-time 编码。 */
function vlq(value: number): number[] {
  const out = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

function textBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

function meta(type: number, payload: number[]): number[] {
  return [0xff, type, ...vlq(payload.length), ...payload];
}

function metaText(type: number, text: string): number[] {
  return meta(type, textBytes(text));
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function ascii(s: string): string {
  // 文件注释走纯 ASCII，避免个别老软件把 UTF-8 文本事件读成乱码
  return s.replace(/[^\x20-\x7e]/g, "");
}

/**
 * 把乐谱编码为 SMF format 0 字节流。
 *
 * 时值按 `durationToBeats` 换算成 ticks；休止/无简谱的音只推进时间、不发音符，
 * 因此谱面节奏与播放完全对齐。带歌词的音会在开音前写一个 lyric 文本事件。
 */
export function scoreToMidi(
  notes: NoteColumn[],
  options: MidiExportOptions = {},
): Uint8Array {
  const {
    title = "taiyin-score",
    bpm = 60,
    beatsPerBar = 4,
    program = GM_KOTO,
    gate = 0.9,
    channel = 0,
    concertPitch = 440,
    tuning = DEFAULT_TUNING,
  } = options;

  const ch = Math.max(0, Math.min(15, Math.round(channel)));
  const events: RawEvent[] = [];
  const gateRatio = Math.min(1, Math.max(0.01, gate));

  let beatsCursor = 0;
  let tickCursor = 0;

  for (const note of notes) {
    const beats = durationToBeats(note.duration, note.jianpuDot);
    beatsCursor += beats;
    const endTick = Math.round(beatsCursor * TICKS_PER_QUARTER);
    const span = endTick - tickCursor;

    const midi = columnMidi(note, tuning);
    if (midi !== null && span > 0) {
      const velocity = note.jianzi.toneType ? VELOCITY[note.jianzi.toneType] : DEFAULT_VELOCITY;
      // 至少 1 tick 的发音，避免极短音符被 gate 抹成 0
      const held = Math.max(1, Math.min(span, Math.round(span * gateRatio)));

      if (note.lyric) {
        events.push({ tick: tickCursor, rank: 0, bytes: metaText(0x05, note.lyric) });
      }
      events.push({ tick: tickCursor, rank: 2, bytes: [0x90 | ch, midi, velocity] });
      events.push({ tick: tickCursor + held, rank: 1, bytes: [0x80 | ch, midi, 0x40] });
    }

    tickCursor = endTick;
  }

  // 同 tick 先按 rank，再按写入顺序（Array.prototype.sort 在现代引擎稳定）
  events.sort((a, b) => a.tick - b.tick || a.rank - b.rank);

  const body: number[] = [];
  // 轨道名
  body.push(...vlq(0), ...metaText(0x03, title));
  // 文件注释：把「推定音高 / 不随基准音变」写进文件本身，而不是只写在网页上
  body.push(
    ...vlq(0),
    ...metaText(
      0x01,
      ascii(
        `Taiyin Guqin jianzipu. Pitches come from the fingering (string/hui) under the ` +
          `score tuning (equal temperament, A4=440); jianpu fallback is 1=C4. ` +
          `Local concert pitch ${concertPitch}Hz affects playback only, not this file. ` +
          `Ornaments (chuo/zhu/yin-nao) are not represented.`,
      ),
    ),
  );
  // tempo
  const usPerQuarter = Math.max(1, Math.round(60_000_000 / Math.max(1, bpm)));
  body.push(
    ...vlq(0),
    ...meta(0x51, [(usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff]),
  );
  // 拍号：分母固定 4 → dd = 2（2^2）
  const beats = Math.max(1, Math.min(32, Math.round(beatsPerBar)));
  body.push(
    ...vlq(0),
    ...meta(0x58, [beats, 2, 24, 8]),
  );
  // 音色（必须展开成两个字节：漏了展开会被当成一个「数组元素」写进 Uint8Array，
  // 静默变成 0，整条轨从此错位两格——测试里就是被这个坑住的）
  body.push(...vlq(0), 0xc0 | ch, Math.max(0, Math.min(127, Math.round(program))));

  let last = 0;
  for (const ev of events) {
    const delta = ev.tick - last;
    if (delta < 0) continue;
    body.push(...vlq(delta), ...ev.bytes);
    last = ev.tick;
  }
  // 曲终
  body.push(...vlq(0), ...meta(0x2f, []));

  const out: number[] = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...u32(6),
    ...u16(0), // format 0：单轨，最通用
    ...u16(1), // 1 条轨道
    ...u16(TICKS_PER_QUARTER),
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    ...u32(body.length),
    ...body,
  ];
  return Uint8Array.from(out);
}

/** 触发浏览器下载 .mid 文件。 */
export function downloadMidi(bytes: Uint8Array, filename: string): void {
  // 复制到独立 ArrayBuffer，避免把更大的底层 buffer 一起带走
  const ab = bytes.slice().buffer;
  const blob = new Blob([ab], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".mid") ? filename : `${filename}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
