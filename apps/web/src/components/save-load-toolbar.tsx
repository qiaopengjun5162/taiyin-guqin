interface SaveLoadToolbarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onSave: () => void;
  onLoad: () => void;
  onExport?: () => void;
  hasNotes: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  isExporting?: boolean;
}

export function SaveLoadToolbar({
  title,
  onTitleChange,
  onSave,
  onLoad,
  onExport,
  hasNotes,
  saveStatus,
  isExporting,
}: SaveLoadToolbarProps) {
  return (
    <div className="no-print mt-3 w-full max-w-md flex items-center gap-2">
      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
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
      {hasNotes && onExport && (
        <button
          onClick={onExport}
          disabled={isExporting}
          className="px-3 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 disabled:opacity-30 transition-all"
        >
          {isExporting ? "导出中…" : "导出"}
        </button>
      )}
    </div>
  );
}
