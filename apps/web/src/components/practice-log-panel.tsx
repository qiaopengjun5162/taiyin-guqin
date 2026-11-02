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
  streakDays,
  summarize,
  weekRange,
  type PracticeEntry,
} from "@/lib/practice-log";

/** 专注计时至少这么久才值得记一笔，避免点错了也留痕。 */
const MIN_TIMER_SECONDS = 10;

export function PracticeLogPanel({ scoreTitle = "" }: { scoreTitle?: string }) {
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
