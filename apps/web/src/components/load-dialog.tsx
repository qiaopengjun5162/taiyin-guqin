import { useEffect, useRef } from "react";
import type { ScoreListItem } from "@/lib/api";

interface LoadDialogProps {
  open: boolean;
  onClose: () => void;
  scores: ScoreListItem[];
  onLoad: (id: string) => void;
  onDelete: (id: string, title: string) => void;
}

export function LoadDialog({ open, scores, onClose, onLoad, onDelete }: LoadDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div ref={dialogRef} className="w-full max-w-sm mx-4 rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="text-[11px] tracking-wider text-amber-100/60 mb-3">已保存的曲谱</p>
          {scores.length === 0 && (
            <p className="text-[10px] tracking-wider text-stone-500">暂无保存的曲谱</p>
          )}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {scores.map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-1 px-3 py-2 text-[11px] tracking-wider rounded border border-amber-700/10 hover:border-amber-600/30 hover:bg-amber-900/10 transition-all cursor-pointer"
                onClick={() => onLoad(s.id)}
              >
                <span className="flex-1 text-amber-100/70 truncate">{s.title}</span>
                <span className="text-[9px] text-stone-500 shrink-0">
                  {new Date(s.updated_at).toLocaleString("zh-CN")}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(s.id, s.title); }}
                  className="ml-1 size-4 flex items-center justify-center rounded text-stone-500 hover:text-red-400 hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all"
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={onClose}
            className="mt-3 w-full px-3 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 transition-all"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
