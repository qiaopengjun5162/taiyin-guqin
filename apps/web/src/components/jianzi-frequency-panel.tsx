"use client";

/**
 * 减字谱量化分析 —— 字频统计 + 写法变体归并。
 *
 * LiberWord 讲完「结构化字全表」后点出它的附加价值：「可以很方便的对所有数据
 * 进一步量化分析……在不同时期的流行程度」。本组件落地其中能先做的两件：
 *
 * 1. 选一首曲谱，统计每个减字出现几次、占比多少（字频）；
 * 2. 把同一指法的不同写法（名/夕、食/亻、勾/勹、挑/乚……）按**归一化字形**合并，
 *    这正是「系统自动合并所有标注」的思想——减字谱千年手抄，同一字常有多写。
 *
 * 曲谱来源有两种：内置示例曲，以及用户在编辑器里保存到本地（localStorage）的
 * **我的曲谱**。后者才是这个面板真正有用的地方——统计的是自己的谱子，不是样本。
 *
 * 统计与归并逻辑全部在 Rust（`taiyin-core` 的 `jianzi_stats` 模块），
 * 经 wasm `analyze_jianzi_frequency` / `get_jianzi_variant_groups` 暴露；
 * 本组件只负责选曲、渲染表格与试听。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {
  FreqResult,
  JianziFreqRow,
  VariantGroup,
} from "@/lib/jianzi-dictionary-types";
import type { JianziState, NoteColumn } from "@/lib/types";
import {
  analyzeJianziFrequency,
  getJianziVariantGroups,
  useWasmInit,
} from "@/lib/taiyin-wasm";
import { EXAMPLE_SCORES } from "@/lib/example-scores";
import {
  getScoresSnapshot,
  getServerScoresSnapshot,
  subscribeScores,
} from "@/lib/local-score-store";
import { explainJianzi } from "@/lib/jianzi-explain";
import { SvgJianziBlock } from "./svg-jianzi-block";
import { usePitchContext } from "@/lib/use-pitch-context";
import { useNotePreview } from "@/lib/use-note-preview";

/** 一个可统计的曲谱选项：示例曲或用户本地保存的曲谱。 */
interface ScoreOption {
  key: string;
  title: string;
  notes: NoteColumn[];
  /** true = 用户自己保存的曲谱。 */
  mine: boolean;
}

/** 把统计行还原成可渲染 / 可试听的 `JianziState`。 */
function rowToState(row: JianziFreqRow): JianziState {
  return {
    toneType: row.toneType,
    rhythmMode: null,
    leftFinger: row.leftFinger,
    hui: row.hui,
    fen: row.fen,
    slide: row.slide,
    rightAction: row.rightAction,
    stringNumber: row.stringNumber,
  };
}

