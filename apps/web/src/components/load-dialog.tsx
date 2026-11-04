import { useEffect, useRef, useState } from "react";
import type { ScoreListItem } from "@/lib/api";
import { getTuningById } from "@/lib/tuning";

export interface LoadDialogTab {
  key: string;
  label: string;
  scores: ScoreListItem[];
  /**
   * 只读 tab 不显示删除按钮。社区共享谱就是这种情况——
   * 别人的曲谱不能删。
   */
  readOnly?: boolean;
  /**
   * 只读 tab 里仍允许删除的条目（自己发布的谱）。
   *
   * `readOnly` 的本意是「别删别人的谱」，不是「发布后不可撤回」——
   * 少了这一层，用户发布到社区就再也删不掉自己的谱了。
   */
  myScoreIds?: string[];
  /**
   * 当前登录者的账号 id。列表用它比对每首谱的 `owner_user_id`：
   * 匹配即「我的谱」，哪怕这首谱是别的设备发的、本机并没有它的凭证。
   * 账号体系解决的就是这件事——换设备也认得出自己的谱。
   */
  myUserId?: string | null;
  /**
   * 本机 tab 专属：连上社区后端时显示「一键发布本机谱到社区」入口，
   * 让老用户的本地曲谱批量进入共享池，激活空社区。
   */
  showMigrate?: boolean;
  /**
   * 服务端总共多少首（`x-total-count`）。
   *
   * 有它才能说清「列表里只是前 50 首」——否则用户翻到底以为社区只有这些，
   * 而实际上更多谱在后面几页。
   */
  total?: number | null;
  /** 取下一页。只有 `scores.length < total` 时才应该显示按钮。 */
  onLoadMore?: () => void;
  /** 下一页请求进行中 */
  loadingMore?: boolean;
  /**
   * 社区列表排序：`recent`（默认，按更新时间）/ `popular`（按收藏数）。
   * 只在社区 tab 有意义；翻页与重新拉取都靠它决定取哪一版顺序。
   */
  sort?: "recent" | "popular";
}

interface LoadDialogProps {
  open: boolean;
  onClose: () => void;
  tabs: LoadDialogTab[];
  /** 初始激活的 tab；省略则用第一个 */
  defaultTabKey?: string;
  onLoad: (id: string, tabKey: string) => void;
  onDelete?: (id: string, title: string) => void;
  /**
   * 认领旧谱：把「这台设备用凭证发布的谱」挂到登录账号下。
   * 认领之后换设备、清缓存都不会再失去它。
   */
  onClaim?: (id: string, title: string) => void;
  /** 一键把本机谱批量发布到社区共享池（仅本机 tab 显示） */
  onMigrate?: () => void;
  /** 迁移进行中，禁用按钮并显示「发布中…」 */
  migrating?: boolean;
  /** 迁移结果提示（成功/跳过数量等），显示在按钮下方 */
  migrateMsg?: string | null;
  /**
   * 当前账号已收藏的曲谱 id。
   *
   * 配合 `onToggleFavorite` 一起给：只有**登录后**才显示星标——
   * 未登录时收藏接口必然 401，画一个点了就报错的星星比不画更糟。
   */
  favoriteIds?: string[];
  /** 切换收藏。`favorited` 是点击**后**期望的状态，而不是当前状态。 */
  onToggleFavorite?: (id: string, favorited: boolean) => void;
  /** 切换社区列表排序（最新 / 最热）。仅社区 tab 显示对应控件时调用。 */
  onCommunitySortChange?: (sort: "recent" | "popular") => void;
}

/**
 * 列表底部的分页提示。
 *
 * 两件事必须说清楚，否则用户会被误导：
 * ① 列表里只是**前 N 首**，总数还有更多；
 * ② 搜索只在**已加载的这些**里搜——分页之后本地过滤的范围变了，
 *    不说明的话「搜不到」会被理解成「社区没有这首」。
 */
