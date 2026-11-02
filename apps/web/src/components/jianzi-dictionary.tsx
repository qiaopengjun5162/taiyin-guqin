"use client";

/**
 * 减字字典（字全表）—— 把减字谱「拆开给人看」。
 *
 * 这是 LiberWord 一文核心主张的落地：减字谱千年未入 Unicode，数字化的前提是
 * 先有一份结构化目录——「到底有多少个减字、每个字怎么拆、有哪些变体」。
 * 本组件不造字，而是把太音能拼出的减字做成可浏览、可检索的参考表：
 *   每个字 = 字形（SVG 四象限拼装）+ 人话读法 + 音高提示；
 *   可按音色 / 左手指法 / 右手指法 / 弦序筛选，也能全文搜索；
 *   点一下即试听（与谱面播放同一套合成，听到的就是弹进谱里的声音）。
 *
 * 字典数据、筛选与搜索逻辑全部在 Rust（`taiyin-core` 的 `jianzi_dictionary`），
 * 经 wasm `get_jianzi_dictionary` 暴露；本组件只负责把结果渲染成卡片与试听。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  JianziDictEntry,
  DictFilter,
  ToneFilter,
} from "@/lib/jianzi-dictionary-types";
import {
  EMPTY_FILTER,
  LEFT_FILTERS,
  ACTION_FILTERS,
  STRING_FILTERS,
} from "@/lib/jianzi-dictionary-types";
import { getJianziDictionary, useWasmInit } from "@/lib/taiyin-wasm";
import { explainJianzi } from "@/lib/jianzi-explain";
import {
  getSavedSnapshot,
  getServerSavedSnapshot,
  jianziKey,
  saveJianzi,
  subscribeSaved,
} from "@/lib/custom-jianzi";
import { SvgJianziBlock } from "./svg-jianzi-block";
import { usePitchContext } from "@/lib/use-pitch-context";
import { useNotePreview } from "@/lib/use-note-preview";

const TONE_OPTIONS: { label: string; value: ToneFilter }[] = [
  { label: "全部", value: "" },
  { label: "散音", value: "散" },
  { label: "泛音", value: "泛" },
  { label: "按音", value: "按" },
];

/** 单个减字卡片：上区试听，下区存入「我的减字」（与编辑器共用同一份本地库）。 */
function DictCard({
  entry,
  saved,
  onSave,
}: {
  entry: JianziDictEntry;
  saved: boolean;
  onSave: (entry: JianziDictEntry) => void;
}) {
  const { tuning, concertPitch } = usePitchContext();
  const preview = useNotePreview(tuning, concertPitch);
  const exp = explainJianzi(entry.state, { tuning, concertPitch });
  const label = exp.summary || entry.id;

  return (
    <div className="flex flex-col overflow-hidden rounded border border-amber-700/20 bg-[var(--paper)]/70 transition-colors hover:border-amber-600/50">
      <button
        type="button"
        onClick={() => void preview(entry.state)}
        title={`${label} · 点此试听`}
        aria-label={`试听 ${label}`}
        data-testid="dict-card-play"
        className="flex flex-1 flex-col items-center gap-1.5 px-2 pb-2 pt-3 text-center transition-transform active:scale-[0.98]"
      >
        <span className="flex h-12 items-center justify-center font-calligraphy text-[var(--ink)]">
          <SvgJianziBlock state={entry.state} fontSize="30px" />
        </span>
        <span className="text-[11px] leading-tight tracking-wide text-stone-800">{label}</span>
        {/* 音高提示（变灰小字），与释义里的 pitchHint 同源 */}
        {exp.pitchHint && (
          <span className="text-[9px] tracking-wider text-amber-700/50">{exp.pitchHint}</span>
        )}
        {/* 减字码：看一眼就知道这字在键盘上怎么敲（与连打输入同一张码表） */}
        {entry.code && (
          <span
            className="rounded bg-amber-700/10 px-1 py-px font-mono text-[9px] tracking-wider text-amber-800/60"
            title={`减字码 ${entry.code} · 在连打输入框里敲这串即可`}
          >
            {entry.code}
          </span>
        )}
        {entry.note && (
          <span className="line-clamp-2 text-[9px] leading-tight text-stone-400">{entry.note}</span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onSave(entry)}
        disabled={saved}
        aria-label={saved ? `${label} 已在常用` : `把 ${label} 存为常用`}
        className="border-t border-amber-700/15 py-1 text-[9px] tracking-wider text-amber-700/60 transition-colors hover:bg-amber-700/10 disabled:cursor-default disabled:text-amber-700/25"
      >
        {saved ? "已在常用" : "＋ 存为常用"}
      </button>
    </div>
  );
}

/** 一组筛选按钮（音色 / 左手指法用）。 */
function ButtonGroup({
  options,
  value,
  onChange,
  allLabel,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
}) {
  const items = [{ label: allLabel, value: "" }, ...options];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value || "all"}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`min-h-[34px] rounded border px-2 text-[10px] tracking-wider transition-colors ${
              active
                ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                : "border-amber-700/25 text-stone-500 hover:border-amber-600/40 hover:text-stone-300"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** 一个下拉筛选（右手指法 / 弦序用）。 */
function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] tracking-wider text-amber-700/60">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[34px] rounded border border-amber-700/20 bg-transparent px-2 text-[10px] text-amber-100/80 outline-none focus:border-amber-600/50"
      >
        {options.map((o) => (
          <option key={o.value || "all"} value={o.value} className="bg-stone-900">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function JianziDictionary() {
  const { state: wasmState, error: wasmError } = useWasmInit();
  const [filter, setFilter] = useState<DictFilter>(EMPTY_FILTER);
  const [result, setResult] = useState<{ total: number; entries: JianziDictEntry[] }>({
    total: 0,
    entries: [],
  });
  // loaded / error 只在异步回调里置位，避免在 effect 体内同步 setState（触发级联渲染告警）。
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 「我的减字」与编辑器页的 SavedJianziBar 共用同一份 localStorage：
  // 在这里存下的字，回编辑器就能一键填回。
  const savedList = useSyncExternalStore(
    subscribeSaved,
    getSavedSnapshot,
    getServerSavedSnapshot,
  );
  const savedKeys = useMemo(() => new Set(savedList.map((s) => s.key)), [savedList]);
  const [notice, setNotice] = useState<string | null>(null);

  function handleSave(entry: JianziDictEntry) {
    const saved = saveJianzi(entry.state);
    setNotice(
      saved
        ? saved.isNew
          ? `已存入「${saved.item.label}」· 回编辑器可一键填回`
          : `「${saved.item.label}」已在常用里`
        : "这个减字还不完整，存不了。",
    );
  }

  // wasm 就绪后，按当前筛选条件向 Rust 端查询字全表（筛选 / 搜索都在 Rust 完成）。
  useEffect(() => {
    if (wasmState !== "ready") return;
    let cancelled = false;
    getJianziDictionary(filter)
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "查询失败");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wasmState, filter]);

  const results = result.entries;
  // 加载态：wasm 未就绪，或首轮查询尚未返回（re-filter 期间沿用上一批结果，不闪烁）。
  const loading = wasmState !== "ready" || !loaded;

  const set = <K extends keyof DictFilter>(key: K, value: DictFilter[K]) =>
    setFilter((prev) => ({ ...prev, [key]: value }));

  const reset = () => setFilter(EMPTY_FILTER);
  const isFiltered =
    filter.tone !== "" ||
    filter.left !== "" ||
    filter.action !== "" ||
    filter.string !== "" ||
    filter.query.trim() !== "";

  return (
    <div className="w-full">
      {/* ── 筛选区 ── */}
      <div className="rounded-lg border border-amber-700/20 bg-[var(--paper)]/50 p-4">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[10px] tracking-[0.2em] text-amber-700/60">音色</p>
            <ButtonGroup
              options={TONE_OPTIONS.filter((o) => o.value !== "").map((o) => ({ label: o.label, value: o.value }))}
              value={filter.tone}
              onChange={(v) => set("tone", v as ToneFilter)}
              allLabel="全部"
            />
          </div>

          <div>
            <p className="mb-1.5 text-[10px] tracking-[0.2em] text-amber-700/60">左手指法</p>
            <ButtonGroup
              options={LEFT_FILTERS.map((label) => ({ label, value: label }))}
              value={filter.left}
              onChange={(v) => set("left", v)}
              allLabel="全部"
            />
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <SelectFilter
              label="右手指法"
              value={filter.action}
              onChange={(v) => set("action", v)}
              options={[
                { label: "全部", value: "" },
                ...ACTION_FILTERS.map((label) => ({ label, value: label })),
              ]}
            />
            <SelectFilter
              label="弦序"
              value={filter.string}
              onChange={(v) => set("string", v)}
              options={[
                { label: "全部", value: "" },
                ...STRING_FILTERS.map((s) => ({ label: `${s}弦`, value: s })),
              ]}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="search"
              value={filter.query}
              onChange={(e) => set("query", e.target.value)}
              placeholder="搜索读法 / 部件 / 备注 / 减字码，如「名指」「泛音」「ad9g4」"
              aria-label="搜索减字"
              className="min-h-[34px] flex-1 rounded border border-amber-700/20 bg-transparent px-2 text-[11px] text-stone-800 outline-none placeholder:text-stone-400 focus:border-amber-600/50"
            />
            {isFiltered && (
              <button
                type="button"
                onClick={reset}
                className="min-h-[34px] rounded border border-amber-700/25 px-2 text-[10px] tracking-wider text-stone-500 hover:border-amber-600/40 hover:text-stone-300"
              >
                重置
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 结果计数 ── */}
      <p className="mt-3 text-[10px] tracking-wider text-amber-700/50">
        {loading
          ? wasmState === "error"
            ? "减字引擎加载失败"
            : "减字引擎加载中…"
          : `共 ${results.length} 字`}
        {!loading && isFiltered && ` · 全表 ${result.total} 字`}
      </p>

      {/* ── 卡片网格（始终保留容器，便于检索与空态提示） ── */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="dict-grid">
        {loading ? (
          wasmState === "error" ? (
            <p className="col-span-full text-center text-[11px] tracking-wider text-red-400/80">
              引擎加载失败：{wasmError?.message ?? "未知错误"}，请刷新页面重试
            </p>
          ) : (
            <p className="col-span-full text-center text-[11px] tracking-wider text-amber-700/40">
              减字引擎加载中…
            </p>
          )
        ) : error ? (
          <p className="col-span-full text-center text-[11px] tracking-wider text-red-400/80">
            查询失败：{error}
          </p>
        ) : results.length === 0 ? (
          <p className="col-span-full text-center text-[11px] tracking-wider text-amber-700/40">
            没有匹配的减字 · 试试放宽筛选条件
          </p>
        ) : (
          results.map((entry) => (
            <DictCard
              key={entry.id}
              entry={entry}
              saved={savedKeys.has(jianziKey(entry.state))}
              onSave={handleSave}
            />
          ))
        )}
      </div>

      {notice && (
        <p role="status" className="mt-2 text-[10px] tracking-wider text-amber-700/60">
          {notice}
        </p>
      )}
    </div>
  );
}
