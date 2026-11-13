import type { Duration, NoteColumn } from "./types";
import { durationToBeats, jianziToText } from "@/lib/jianzi";

export interface TextExportOptions {
  /** 曲谱标题，会放在文件第一行。 */
  title?: string;
  /** 每小节拍数，用于插入小节线分隔符。 */
  beatsPerBar?: number;
  /**
   * 定弦（显示名，如「蕤宾调 · 紧五弦 · 1=B♭」）。
   *
   * 导出的文本是要拿给别人看的：只给减字不给定弦，对方按自己的默认正调去弹，
   * 紧五弦、慢三弦那几根弦就整体差半个音。所以定弦要跟着标题一起落纸。
   */
  tuning?: string;
  /**
   * 每音的减字码（与 notes 等长，编不出码的位置是 null）。
   *
   * 包松平那套输入法的落点是「每个字都有编码，于是能进任何文本」；
   * 减字那一行离开我们的字体就是一堆生僻字，码这一行却是谁都能看、能照着敲的。
   * 给了就多输出一行编码。
   */
  codes?: (string | null)[];
  /**
   * 给每个码标上时值（`ad9g4:8.`），让导出的文本能被「减字码入谱」原样读回。
   *
   * 光有码没有时值，粘回去就成了一片四分音符——音高对了，曲子还是散了。
   * 所以时值跟着码走；不标时保持旧格式（只有码），原有的对照谱不受影响。
   */
  annotateRhythm?: boolean;
}

/**
 * 时值 → 码尾数字。
 *
 * 与 Rust `jianzi_code::DURATION_TOKENS` 是同一张表（全 1 / 二分 2 / 四分 4 /
 * 八分 8 / 十六分 16）。两边都要改的时候记得一起改：`verify-wasm.mjs`
 * 逐个数字验的是 Rust 那一侧，`score-export` 的测试验的是这一侧。
 */
const DURATION_CODE: Record<Duration, string> = {
  全: "1",
  二分: "2",
  四分: "4",
  八分: "8",
  十六分: "16",
};

/**
 * 一行里的一个编码格：`ad9g4` 或带节奏的 `ad9g4:8.`。
 *
 * 休止符没有减字码，用 `r` 占位——不写出来，粘回时那一拍就凭空消失了。
 */
function codeCell(code: string | null, note: NoteColumn, annotate: boolean): string {
  if (!annotate) return code ?? "-";
  const head = note.jianpuNumber === "0" ? "r" : code;
  if (!head) return "-";
  return `${head}:${DURATION_CODE[note.duration]}${note.jianpuDot ? "." : ""}`;
}

function jianpuToAscii(number: string | null, octave: string): string {
  if (!number) return "-";
  if (octave === "··") return `${number}··`;
  if (octave === "·") return `${number}·`;
  if (octave === ",,") return `${number},,`;
  if (octave === ",") return `${number},`;
  return number;
}

/**
 * 将 NoteColumn[] 格式化为纯文本对照谱。
 *
 * 固定两行（简谱、减字），有歌词再加一行歌词，给了码再加一行编码；
 * 小节之间插入 `|` 分隔。四行齐全时就是纸谱上「简谱 / 减字 / 歌词」的对照样式，
 * 多出来的编码行则是给没有装字体的人看的——照着敲就能把字打出来。
 */
export function formatScoreAsText(
  notes: NoteColumn[],
  options: TextExportOptions = {},
): string {
  const { title, beatsPerBar = 4, tuning, codes, annotateRhythm = false } = options;
  const lines: string[] = [];
  if (title || tuning) {
    if (title) lines.push(`# ${title}`);
    if (tuning) lines.push(`定弦：${tuning}`);
    lines.push("");
  }

  const hasLyric = notes.some((n) => (n.lyric ?? "").trim() !== "");
  const hasCodes = Array.isArray(codes) && codes.length > 0;

  const jianpuLine: string[] = [];
  const jianziLine: string[] = [];
  const lyricLine: string[] = [];
  const codeLine: string[] = [];

  /** 每一行都要在同一处断小节，否则上下对不齐。 */
  const pushBar = () => {
    jianpuLine.push("|");
    jianziLine.push("|");
    lyricLine.push("|");
    codeLine.push("|");
  };

  let acc = 0.0;

  for (const [index, note] of notes.entries()) {
    const beats = durationToBeats(note.duration, note.jianpuDot);
    if (acc > 0 && acc + beats > beatsPerBar) {
      pushBar();
      acc = 0.0;
    }

    jianpuLine.push(jianpuToAscii(note.jianpuNumber, note.jianpuOctave).padEnd(4));
    // 结构记号是谱面层标记、不在减字四宫格内；导出时挂到减字串后面，
    // 避免「导出再读回」把少息/再作这类记号无声吞掉（它本就不在减字码体系里）。
    const mark = note.jianzi.structureMark;
    jianziLine.push(`${jianziToText(note.jianzi)}${mark ? `〔${mark}〕` : ""}`.padEnd(4));
    lyricLine.push((note.lyric ?? "").trim().padEnd(4));
    codeLine.push(codeCell(codes?.[index] ?? null, note, annotateRhythm).padEnd(4));

    acc += beats;
    if (acc >= beatsPerBar) {
      // 与 ScoreView 一致：最后一音后不加小节线
      if (index < notes.length - 1) pushBar();
      acc = 0.0;
    }
  }

  lines.push(jianpuLine.join(" ").trimEnd());
  lines.push(jianziLine.join(" ").trimEnd());
  if (hasLyric) lines.push(lyricLine.join(" ").trimEnd());
  if (hasCodes) lines.push(codeLine.join(" ").trimEnd());
  lines.push("");
  lines.push(`共 ${notes.length} 音`);

  return lines.join("\n");
}

/** 触发浏览器下载一个文本文件。 */
export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