/** 一行字频结果：字形 + 读法 + 次数/占比条 + 写法变体标注。 */
function FreqRowView({ row }: { row: JianziFreqRow }) {
  const { tuning, concertPitch } = usePitchContext();
  const preview = useNotePreview(tuning, concertPitch);
  const state = rowToState(row);
  const exp = explainJianzi(state, { tuning, concertPitch });
  const hasVariant =
    row.leftVariants.length > 1 || row.actionVariants.length > 1;
  const variantText = [
    row.leftVariants.length > 1 ? row.leftVariants.join("/") : null,
    row.actionVariants.length > 1 ? row.actionVariants.join("/") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={() => void preview(state)}
        title={exp.summary || row.id}
        aria-label={exp.summary || row.id}
        data-testid="freq-row"
        className="flex w-full items-center gap-2 rounded border border-amber-700/15 bg-[var(--paper)]/60 px-2 py-1.5 text-left transition-colors hover:border-amber-600/40 hover:bg-amber-800/10"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center font-calligraphy text-[var(--ink)]">
          <SvgJianziBlock state={state} fontSize="22px" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] tracking-wide text-stone-800">
              {exp.summary || row.label}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-amber-700/60">
              {row.count} 次 · {Math.round(row.ratio * 100)}%
            </span>
          </span>
          <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-amber-700/10">
            <span
              className="block h-full rounded-full bg-[var(--vermillion)]/60"
              style={{ width: `${Math.max(2, Math.round(row.ratio * 100))}%` }}
            />
          </span>
          {hasVariant && (
            <span className="mt-0.5 block truncate text-[9px] text-amber-700/45">
              写法变体：{variantText}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** 一个曲谱选项按钮（示例曲与我的曲谱共用同一套样式）。 */
function ScoreButton({
  option,
  active,
  onPick,
}: {
  option: ScoreOption;
  active: boolean;
  onPick: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(option.key)}
      aria-pressed={active}
      title={option.mine ? `我的曲谱 · ${option.title}` : option.title}
      className={`min-h-[34px] rounded border px-2 text-[10px] tracking-wider transition-colors ${
        active
          ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
          : "border-amber-700/25 text-stone-500 hover:border-amber-600/40 hover:text-stone-300"
      }`}
    >
      {option.title}
    </button>
  );
}

export function JianziFrequencyPanel() {
  const { state: wasmState, error: wasmError } = useWasmInit();
  // 本地曲谱走 useSyncExternalStore：编辑器里存/删曲谱后，这里自动刷新选项。
  const localScores = useSyncExternalStore(
    subscribeScores,
    getScoresSnapshot,
    getServerScoresSnapshot,
  );

  const options = useMemo<ScoreOption[]>(
    () => [
      ...EXAMPLE_SCORES.map((s) => ({
        key: `example:${s.id}`,
        title: s.title,
        notes: s.notes,
        mine: false,
      })),
      ...localScores.map((s) => ({
        key: `local:${s.id}`,
        title: s.title,
        notes: s.notes,
        mine: true,
      })),
    ],
    [localScores],
  );

  const [pickedKey, setPickedKey] = useState(() => options[0]?.key ?? "");
  // 选中的曲谱被删除（或选项尚未就绪）时，安全回退到第一项，不让面板卡在空选上。
  const activeKey = options.some((o) => o.key === pickedKey)
    ? pickedKey
    : (options[0]?.key ?? "");
  const activeOption = options.find((o) => o.key === activeKey);

  const [result, setResult] = useState<FreqResult>({ total: 0, rows: [] });
  const [variants, setVariants] = useState<VariantGroup[]>([]);
  // loaded / error 只在异步回调里置位，避免在 effect 体内同步 setState。
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // wasm 就绪后，按所选曲谱向 Rust 端请求字频统计（归并 / 计数都在 Rust 完成）。
  useEffect(() => {
    if (wasmState !== "ready") return;
    let cancelled = false;
    const notes = (options.find((o) => o.key === activeKey)?.notes ?? []).map(
      (n) => n.jianzi,
    );
    analyzeJianziFrequency(notes)
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "统计失败");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wasmState, activeKey, options]);

  // 变体对照表（只取一次）。
  useEffect(() => {
    if (wasmState !== "ready") return;
    let cancelled = false;
    getJianziVariantGroups()
      .then((v) => {
        if (!cancelled) setVariants(v);
      })
      .catch(() => {
        // 变体对照只是附加信息，失败不阻断字频统计。
      });
    return () => {
      cancelled = true;
    };
  }, [wasmState]);

  const loading = wasmState !== "ready" || !loaded;
  const variantMerged = result.rows.filter(
    (r) => r.leftVariants.length > 1 || r.actionVariants.length > 1,
  ).length;

  return (
    <div className="w-full" data-testid="freq-panel">
      {/* ── 曲谱选择：示例曲 + 我的曲谱 ── */}
      <div className="rounded-lg border border-amber-700/20 bg-[var(--paper)]/50 p-4">
        <p className="mb-2 text-[10px] tracking-[0.2em] text-amber-700/60">
          选一首曲谱，统计它的减字使用
        </p>
        <div className="flex flex-wrap gap-1.5">
          {options
            .filter((o) => !o.mine)
            .map((o) => (
              <ScoreButton
                key={o.key}
                option={o}
                active={o.key === activeKey}
                onPick={setPickedKey}
              />
            ))}
        </div>

        {localScores.length > 0 ? (
          <>
            <p className="mt-2.5 text-[10px] tracking-[0.2em] text-amber-700/60">
              我的曲谱（编辑器里保存的）
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="my-scores">
              {options
                .filter((o) => o.mine)
                .map((o) => (
                  <ScoreButton
                    key={o.key}
                    option={o}
                    active={o.key === activeKey}
                    onPick={setPickedKey}
                  />
                ))}
            </div>
          </>
        ) : (
          <p className="mt-2.5 text-[10px] leading-relaxed text-amber-700/45">
            还没有自己的曲谱。在编辑器里拼一首并保存，这里就能统计它。
          </p>
        )}

        <p className="mt-3 text-[10px] leading-relaxed text-amber-700/50">
          {loading
            ? wasmState === "error"
              ? "减字引擎加载失败"
              : "统计中…"
            : `《${activeOption?.title ?? "—"}》共 ${result.total} 音 · ${result.rows.length} 种减字${
                variantMerged > 0 ? ` · ${variantMerged} 种含写法变体` : ""
              }`}
        </p>
      </div>

      {/* ── 字频表 ── */}
      <div className="mt-3">
        {loading ? (
          wasmState === "error" ? (
            <p className="text-center text-[11px] tracking-wider text-red-400/80">
              引擎加载失败：{wasmError?.message ?? "未知错误"}，请刷新页面重试
            </p>
          ) : (
            <p className="text-center text-[11px] tracking-wider text-amber-700/40">
              减字引擎加载中…
            </p>
          )
        ) : error ? (
          <p className="text-center text-[11px] tracking-wider text-red-400/80">
            统计失败：{error}
          </p>
        ) : result.rows.length === 0 ? (
          <p className="text-center text-[11px] tracking-wider text-amber-700/40">
            这首曲谱没有可统计的减字
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="freq-rows">
            {result.rows.map((row) => (
              <FreqRowView key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>

      {/* ── 写法变体对照 ── */}
      {variants.length > 0 && (
        <div
          className="mt-4 rounded-lg border border-amber-700/20 bg-[var(--paper)]/40 p-4"
          data-testid="variant-groups"
        >
          <p className="mb-2 text-[10px] tracking-[0.2em] text-amber-700/60">
            写法变体对照（同一指法的不同写法）
          </p>
          <ul className="space-y-1.5">
            {variants.map((g) => (
              <li key={g.canonical} className="flex items-baseline gap-2 text-[10px]">
                <span className="w-10 shrink-0 text-stone-700">{g.canonical}</span>
                <span className="shrink-0 font-calligraphy text-[13px] tracking-[0.15em] text-[var(--ink)]">
                  {g.variants.join(" / ")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[9px] text-amber-700/45">
                  {g.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
