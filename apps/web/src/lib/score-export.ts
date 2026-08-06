import type { NoteColumn } from "./types";
import { durationToBeats, jianziToText } from "@/lib/jianzi";

export interface TextExportOptions {
  /** 曲谱标题，会放在文件第一行。 */
  title?: string;
  /** 每小节拍数，用于插入小节线分隔符。 */
  beatsPerBar?: number;
}

function jianpuToAscii(number: string | null, octave: string): string {
  if (!number) return "-";
  if (octave === "·") return `${number}·`;
  if (octave === ",") return `${number},`;
  return number;
}

/**
 * 将 NoteColumn[] 格式化为纯文本对照谱。
 *
 * 输出两行：第一行简谱，第二行减字。小节之间插入 `|` 分隔。
 */
export function formatScoreAsText(
  notes: NoteColumn[],
  options: TextExportOptions = {},
): string {
  const { title, beatsPerBar = 4 } = options;
  const lines: string[] = [];
  if (title) {
    lines.push(`# ${title}`);
    lines.push("");
  }

  const jianpuLine: string[] = [];
  const jianziLine: string[] = [];
  let acc = 0.0;

  for (const [index, note] of notes.entries()) {
    const beats = durationToBeats(note.duration, note.jianpuDot);
    if (acc > 0 && acc + beats > beatsPerBar) {
      jianpuLine.push("|");
      jianziLine.push("|");
      acc = 0.0;
    }

    const jianpuCell = jianpuToAscii(note.jianpuNumber, note.jianpuOctave).padEnd(4);
    const jianziCell = jianziToText(note.jianzi).padEnd(4);

    jianpuLine.push(jianpuCell);
    jianziLine.push(jianziCell);

    acc += beats;
    if (acc >= beatsPerBar) {
      // 与 ScoreView 一致：最后一音后不加小节线
      if (index < notes.length - 1) {
        jianpuLine.push("|");
        jianziLine.push("|");
      }
      acc = 0.0;
    }
  }

  lines.push(jianpuLine.join(" "));
  lines.push(jianziLine.join(" "));
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
