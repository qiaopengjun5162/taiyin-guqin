"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 跟录音练琴 —— 导入一段老师的录音，取其中一句反复磨。
 *
 * 三个动作覆盖了练琴时最常干的事：
 *  - 选段：标 A、标 B，只循环这一句；
 *  - 变速：0.5×–1.5× 且尽量不改变音高（preservesPitch）；
 *  - 定位：进度条随手拖到想听的地方。
 *
 * 音频只用 URL.createObjectURL 在内存里放，不上传、不落盘——
 * 老师的录音往往不宜公开，这也是静态站点唯一诚实的做法。
 */
/** 秒 → m:ss.s */
function formatTime(t: number | null): string {
  if (t == null || !isFinite(t) || t < 0) return "0:00.0";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

const RATES = [0.5, 0.75, 1, 1.25];

export function PracticePlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [pointA, setPointA] = useState<number | null>(null);
  const [pointB, setPointB] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 组件卸载时释放 blob url，否则换曲会泄漏整段音频 */
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  /** 变速不变调：浏览器支持时显式打开，免得慢放变成低八度 */
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const media = el as HTMLAudioElement & {
      preservesPitch?: boolean;
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    media.preservesPitch = true;
    media.mozPreservesPitch = true;
    media.webkitPreservesPitch = true;
    el.playbackRate = rate;
  }, [rate, fileName]);

  function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("audio/")) {
      setError("这不是音频文件。请选 mp3 / m4a / wav / ogg。");
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    const el = audioRef.current;
    if (el) {
      el.src = url;
      el.load();
    }
    setFileName(file.name);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setPointA(null);
    setPointB(null);
  }

  const a = pointA;
  const b = pointB;

  /** AB 循环：用 rAF 轮询（timeupdate 只有 ~250ms 精度，会拖出一截尾巴） */
  useEffect(() => {
    if (!loop || a == null || b == null || b <= a) return;
    let raf = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el && !el.paused && el.currentTime >= b) {
        el.currentTime = a;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loop, a, b]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !fileName) return;
    if (el.paused) {
      // 起点在区间外时先对到 A，否则第一遍听不到想练的那句
      if (loop && a != null && b != null && (el.currentTime < a || el.currentTime >= b)) {
        el.currentTime = a;
      }
      void el.play().catch(() => setError("浏览器拒绝了播放，请再点一次。"));
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, [fileName, loop, a, b]);

  function markA() {
    const el = audioRef.current;
    if (!el) return;
    const t = el.currentTime;
    setPointA(t);
    if (b != null && b <= t) setPointB(null);
  }

  function markB() {
    const el = audioRef.current;
    if (!el) return;
    const t = el.currentTime;
    if (a != null && t <= a) {
      setError("B 点要在 A 点之后。");
      return;
    }
    setError(null);
    setPointB(t);
  }

  function seek(t: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = t;
    setCurrentTime(t);
  }

  /** 标了 AB 才有意义；区间过短时给出提示而不是静默乱循环 */
  const abValid = a != null && b != null && b - a > 0.2;
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3">
      {/*
       * audio 必须常驻挂载：首次点「选择音频」时它得已经在 DOM 里，
       * 否则 audioRef 还是空，src 根本设不上去（第一次选文件会静默失败）。
       */}
      <audio
        ref={audioRef}
        data-testid="practice-audio"
        preload="auto"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* 选文件 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-amber-700/30 px-2.5 py-1.5 text-[11px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60 hover:text-stone-900">
          选择音频
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            aria-label="选择本地音频"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {fileName ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-stone-600" title={fileName}>
            {fileName}
          </span>
        ) : (
          <span className="text-[11px] text-stone-500">录音只在本地打开，不上传</span>
        )}
      </div>

      {fileName && (
        <>
          {/* 播放 / 循环 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? "暂停" : "播放"}
              className="min-h-[44px] rounded border border-amber-700/30 px-3 text-[11px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60 hover:text-stone-900"
            >
              {isPlaying ? "暂停" : "播放"}
            </button>
            <span className="font-mono text-[11px] tabular-nums text-stone-600">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <button
              onClick={() => setLoop((v) => !v)}
              aria-pressed={loop}
              aria-label="AB 循环"
              disabled={!abValid}
              title={abValid ? "只在 A–B 之间反复" : "先标 A、B 两点"}
              className={`min-h-[44px] rounded border px-3 text-[11px] tracking-wider transition-colors disabled:opacity-40 ${
                loop && abValid
                  ? "border-[var(--vermillion)]/60 bg-[var(--vermillion)]/10 text-stone-800"
                  : "border-amber-700/30 text-stone-700 hover:border-amber-600/60 hover:text-stone-900"
              }`}
            >
              AB 循环
            </button>
          </div>

          {/*
           * 进度条自绘：原生 range 的轨道跟着页面的暗色 color-scheme 走，
           * 落在宣纸卡片上就是一道黑杠。这里把 input 变透明只留拖拽，
           * 轨道与圆点用 div 画，颜色才能跟卡片一致。
           */}
          <div className="relative h-10 w-full">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-amber-900/15" />
            <div
              className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-amber-600"
              style={{ width: `${progressPercent}%` }}
            />
            <div
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-700/40 bg-amber-50 shadow-sm"
              style={{ left: `${progressPercent}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.05}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => seek(parseFloat(e.target.value))}
              aria-label="播放位置"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>

          {/* 标 A / B */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={markA}
              className="min-h-[44px] rounded border border-amber-700/30 px-2.5 text-[11px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60 hover:text-stone-900"
            >
              标记 A
            </button>
            <button
              onClick={markB}
              className="min-h-[44px] rounded border border-amber-700/30 px-2.5 text-[11px] tracking-wider text-stone-700 transition-colors hover:border-amber-600/60 hover:text-stone-900"
            >
              标记 B
            </button>
            <span className="font-mono text-[11px] tabular-nums text-stone-600">
              A {formatTime(a)} · B {formatTime(b)}
            </span>
            {(a != null || b != null) && (
              <button
                onClick={() => {
                  setPointA(null);
                  setPointB(null);
                  setLoop(false);
                }}
                className="text-[10px] tracking-wider text-stone-500 underline underline-offset-2 hover:text-stone-700"
              >
                清空
              </button>
            )}
          </div>

          {/* 变速 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] tracking-wider text-amber-800/70">速度</span>
            {RATES.map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                aria-pressed={rate === r}
                className={`min-h-[44px] rounded border px-2.5 text-[11px] tabular-nums tracking-wider transition-colors ${
                  rate === r
                    ? "border-amber-600/50 bg-amber-800/15 text-stone-900"
                    : "border-amber-700/25 text-stone-600 hover:border-amber-600/50 hover:text-stone-900"
                }`}
              >
                {r}×
              </button>
            ))}
            <span className="text-[10px] text-stone-500">变速不变调</span>
          </div>
        </>
      )}

      {error && (
        <p className="rounded border border-red-800/25 bg-red-900/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
