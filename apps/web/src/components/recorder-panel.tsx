"use client";

/**
 * 录音 · 回听面板。
 *
 * 练琴的人迟早都会想「我刚才那句到底什么样」。这里只做三件事：
 * 录、存本机、回听——不分析音准，也不上传。
 *
 * 录完自动记一条练习（曲目取当前曲谱标题、时长取真实录音时长），
 * 因为「录了三分钟」和「练了三分钟」对练琴的人来说是同一件事，
 * 让他再手填一遍纯属多余。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatDuration } from "@/lib/practice-log";
import {
  addEntry,
  deleteRecording,
  getRecordingBlob,
  isPersistentStorage,
  listRecordings,
  renameRecording,
  saveRecording,
  type RecordingMeta,
} from "@/lib/practice-log";
import {
  isRecordingSupported,
  micErrorMessage,
  startRecording,
  type RecordingSession,
} from "@/lib/recorder";

const LEVEL_BARS = 20;

/** 浏览器能力在页面生命周期内不会变，无需订阅。 */
const subscribeNoop = () => () => {};

function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mi = `${d.getMinutes()}`.padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export function RecorderPanel({ scoreTitle = "" }: { scoreTitle?: string }) {
  const [status, setStatus] = useState<"idle" | "recording" | "paused">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [persistent, setPersistent] = useState(true);

  // 「这个浏览器能不能录音」只能在浏览器里判断。用 useSyncExternalStore 读：
  // 服务端快照先给 true（不闪一条假的「不支持」横幅），挂载后再取真实值，
  // 也避免在 effect 里同步 setState 触发级联渲染。
  const supported = useSyncExternalStore<boolean>(
    subscribeNoop,
    isRecordingSupported,
    () => true,
  );

  const sessionRef = useRef<RecordingSession | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      setRecordings(await listRecordings());
      setPersistent(await isPersistentStorage());
    })();
  }, []);

  /** 卸载时释放麦克风与 blob url，否则录音指示灯会一直亮着 */
  useEffect(() => {
    return () => {
      sessionRef.current?.cancel();
      sessionRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  /** 录音中每 100ms 刷一次计时；暂停时读数停住不再涨 */
  useEffect(() => {
    if (status === "idle") return;
    const id = setInterval(() => {
      const session = sessionRef.current;
      if (session) setElapsed(session.elapsedSeconds());
    }, 100);
    return () => clearInterval(id);
  }, [status]);

  const handleStart = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const session = await startRecording({
        onLevel: (level) => setLevels((prev) => [...prev.slice(-(LEVEL_BARS - 1)), level]),
      });
      sessionRef.current = session;
      setLevels([]);
      setElapsed(0);
      setStatus("recording");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : micErrorMessage(e));
    }
  }, []);

  const handlePause = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (status === "paused") {
      session.resume();
      setStatus("recording");
    } else {
      session.pause();
      setStatus("paused");
    }
  }, [status]);

  const handleStop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      const result = await session.stop();
      sessionRef.current = null;
      setStatus("idle");
      setLevels([]);
      setElapsed(0);

      const seconds = Math.max(1, Math.round(result.seconds));
      const meta = await saveRecording({ blob: result.blob, seconds, scoreTitle });
      await addEntry({ scoreTitle, seconds, recordingId: meta.id, source: "recording" });
      setRecordings(await listRecordings());
      setNotice(`已存下「${meta.name}」，并记了一条 ${formatDuration(seconds)} 的练习。`);
    } catch (e) {
      sessionRef.current = null;
      setStatus("idle");
      setError(e instanceof Error ? e.message : "保存失败，请重试。");
    }
  }, [scoreTitle]);

  const handlePlay = useCallback(
    async (id: string) => {
      const el = audioRef.current;
      if (!el) return;
      if (playingId === id) {
        el.pause();
        return;
      }
      setError(null);
      const blob = await getRecordingBlob(id);
      if (!blob) {
        setError("这段录音没找到。隐私模式下可能没能存下来。");
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      el.src = url;
      try {
        await el.play();
        setPlayingId(id);
      } catch {
        setError("浏览器拒绝了播放，请再点一次。");
      }
    },
    [playingId],
  );

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`删除录音「${name}」？练习记录会保留。`)) return;
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
    await deleteRecording(id);
    setRecordings(await listRecordings());
  }

  async function commitRename(id: string) {
    await renameRecording(id, editName);
    setEditingId(null);
    setRecordings(await listRecordings());
  }

  const recording = status !== "idle";

  return (
    <div className="flex flex-col gap-3">
      <audio
        ref={audioRef}
        data-testid="recorder-audio"
        className="hidden"
        onEnded={() => setPlayingId(null)}
        onPause={() => setPlayingId(null)}
      />

      {!supported && (
        <p className="rounded border border-amber-700/25 bg-amber-100/60 px-2 py-1.5 text-[10px] leading-relaxed tracking-wider text-stone-700">
          这个浏览器不支持录音（或页面不在 https / localhost 下）。可以先用「跟录音练」导入已有音频。
        </p>
      )}

      {/* 计时 + 电平 */}
      <div className="rounded border border-stone-300/70 bg-white/35 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className="font-mono text-xl tabular-nums text-stone-800"
            data-testid="recorder-clock"
            aria-live="off"
          >
            {clock(elapsed)}
          </span>
          <span className="text-[10px] tracking-wider text-stone-500">
            {status === "recording"
              ? `录音中${scoreTitle ? ` · ${scoreTitle}` : ""}`
              : status === "paused"
                ? "已暂停"
                : "待录音"}
          </span>
        </div>

        <div className="mt-1.5 flex h-6 items-end gap-[2px]" aria-hidden>
          {Array.from({ length: LEVEL_BARS }, (_, i) => {
            const level = levels[i] ?? 0;
            return (
              <span
                key={i}
                className="flex-1 rounded-sm bg-[var(--vermillion)]/45 transition-[height] duration-75"
                style={{ height: `${Math.max(2, Math.round(level * 24))}px`, opacity: level > 0.02 ? 1 : 0.25 }}
              />
            );
          })}
        </div>
      </div>

      {/* 控制 */}
      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <button
            type="button"
            onClick={() => void handleStart()}
            disabled={!supported}
            aria-label="开始录音"
            className="min-h-[44px] rounded border border-[var(--vermillion)]/45 bg-[var(--vermillion)]/10 px-3 text-[11px] tracking-wider text-stone-800 transition-colors hover:border-[var(--vermillion)]/70 disabled:opacity-40"
          >
            ● 开始录音
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handlePause}
              aria-label={status === "paused" ? "继续录音" : "暂停录音"}
              className="min-h-[44px] rounded border border-amber-700/30 px-3 text-[11px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60"
            >
              {status === "paused" ? "继续" : "暂停"}
            </button>
            <button
              type="button"
              onClick={() => void handleStop()}
              aria-label="结束录音并保存"
              className="min-h-[44px] rounded border border-[var(--vermillion)]/50 bg-[var(--vermillion)]/10 px-3 text-[11px] tracking-wider text-stone-800 transition-colors hover:border-[var(--vermillion)]/70"
            >
              ■ 结束并保存
            </button>
          </>
        )}
        <span className="text-[10px] tracking-wider text-stone-500">
          {persistent ? "录音只存在这台设备" : "本机存不下，录音刷新后会消失"}
        </span>
      </div>

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

      {/* 录音列表 */}
      <div>
        <p className="mb-1.5 text-[10px] tracking-wider text-amber-800/80">
          录音 {recordings.length > 0 ? `· ${recordings.length} 段` : ""}
        </p>
        {recordings.length === 0 ? (
          <p className="text-[10px] leading-relaxed tracking-wider text-stone-500">
            还没有录音。练完一段按「开始录音」，结束时会自动记一条练习。
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-stone-300/60">
            {recordings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  {editingId === r.id ? (
                    <input
                      value={editName}
                      autoFocus
                      aria-label="录音名称"
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => void commitRename(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename(r.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full rounded border border-amber-700/30 bg-white/60 px-1.5 py-1 text-[11px] text-stone-800 outline-none focus:border-amber-600/60"
                    />
                  ) : (
                    <p className="truncate text-[11px] tracking-wider text-stone-800" title={r.name}>
                      {r.name}
                    </p>
                  )}
                  <p className="text-[10px] tracking-wider text-stone-500">
                    {stamp(r.createdAt)} · {formatDuration(r.seconds)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handlePlay(r.id)}
                  aria-label={playingId === r.id ? `停止播放 ${r.name}` : `播放 ${r.name}`}
                  className="min-h-[44px] rounded border border-amber-700/25 px-2 text-[10px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60"
                >
                  {playingId === r.id ? "停止" : "▶ 回听"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(r.id);
                    setEditName(r.name);
                  }}
                  aria-label={`重命名 ${r.name}`}
                  className="min-h-[44px] px-1 text-[10px] tracking-wider text-stone-500 underline underline-offset-2 hover:text-stone-700"
                >
                  改名
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(r.id, r.name)}
                  aria-label={`删除 ${r.name}`}
                  className="min-h-[44px] px-1 text-[10px] tracking-wider text-stone-400 underline underline-offset-2 hover:text-[var(--vermillion)]"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
