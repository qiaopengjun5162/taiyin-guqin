import type { ExampleScore } from "@/lib/example-scores";

interface SaveLoadToolbarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onTitleBlur?: () => void;
  onSave: () => void;
  onLoad: () => void;
  onExportPng?: () => void;
  onExportSvg?: () => void;
  onExportText?: () => void;
  onExportWav?: () => void;
  onExportMidi?: () => void;
  onExportPdf?: () => void;
  isExportingAudio?: boolean;
  examples?: ExampleScore[];
  onLoadExample?: (id: string) => void;
  hasNotes: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  isExporting?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** server=存后端；browser=静态站点无后端，存本机浏览器 */
  storageMode?: "server" | "browser";
}

export function SaveLoadToolbar({
  title,
  onTitleChange,
  onTitleBlur,
  onSave,
  onLoad,
  onExportPng,
  onExportSvg,
  onExportText,
  onExportWav,
  onExportMidi,
  onExportPdf,
  isExportingAudio,
  examples,
  onLoadExample,
  hasNotes,
  saveStatus,
  isExporting,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  storageMode = "server",
}: SaveLoadToolbarProps) {
  return (
    <div className="no-print mt-3 w-full max-w-md flex flex-wrap items-center gap-2 gap-y-2">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="撤销"
        title="撤销 (Ctrl+Z / Cmd+Z)"
        className="px-2 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500
                   hover:text-stone-300 hover:border-amber-600/50
                   disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        ← 撤销
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="重做"
        title="重做 (Ctrl+Shift+Z / Cmd+Shift+Z)"
        className="px-2 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500
                   hover:text-stone-300 hover:border-amber-600/50
                   disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        重做 →
      </button>
      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onTitleBlur}
        aria-label="曲谱名称"
        className="flex-1 min-w-[140px] px-2 py-1.5 min-h-[44px] text-[11px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 placeholder-amber-700/40 outline-none focus:border-amber-600/50 transition-colors"
        placeholder="曲谱名称"
      />
      <button
        onClick={onSave}
        disabled={!hasNotes || saveStatus === "saving"}
        aria-label={storageMode === "server" ? "发布到社区" : "保存"}
        className="px-3 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 disabled:opacity-30 transition-all"
      >
        {saveStatus === "saving"
          ? "保存中…"
          : saveStatus === "saved"
            ? "已保存"
            : saveStatus === "error"
              ? "保存失败"
              : storageMode === "server"
                ? "发布到社区"
                : "保存"}
      </button>
      {storageMode === "server" ? (
        <span
          title="已保存即公开发布到社区共享池，任何人都看得到、也都能打开。后端是无鉴权共享，先确认这首谱可以公开再发布。"
          className="px-1.5 py-1 rounded text-[9px] tracking-wider text-vermillion border border-vermillion/30 whitespace-nowrap"
        >
          已发布（公开）
        </span>
      ) : (
        <span
          title="当前是纯前端版本（未连接后端），曲谱保存在本机浏览器，换设备或清缓存会丢失；可用「导出文本」备份。"
          className="px-1.5 py-1 rounded text-[9px] tracking-wider text-amber-700/50 border border-amber-700/20 whitespace-nowrap"
        >
          存本机
        </span>
      )}
      <button
        onClick={onLoad}
        aria-label="加载曲谱"
        className="px-3 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all"
      >
        加载
      </button>
      {examples && examples.length > 0 && onLoadExample && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) {
              onLoadExample(e.target.value);
              e.target.value = "";
            }
          }}
          aria-label="加载示例"
          className="px-2 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 bg-transparent text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all outline-none"
        >
          <option value="">示例</option>
          {examples.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
      )}
      {hasNotes && onExportPng && (
        <button
          onClick={onExportPng}
          disabled={isExporting}
          aria-label="导出图片（PNG）"
          title="导出位图（PNG，适合分享）"
          className="px-3 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 disabled:opacity-30 transition-all"
        >
          {isExporting ? "导出中…" : "PNG"}
        </button>
      )}
      {hasNotes && onExportSvg && (
        <button
          onClick={onExportSvg}
          disabled={isExporting}
          aria-label="导出矢量图（SVG）"
          title="导出矢量图（SVG，无损缩放，适合排谱）"
          className="px-3 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 disabled:opacity-30 transition-all"
        >
          {isExporting ? "导出中…" : "SVG"}
        </button>
      )}
      {hasNotes && onExportPdf && (
        <button
          onClick={onExportPdf}
          aria-label="导出 PDF"
          title="导出 PDF：走浏览器打印通道，在打印框选「另存为 PDF」即得矢量文件；含曲名、定弦与减字字体，适合打印出版 / 分享"
          className="px-3 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all"
        >
          PDF
        </button>
      )}
      {hasNotes && onExportText && (
        <button
          onClick={onExportText}
          aria-label="导出文本"
          className="px-3 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all"
        >
          导出文本
        </button>
      )}
      {hasNotes && onExportMidi && (
        <button
          onClick={onExportMidi}
          aria-label="导出 MIDI"
          title="标准 MIDI（.mid）：可导入 MuseScore / 打谱软件 / DAW / AI 歌声合成。音高为正调推定、A4=440 等分律；本机基准音只影响播放与 WAV，不影响此文件。走手音（绰/注）暂不写入 MIDI，导入后是直音"
          className="px-3 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all"
        >
          MIDI
        </button>
      )}
      {hasNotes && onExportWav && (
        <button
          onClick={onExportWav}
          disabled={isExportingAudio}
          aria-label="导出音频"
          className="px-3 py-1.5 min-h-[44px] text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 disabled:opacity-30 transition-all"
        >
          {isExportingAudio ? "导出中…" : "导出音频"}
        </button>
      )}
    </div>
  );
}
