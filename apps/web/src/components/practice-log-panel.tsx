"use client";

/**
 * 练习记录面板：打卡、专注计时、周/月汇总。
 *
 * 「日习一操」这件事，靠的不是功能多，而是能看见累积——所以首屏先给
 * 本周累计时长、练习天数、连续天数三个数，下面才是明细。
 *
 * 统计只读本地记录：没有账号、没有云端，换设备不同步。写清楚比假装有更好。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEntry,
  deleteEntry,
  formatDuration,
  listEntries,
  localDateKey,
  monthRange,
  recentDays,
  streakDays,
  summarize,
  weekRange,
  type PracticeEntry,
} from "@/lib/practice-log";
import type { StickingPoint } from "@/lib/practice-progress";

/** 专注计时至少这么久才值得记一笔，避免点错了也留痕。 */
const MIN_TIMER_SECONDS = 10;

/** 条带显示多少天。两周：够看出一周里固定断在哪天，又不至于挤成一排竖线。 */
const STRIP_DAYS = 14;

export function PracticeLogPanel({
  scoreTitle = "",
  sticking = [],
  onPracticePhrase,
}: {
  scoreTitle?: string;
  /** 练过但还没到原速的句子（由页面按当前谱算出）。 */
  sticking?: StickingPoint[];
  /** 点「练这句」直接进那一句的慢练。 */
  onPracticePhrase?: (index: number) => void;
}) {
  const [entries, setEntries] = useState<PracticeEntry[]>([]);
  const [tab, setTab] = useState<"week" | "month">("week");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 手动记一笔
  // 曲目默认跟随谱名：`null` 表示用户没改过；一旦动过（哪怕清空）就以用户为准。
  // 用「渲染时取默认值」而不是 effect 里同步 state —— 后者会多渲染一轮，也更容易和谱名打架。
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const title = titleDraft ?? scoreTitle;
  const [minutes, setMinutes] = useState("30");
  const [note, setNote] = useState("");

  // 专注计时
  const [timer, setTimer] = useState<"idle" | "running" | "paused">("idle");
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setEntries(await listEntries());
  }, []);

  /** 首屏读一次本地记录。setState 放在 then 回调里：effect 本体不同步改状态。 */
  useEffect(() => {
    let alive = true;
    void listEntries().then((list) => {
      if (alive) setEntries(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (timer !== "running") return;
    timerRef.current = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [timer]);

  const today = useMemo(() => new Date(), []);
  const summary = useMemo(() => {
    const range = tab === "week" ? weekRange(today) : monthRange(today);
    return summarize(entries, range.from, range.to);
  }, [entries, tab, today]);
  const streak = useMemo(() => streakDays(entries, today), [entries, today]);
  const maxScoreSeconds = summary.byScore[0]?.seconds ?? 0;

  // 逐日条带：回答「上一次练是几天前」，这是周/月汇总答不了的
  const strip = useMemo(() => recentDays(entries, today, STRIP_DAYS), [entries, today]);
  const stripMax = useMemo(
    () => Math.max(1, ...strip.map((d) => d.seconds)),
    [strip],
  );
  /** 上一次练习（不含今天）距今天数；今天练过则显示「今天」。 */
  const lastGap = useMemo(() => {
    const todayKey = localDateKey(today);
    if (entries.some((e) => e.date === todayKey)) return 0;
    const past = entries
      .map((e) => e.date)
      .filter((d) => d < todayKey)
      .sort();
    if (past.length === 0) return null;
    const last = new Date(`${past[past.length - 1]}T00:00:00`);
    const ms = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - last.getTime();
    return Math.max(1, Math.round(ms / 86400000));
  }, [entries, today]);

  async function handleManualAdd(e: React.FormEvent) {
    e.preventDefault();
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      setError("练习时长填个正数（分钟）。");
      return;
    }
    setError(null);
    await addEntry({ scoreTitle: title, seconds: mins * 60, note, source: "manual" });
    setNote("");
    await refresh();
    setNotice(`记下了 ${formatDuration(mins * 60)}${title.trim() ? ` · ${title.trim()}` : ""}。`);
  }

  async function handleTimerStop() {
    const seconds = timerSeconds;
    setTimer("idle");
    setTimerSeconds(0);
    if (seconds < MIN_TIMER_SECONDS) {
      setNotice("不到 10 秒，这次不记。");
      return;
    }
    await addEntry({ scoreTitle: title, seconds, note, source: "timer" });
    await refresh();
    setNotice(`专注 ${formatDuration(seconds)} 已记入练习。`);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("删除这条练习记录？")) return;
    await deleteEntry(id);
    await refresh();
  }

  const timerClock = `${Math.floor(timerSeconds / 60)}:${`${timerSeconds % 60}`.padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-4">
      {/* 汇总 */}
      <div>
        <div className="mb-2 flex items-center gap-1.5">
          {(["week", "month"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`min-h-[36px] rounded border px-2.5 text-[10px] tracking-wider transition-colors ${
                tab === t
                  ? "border-amber-600/50 bg-amber-800/15 text-stone-900"
                  : "border-amber-700/25 text-stone-600 hover:border-amber-600/50"
              }`}
            >
              {t === "week" ? "本周" : "本月"}
            </button>
          ))}
          <span className="ml-auto text-[10px] tracking-wider text-stone-500">
            {tab === "week" ? "周一起算" : `${today.getMonth() + 1} 月`}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: "累计练习", value: formatDuration(summary.seconds) },
            { label: "练习天数", value: `${summary.days} 天` },
            { label: "连续打卡", value: `${streak} 天` },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded border border-stone-300/70 bg-white/35 px-2 py-2 text-center"
            >
              <p className="text-[10px] tracking-wider text-stone-500">{s.label}</p>
              <p className="mt-0.5 text-[13px] font-semibold tracking-wide text-stone-800">
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* 逐日条带：空格子才是信息——它说明哪一天断了，而「练习天数 5 天」看不出来 */}
        <div className="mt-3 rounded border border-stone-300/70 bg-white/35 px-2 py-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] tracking-wider text-stone-500">
              近 {STRIP_DAYS} 天
            </span>
            <span className="text-[10px] tracking-wider text-stone-500" data-testid="last-practice">
              {lastGap === null
                ? "还没练过"
                : lastGap === 0
                  ? "今天练过"
                  : `上次练是 ${lastGap} 天前`}
            </span>
          </div>
          <div className="flex h-10 items-end gap-[3px]">
            {strip.map((d) => {
              const pct = d.seconds > 0 ? Math.max(8, Math.round((d.seconds / stripMax) * 100)) : 0;
              return (
                <div
                  key={d.date}
                  data-day={d.date}
                  data-seconds={d.seconds}
                  title={`${d.date.slice(5)} · ${d.seconds > 0 ? formatDuration(d.seconds) : "未练"}`}
                  className={`flex h-full flex-1 flex-col justify-end ${
                    d.isToday ? "rounded-sm ring-1 ring-amber-600/45" : ""
                  }`}
                >
                  <span
                    className={`block w-full rounded-sm ${
                      d.seconds > 0 ? "bg-amber-600/60" : "bg-stone-400/15"
                    }`}
                    style={{ height: d.seconds > 0 ? `${pct}%` : "3px" }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] tabular-nums tracking-wider text-stone-400">
            <span>{strip[0]?.date.slice(5)}</span>
            <span>今天</span>
          </div>
        </div>

        {/* 卡点句：练过但还没到原速，最慢的排前面 */}
        {sticking.length > 0 && (
          <div className="mt-2 rounded border border-amber-700/25 bg-amber-800/[0.06] px-2 py-2">
            <p className="text-[10px] tracking-wider text-amber-800/80">
              卡着的句子 · 练过但还没到原速
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {sticking.map((s) => (
                <li key={s.index} className="flex items-center gap-2">
                  <span className="text-[11px] tabular-nums tracking-wider text-stone-700">
                    第 {s.index + 1} 句
                  </span>
                  <span className="text-[10px] tabular-nums tracking-wider text-stone-500">
                    最高 {s.best}×
                  </span>
                  {onPracticePhrase && (
                    <button
                      type="button"
                      onClick={() => onPracticePhrase(s.index)}
                      aria-label={`慢练第 ${s.index + 1} 句`}
                      className="ml-auto min-h-[32px] rounded border border-amber-700/30 px-2 text-[10px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60"
                    >
                      练这句
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.byScore.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {summary.byScore.slice(0, 5).map((s) => (
              <div key={s.title} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[10px] tracking-wider text-stone-600">
                  {s.title}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-900/10">
                  <span
                    className="block h-full rounded-full bg-amber-600/70"
                    style={{
                      width: `${maxScoreSeconds > 0 ? Math.round((s.seconds / maxScoreSeconds) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right text-[10px] tabular-nums tracking-wider text-stone-500">
                  {formatDuration(s.seconds)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 专注计时 */}
      <div className="rounded border border-stone-300/70 bg-white/35 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] tracking-wider text-amber-800/80">专注计时</span>
          <span className="font-mono text-base tabular-nums text-stone-800" data-testid="timer-clock">
            {timerClock}
          </span>
          {timer === "idle" ? (
            <button
              type="button"
              onClick={() => setTimer("running")}
              aria-label="开始专注计时"
              className="min-h-[44px] rounded border border-amber-700/30 px-2.5 text-[10px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60"
            >
              开始
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setTimer(timer === "running" ? "paused" : "running")}
                aria-label={timer === "running" ? "暂停专注计时" : "继续专注计时"}
                className="min-h-[44px] rounded border border-amber-700/30 px-2.5 text-[10px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60"
              >
                {timer === "running" ? "暂停" : "继续"}
              </button>
              <button
                type="button"
                onClick={() => void handleTimerStop()}
                aria-label="结束专注计时并记一笔"
                className="min-h-[44px] rounded border border-[var(--vermillion)]/50 bg-[var(--vermillion)]/10 px-2.5 text-[10px] tracking-wider text-stone-800 transition-colors"
              >
                结束并记一笔
              </button>
            </>
          )}
        </div>
      </div>

      {/* 手动记一笔 */}
      <form onSubmit={(e) => void handleManualAdd(e)} className="flex flex-col gap-2">
        <p className="text-[10px] tracking-wider text-amber-800/80">补记一笔</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="曲目（可空）"
            aria-label="练习曲目"
            className="min-h-[44px] min-w-0 flex-1 rounded border border-amber-700/25 bg-white/40 px-2 text-[11px] text-stone-800 outline-none placeholder:text-stone-400 focus:border-amber-600/60"
          />
          <input
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            type="number"
            min={1}
            max={600}
            step={1}
            aria-label="练习时长（分钟）"
            className="min-h-[44px] w-16 rounded border border-amber-700/25 bg-white/40 px-2 text-[11px] tabular-nums text-stone-800 outline-none focus:border-amber-600/60"
          />
          <span className="text-[10px] tracking-wider text-stone-500">分钟</span>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="今天卡在哪一句？（可空）"
          aria-label="练习笔记"
          className="min-h-[44px] rounded border border-amber-700/25 bg-white/40 px-2 text-[11px] text-stone-800 outline-none placeholder:text-stone-400 focus:border-amber-600/60"
        />
        <button
          type="submit"
          className="min-h-[44px] self-start rounded border border-amber-700/35 px-3 text-[11px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60"
        >
          记一笔
        </button>
      </form>

      {error && (
        <p className="rounded border border-[var(--vermillion)]/30 bg-[var(--vermillion)]/10 px-2 py-1.5 text-[10px] leading-relaxed tracking-wider text-stone-700">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="rounded border border-emerald-700/25 bg-emerald-700/[0.07] px-2 py-1.5 text-[10px] leading-relaxed tracking-wider text-stone-700">
          {notice}
        </p>
      )}

      {/* 记录列表 */}
      <div>
        <p className="mb-1.5 text-[10px] tracking-wider text-amber-800/80">
          最近记录 {entries.length > 0 ? `· 共 ${entries.length} 条` : ""}
        </p>
        {entries.length === 0 ? (
          <p className="text-[10px] leading-relaxed tracking-wider text-stone-500">
            还没有练习记录。录一段音，或在上方补记一笔。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-stone-300/60">
            {entries.slice(0, 12).map((e) => (
              <li key={e.id} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] tracking-wider text-stone-800">
                    <span className="tabular-nums text-stone-500">
                      {e.date.slice(5)} {e.date === localDateKey(today) ? "· 今天" : ""}
                    </span>
                    <span className="mx-1.5 text-stone-400">|</span>
                    {e.scoreTitle.trim() || "未记曲目"}
                    <span className="ml-1.5 tabular-nums text-stone-500">
                      {formatDuration(e.seconds)}
                    </span>
                  </p>
                  {e.note && (
                    <p className="mt-0.5 truncate text-[10px] leading-relaxed tracking-wider text-stone-500">
                      {e.note}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(e.id)}
                  aria-label={`删除 ${e.date} 的 ${e.scoreTitle || "未记曲目"} 记录`}
                  className="min-h-[36px] px-1 text-[10px] tracking-wider text-stone-400 underline underline-offset-2 hover:text-[var(--vermillion)]"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[10px] leading-relaxed tracking-wider text-stone-500">
        记录只存在这台设备的浏览器里，不上传、不跨设备同步。
      </p>
    </div>
  );
}
