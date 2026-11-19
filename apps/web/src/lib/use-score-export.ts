/**
 * 曲谱导出 —— 从 `page.tsx` 拆出来的一个关注点。
 *
 * 五条导出通道（PNG / SVG / WAV / MIDI / 文本）各有各的失败方式，
 * 但都共享同一组上下文（曲谱、标题、拍号、速度、定弦、基准音）。
 * 散在页面里时，任何一条要加参数都得在 2000 行里找齐全部六处。
 *
 * ## 几个刻意的取舍
 *
 * - **文本导出在编码失败时降级，不整体失败**：减字那一行离开字体就是一堆生僻字，
 *   码是给「没有字体的人也能照着敲」的备份。引擎没起来时退回不带码的三行，
 *   总比点了没反应好。
 * - **PDF 走浏览器原生打印**：jsPDF 这类库没法嵌入 MB 级中文字库，
 *   而浏览器打印到 PDF 会自动子集化嵌入字形，减字才能正确显示且矢量无损。
 * - **WAV/MIDI 空谱直接返回**：不弹错误。空谱时这两个按钮本来就是禁用的，
 *   走到这里只可能是程序路径，不该打扰用户。
 */

import { useCallback, useState, type RefObject } from "react";
import { encodeJianziBatch } from "./taiyin-wasm";
import { renderScoreToBuffer, downloadWav } from "./audio-export";
import { scoreToMidi, downloadMidi } from "./midi-export";
import { formatScoreAsText, downloadTextFile } from "./score-export";
import { useExportImage } from "./use-export-image";
import type { NoteColumn } from "./types";
import type { TuningId } from "./tuning";

interface Options {
  score: NoteColumn[];
  scoreTitle: string;
  bpm: number;
  beatsPerBar: number;
  concertPitch: number;
  tuning: TuningId;
  /** 定弦显示名（名字 + 别名/宫音），导出文本与页脚共用同一份写法。 */
  tuningLabel: string;
  /** 导出音频时是否带节拍器（与播放联动设置同一个开关）。 */
  linkMetronome: boolean;
  /** 导出音频是否含预备拍。 */
  exportWithCountIn: boolean;
  /** 截图容器（PNG/SVG 用）。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 失败提示出口，由页面提供（页面有自己的提示条与自动消失计时）。 */
  onError: (message: string) => void;
}

export function useScoreExport({
  score,
  scoreTitle,
  bpm,
  beatsPerBar,
  concertPitch,
  tuning,
  tuningLabel,
  linkMetronome,
  exportWithCountIn,
  containerRef,
  onError,
}: Options) {
  const [isExportingAudio, setIsExportingAudio] = useState(false);

  const { exportPng, exportSvg, isExporting } = useExportImage({
    containerRef,
    title: scoreTitle,
  });

  /**
   * 导出文本谱。
   *
   * 码在 Rust 端算；引擎没起来时退回不带码的文本，不让导出整个失败。
   */
  const exportText = useCallback(() => {
    void (async () => {
      let codes: (string | null)[] | undefined;
      try {
        codes = await encodeJianziBatch(score.map((note) => note.jianzi));
      } catch {
        codes = undefined;
      }
      const text = formatScoreAsText(score, {
        title: scoreTitle,
        beatsPerBar,
        tuning: tuningLabel,
        codes,
        // 时值跟着码走：导出的文本能被「减字码入谱」原样读回，节奏不丢。
        annotateRhythm: true,
      });
      downloadTextFile(text, `${scoreTitle || "taiyin-score"}.txt`);
    })();
  }, [score, scoreTitle, beatsPerBar, tuningLabel]);

  /** 导出旋律为 WAV 音频（离线渲染，与播放音色一致）。 */
  const exportWav = useCallback(async () => {
    if (score.length === 0) return;
    setIsExportingAudio(true);
    try {
      const buffer = await renderScoreToBuffer(score, bpm, {
        beatsPerBar,
        withMetronome: linkMetronome,
        leadInBars: exportWithCountIn ? 2 : 0,
        concertPitch,
        tuning,
      });
      downloadWav(buffer, `${scoreTitle || "taiyin-score"}.wav`);
    } catch {
      onError("音频导出失败");
    } finally {
      setIsExportingAudio(false);
    }
  }, [
    score,
    bpm,
    beatsPerBar,
    linkMetronome,
    exportWithCountIn,
    concertPitch,
    tuning,
    scoreTitle,
    onError,
  ]);

  /** 导出标准 MIDI 谱（可导入打谱软件 / DAW；音高按当前定弦推定）。 */
  const exportMidi = useCallback(() => {
    if (score.length === 0) return;
    const bytes = scoreToMidi(score, {
      title: scoreTitle || "taiyin-score",
      bpm,
      beatsPerBar,
      concertPitch,
      tuning,
    });
    downloadMidi(bytes, `${scoreTitle || "taiyin-score"}.mid`);
  }, [score, scoreTitle, bpm, beatsPerBar, concertPitch, tuning]);

  /**
   * 导出 PDF —— 走浏览器原生打印通道。
   *
   * 页面尺寸 / 边距 / 隐藏交互都在 `globals.css` 的 `@media print` 里，
   * 所以这里只需要唤起打印对话框。
   */
  const exportPdf = useCallback(() => {
    if (typeof window !== "undefined") window.print();
  }, []);

  return {
    exportPng,
    exportSvg,
    exportText,
    exportWav,
    exportMidi,
    exportPdf,
    isExporting,
    isExportingAudio,
  };
}
