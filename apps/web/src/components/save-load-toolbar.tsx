import type { ExampleScore } from "@/lib/example-scores";

interface SaveLoadToolbarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onTitleBlur?: () => void;
  onSave: () => void;
  onLoad: () => void;
  onExportPng?: () => void;
  onExportText?: () => void;
  examples?: ExampleScore[];
  onLoadExample?: (id: string) => void;
  hasNotes: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  isExporting?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function SaveLoadToolbar({
  title,
  onTitleChange,
  onTitleBlur,
  onSave,
  onLoad,
  onExportPng,
  onExportText,
  examples,
  onLoadExample,
  hasNotes,
  saveStatus,
  isExporting,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: SaveLoadToolbarProps) {
  return (
    <div className="no-print mt-3 w-full max-w-md flex items-center gap-2">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="撤销"
        title="撤销 (Ctrl+Z / Cmd+Z)"
        className="px-2 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500
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
        className="px-2 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500
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
        className="flex-1 min-w-0 px-2 py-1.5 text-[11px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 placeholder-amber-700/40 outline-none focus:border-amber-600/50 transition-colors"
        placeholder="曲谱名称"
      />
      <button
        onClick={onSave}
        disabled={!hasNotes || saveStatus === "saving"}
        className="px-3 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 disabled:opacity-30 transition-all"
      >
        {saveStatus === "saving" ? "保存中…" : saveStatus === "saved" ? "已保存" : saveStatus === "error" ? "保存失败" : "保存"}
      </button>
      <button
        onClick={onLoad}
        className="px-3 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all"
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
          className="px-2 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 bg-transparent text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all outline-none"
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
          className="px-3 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 disabled:opacity-30 transition-all"
        >
          {isExporting ? "导出中…" : "导出"}
        </button>
      )}
      {hasNotes && onExportText && (
        <button
          onClick={onExportText}
          className="px-3 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 transition-all"
        >
          导出文本
        </button>
      )}
    </div>
  );
}