function PaginationHint({ tab, query }: { tab: LoadDialogTab; query: string }) {
  const loaded = tab.scores.length;
  const total = tab.total;
  const hasMore = total !== null && total !== undefined && loaded < total;

  if (!hasMore) return null;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] tracking-wider text-stone-500 tabular-nums">
          已显示 {loaded} / {total} 首
        </span>
        <button
          type="button"
          onClick={tab.onLoadMore}
          disabled={tab.loadingMore || !tab.onLoadMore}
          className="shrink-0 px-2 py-0.5 text-[9px] tracking-wider rounded border border-amber-700/30 text-stone-600 hover:text-stone-900 hover:border-amber-700/50 disabled:opacity-40 transition-all"
        >
          {tab.loadingMore ? "加载中…" : "加载更多"}
        </button>
      </div>
      {query.trim() && (
        <p className="text-[9px] tracking-wider text-amber-800/70">
          搜索只在已加载的 {loaded} 首里查，更早的谱还没取下来
        </p>
      )}
    </div>
  );
}

export function LoadDialog({
  open,
  tabs,
  defaultTabKey,
  onClose,
  onLoad,
  onDelete,
  onClaim,
  onMigrate,
  migrating,
  migrateMsg,
  favoriteIds,
  onToggleFavorite,
  onCommunitySortChange,
}: LoadDialogProps) {
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
  // 曲名与署名都参与匹配：社区里常有「找某某打的谱」这种需求，
  // 而署名往往比曲名更好记。
  const visible = keyword
    ? activeTab.scores.filter(
        (s) =>
          s.title.toLowerCase().includes(keyword) ||
          (s.author ?? "").toLowerCase().includes(keyword),
      )
    : activeTab.scores;

  // 社区列表当前排序：未显式指定时按「最新」处理（与后端默认一致）。
  const currentSort = activeTab.sort ?? "recent";

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
                  {/* 显示总数而非已加载数：社区有 123 首时，徽标写 50 会让人以为就这么多 */}
                  <span className="rounded bg-black/5 px-1 text-[9px] tabular-nums">
                    {t.total ?? t.scores.length}
                  </span>
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
              placeholder="按曲名 / 署名搜索…"
              className="mb-2 w-full px-2 py-1.5 min-h-[36px] text-[11px] tracking-wider rounded border border-amber-700/20 bg-transparent text-stone-800 placeholder-stone-400 outline-none focus:border-amber-600/50 transition-colors"
            />
          )}
          {/* 社区列表排序：默认「最新」，可切「最热」（按收藏数）。只社区 tab 显示。 */}
          {activeTab.key === "community" && onCommunitySortChange && (
            <div className="mb-2 flex items-center gap-1">
              <span className="text-[9px] tracking-wider text-stone-500">排序</span>
              {(["recent", "popular"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onCommunitySortChange(value)}
                  aria-pressed={currentSort === value}
                  className={
                    "px-2 py-0.5 text-[9px] tracking-wider rounded border transition-all " +
                    (currentSort === value
                      ? "border-vermillion/50 text-[var(--vermillion)] bg-vermillion/10"
                      : "border-amber-700/20 text-stone-500 hover:text-stone-800 hover:border-amber-600/40")
                  }
                >
                  {value === "recent" ? "最新" : "最热"}
                </button>
              ))}
            </div>
          )}
          {activeTab.showMigrate && (
            <div className="mb-2 p-2 rounded border border-amber-700/20 bg-amber-900/10">
              <button
                type="button"
                onClick={onMigrate}
                disabled={migrating}
                aria-label="一键发布本机谱到社区"
                className="w-full px-2 py-1.5 min-h-[36px] text-[10px] tracking-wider rounded border border-vermillion/40 text-[var(--vermillion)] hover:bg-vermillion/10 disabled:opacity-40 transition-all"
              >
                {migrating ? "发布中…" : "⇪ 一键发布本机谱到社区"}
              </button>
              <p className="mt-1 text-[9px] leading-relaxed text-stone-500">
                把浏览器里保存的曲谱批量发布到社区共享池（公开），首次发布后可在「社区曲谱」tab 找到。
              </p>
              {migrateMsg && (
                <p className="mt-1 text-[10px] tracking-wider text-emerald-700/90 font-medium">{migrateMsg}</p>
              )}
            </div>
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
            {visible.map((s) => {
              // 「我的谱」两条腿：本机凭证记过它，或服务端记着它属于我这个账号。
              // 后者才是换设备后仍能认出的依据。
              const mine =
                !!activeTab.myScoreIds?.includes(s.id) ||
                (!!activeTab.myUserId && s.owner_user_id === activeTab.myUserId);
              // 认领只对本机发的、还没有账号归属的谱开放：
              // 服务端要求出示原凭证，别人的谱点了也只会 403。
              const claimable = !!onClaim && !!activeTab.myUserId && !s.owner_user_id && mine;
              const favorited = !!favoriteIds?.includes(s.id);
              return (
              <div
                key={s.id}
                className="group flex items-center gap-1 px-3 py-2 text-[11px] tracking-wider rounded border border-amber-700/10 hover:border-amber-600/30 hover:bg-amber-900/10 transition-all cursor-pointer"
                onClick={() => onLoad(s.id, activeTab.key)}
              >
                <span className="flex-1 text-stone-800 truncate">{s.title}</span>
                {mine && (
                  <span
                    className="shrink-0 rounded border border-emerald-700/30 px-1 text-[9px] text-emerald-700/80"
                    title="这首谱是你的，可以改删"
                  >
                    我的
                  </span>
                )}
                {/* 署名：同一首曲有多个打法版本时，这是区分「谁打的谱」的唯一线索 */}
                {s.author && (
                  <span
                    className="shrink-0 max-w-[6em] truncate text-[9px] text-stone-500"
                    title={`打谱：${s.author}`}
                  >
                    {s.author}
                  </span>
                )}
                {/* 定弦：加载时会跟着切换，提前让用户知道这首谱按哪种调式弹 */}
                <span
                  className="shrink-0 rounded border border-amber-700/20 px-1 text-[9px] text-amber-800/70"
                  title={getTuningById(s.tuning).hint}
                >
                  {getTuningById(s.tuning).name}
                </span>
                {/* 热度：被收藏次数。旧后端不返回该字段，这里用可选链安全跳过。 */}
                {typeof s.favorites_count === "number" && s.favorites_count > 0 && (
                  <span
                    className="shrink-0 rounded border border-rose-700/20 px-1 text-[9px] text-rose-700/70"
                    title={`已被收藏 ${s.favorites_count} 次`}
                  >
                    ♥{s.favorites_count}
                  </span>
                )}
                <span className="text-[9px] text-stone-500 shrink-0">
                  {new Date(s.updated_at).toLocaleString("zh-CN")}
                </span>
                {onToggleFavorite && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(s.id, !favorited);
                    }}
                    aria-label={favorited ? `取消收藏「${s.title}」` : `收藏「${s.title}」`}
                    aria-pressed={favorited}
                    title={
                      favorited ? "已收藏，点击取消" : "加入我的收藏（跟着账号走，换设备也在）"
                    }
                    className={`shrink-0 px-0.5 text-[12px] leading-none transition-colors ${
                      favorited ? "text-amber-600" : "text-stone-300 hover:text-amber-600"
                    }`}
                  >
                    {favorited ? "★" : "☆"}
                  </button>
                )}
                {claimable && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClaim(s.id, s.title);
                    }}
                    className="shrink-0 rounded border border-emerald-700/30 px-1 text-[9px] text-emerald-700/80 hover:bg-emerald-900/10 transition-all"
                    title="挂到我的账号下，换设备也能改删"
                  >
                    认领
                  </button>
                )}
                {onDelete && (!activeTab.readOnly || mine) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(s.id, s.title); }}
                    className="ml-1 size-4 flex items-center justify-center rounded text-stone-400 hover:text-red-600 hover:bg-red-900/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="删除"
                  >
                    ×
                  </button>
                )}
              </div>
              );
            })}
          </div>
          <PaginationHint tab={activeTab} query={query} />
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
