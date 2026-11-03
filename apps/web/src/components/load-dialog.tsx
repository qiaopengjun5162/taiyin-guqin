import { useEffect, useRef, useState } from "react";
import type { ScoreListItem } from "@/lib/api";
import { getTuningById } from "@/lib/tuning";

export interface LoadDialogTab {
  key: string;
  label: string;
  scores: ScoreListItem[];
  /**
   * 只读 tab 不显示删除按钮。社区共享谱就是这种情况——
   * 后端是无鉴权共享池，别人的曲谱不能删，自己那份也在里面、
   * 但删了也只删服务器副本，本机副本还在，反而造成「删了还在」的困惑，
   * 所以社区 tab 干脆不提供删除。
   */
  readOnly?: boolean;
}

interface LoadDialogProps {
  open: boolean;
  onClose: () => void;
  tabs: LoadDialogTab[];
  /** 初始激活的 tab；省略则用第一个 */
  defaultTabKey?: string;
  onLoad: (id: string, tabKey: string) => void;
  onDelete?: (id: string, title: string) => void;
}

export function LoadDialog({ open, tabs, defaultTabKey, onClose, onLoad, onDelete }: LoadDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState(defaultTabKey ?? tabs[0]?.key);
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

  // activeKey 可能因 tabs 变化而失效（如切到本机模式），回退到第一个。
  const activeTab = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  // 搜索词不跨次保留：由调用方用 key 控制挂载（打开即全新实例），
  // 比在 effect 里 setState 干净——后者会触发级联渲染。
  if (!open || !activeTab) return null;

  const keyword = query.trim().toLowerCase();
  const visible = keyword
    ? activeTab.scores.filter((s) => s.title.toLowerCase().includes(keyword))
    : activeTab.scores;

  const showTabs = tabs.length > 1;

  function switchTab(key: string) {
    setActiveKey(key);
    // 切 tab 时清空搜索，避免旧关键词跨分类串味（社区里搜「平沙」切到本机还留着）
    setQuery("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div ref={dialogRef} className="w-full max-w-sm mx-4 rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          {showTabs ? (
            <div className="flex gap-1 mb-3">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => switchTab(t.key)}
                  aria-pressed={t.key === activeTab.key}
                  className={
                    "flex items-center gap-1 px-2.5 py-1 text-[10px] tracking-wider rounded border transition-all " +
                    (t.key === activeTab.key
                      ? "border-vermillion/50 text-[var(--vermillion)] bg-vermillion/10"
                      : "border-amber-700/20 text-stone-500 hover:text-stone-800 hover:border-amber-600/40")
                  }
                >
                  {t.label}
                  <span className="rounded bg-black/5 px-1 text-[9px] tabular-nums">{t.scores.length}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] tracking-wider text-stone-600 mb-3">{activeTab.label}</p>
          )}

          {activeTab.scores.length > 0 && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="按曲名搜索"
              placeholder="按曲名搜索…"
              className="mb-2 w-full px-2 py-1.5 min-h-[36px] text-[11px] tracking-wider rounded border border-amber-700/20 bg-transparent text-stone-800 placeholder-stone-400 outline-none focus:border-amber-600/50 transition-colors"
            />
          )}
          {activeTab.scores.length === 0 && (
            <p className="text-[10px] tracking-wider text-stone-500">
              {showTabs ? `暂无「${activeTab.label}」下的曲谱` : "暂无曲谱"}
            </p>
          )}
          {activeTab.scores.length > 0 && visible.length === 0 && (
            <p className="text-[10px] tracking-wider text-stone-500">没有匹配「{query.trim()}」的曲谱</p>
          )}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {visible.map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-1 px-3 py-2 text-[11px] tracking-wider rounded border border-amber-700/10 hover:border-amber-600/30 hover:bg-amber-900/10 transition-all cursor-pointer"
                onClick={() => onLoad(s.id, activeTab.key)}
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
                {!activeTab.readOnly && onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(s.id, s.title); }}
                    className="ml-1 size-4 flex items-center justify-center rounded text-stone-400 hover:text-red-600 hover:bg-red-900/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="删除"
                  >
                    ×
                  </button>
                )}
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
