import { useEffect, useRef, useState } from "react";
import type { ScoreListItem } from "@/lib/api";
import { getTuningById } from "@/lib/tuning";

interface LoadDialogProps {
  open: boolean;
  onClose: () => void;
  scores: ScoreListItem[];
  onLoad: (id: string) => void;
  onDelete: (id: string, title: string) => void;
}

export function LoadDialog({ open, scores, onClose, onLoad, onDelete }: LoadDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

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

  // 搜索词不跨次保留：由调用方用 key 控制挂载（打开即全新实例），
  // 比在 effect 里 setState 干净——后者会触发级联渲染。
  if (!open) return null;

  const keyword = query.trim().toLowerCase();
  const visible = keyword
    ? scores.filter((s) => s.title.toLowerCase().includes(keyword))
    : scores;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div ref={dialogRef} className="w-full max-w-sm mx-4 rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="text-[11px] tracking-wider text-stone-600 mb-3">已保存的曲谱</p>
          {scores.length > 0 && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="按曲名搜索"
              placeholder="按曲名搜索…"
              className="mb-2 w-full px-2 py-1.5 min-h-[36px] text-[11px] tracking-wider rounded border border-amber-700/20 bg-transparent text-stone-800 placeholder-stone-400 outline-none focus:border-amber-600/50 transition-colors"
            />
          )}
          {scores.length === 0 && (
            <p className="text-[10px] tracking-wider text-stone-500">暂无保存的曲谱</p>
          )}
          {scores.length > 0 && visible.length === 0 && (
            <p className="text-[10px] tracking-wider text-stone-500">没有匹配「{query.trim()}」的曲谱</p>
          )}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {visible.map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-1 px-3 py-2 text-[11px] tracking-wider rounded border border-amber-700/10 hover:border-amber-600/30 hover:bg-amber-900/10 transition-all cursor-pointer"
                onClick={() => onLoad(s.id)}
              >
                <span className="flex-1 text-stone-800 truncate">{s.title}</span>
                {/* 定弦：加载时会跟着切换，提前让用户知道这首谱按哪种调式弹 */}
                <span
                  className="shrink-0 rounded border border-amber-700/20 px-1 text-[9px] text-amber-800/70"
                  title={getTuningById(s.tuning).hint}
                >
                  {getTuningById(s.tuning).name}
                </span>
                <span className="text-[9px] text-stone-500 shrink-0">
                  {new Date(s.updated_at).toLocaleString("zh-CN")}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(s.id, s.title); }}
                  className="ml-1 size-4 flex items-center justify-center rounded text-stone-400 hover:text-red-600 hover:bg-red-900/10 opacity-0 group-hover:opacity-100 transition-all"
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={onClose}
            className="mt-3 w-full px-3 py-1.5 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-600 hover:text-stone-900 hover:border-amber-700/50 transition-all"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
