"use client";

/**
 * 琴面 · 音位全览。
 *
 * 一张七弦十三徽的图，点哪听哪；按住一条弦左右拖，音会跟着手走——
 * 这是「走手音」在屏幕上的最小实现，也是《虚拟古琴》里那句
 * 「按音和走手音，声音会随着手指的移动持续变化」对应的东西。
 *
 * 两件事刻意没做：
 *  - 不做外观定制（琴式、漆色、断纹）：那是审美，不是「最基本的」。
 *  - 不做「十三个按钮」：徽位之间是连续的，拖动时音高连续变化，
 *    一旦吸附成十三个点，古琴就不是古琴了。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BOARD_HUI,
  BOARD_STRINGS,
  boardDotAt,
  boardDots,
  ratioToHuiLabel,
  sameNoteDots,
  huiNumeral,
  huiRatio,
  type BoardDot,
} from "@/lib/qin-board";
import { usePitchContext } from "@/lib/use-pitch-context";
import { schedulePluck } from "@/lib/audio-synth";
import type { NoteType } from "@/lib/types";

/* ── 画布几何（与 viewBox 同一套数，改一处即可） ── */
const VIEW_W = 720;
const VIEW_H = 320;
const BODY_X = 32;
const BODY_Y = 52;
const BODY_W = 656;
const BODY_H = 240;
const STRING_X0 = 64;
const STRING_X1 = 656;
const STRING_Y0 = 84;
const STRING_GAP = 24;
const SCATTER_X = 48;
const HUI_LABEL_Y = 268;

const stringY = (index: number) => STRING_Y0 + index * STRING_GAP;
const huiX = (ratio: number) => STRING_X0 + (STRING_X1 - STRING_X0) * ratio;

/** 拖动时音高变化的最小刷新间隔（毫秒），够顺滑又不至于每像素都改一次频率。 */
const GLIDE_MIN_INTERVAL_MS = 16;

function clampRatio(v: number): number {
  return Math.min(0.95, Math.max(0.01, v));
}

export function QinBoard() {
  const { tuning, concertPitch } = usePitchContext();
  const [mode, setMode] = useState<NoteType>("按");
  const [active, setActive] = useState<BoardDot | null>(null);
  const [hoverMidi, setHoverMidi] = useState<number | null>(null);
  const [selectedMidi, setSelectedMidi] = useState<number | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const voiceRef = useRef<{
    osc: OscillatorNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null>(null);
  const dragRef = useRef<{ stringIndex: number; startX: number; moved: boolean } | null>(null);
  const lastGlideAt = useRef(0);

  const dots = useMemo(
    () => boardDots(mode, tuning, concertPitch),
    [mode, tuning, concertPitch],
  );
  // 空弦的位置永远画出来：不管在看按音还是泛音，「七根弦」都该在图上。
  const scatter = useMemo(() => boardDots("散", tuning, concertPitch), [tuning, concertPitch]);
  const visible = useMemo(
    () => (mode === "散" ? dots : [...scatter, ...dots]),
    [mode, dots, scatter],
  );

  const focusMidi = hoverMidi ?? selectedMidi;
  const sameNote = useMemo(
    () => (focusMidi === null ? [] : sameNoteDots(visible, focusMidi)),
    [visible, focusMidi],
  );

  const ensureCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const stopVoice = useCallback((fadeSeconds = 0.12) => {
    const voice = voiceRef.current;
    if (!voice) return;
    const ctx = ctxRef.current;
    voiceRef.current = null;
    if (!ctx) return;
    const now = ctx.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, fadeSeconds / 3);
      voice.osc.stop(now + fadeSeconds * 2);
    } catch {
      // 已经停了就算了
    }
  }, []);

  useEffect(() => {
    return () => {
      stopVoice(0.02);
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [stopVoice]);

  /** 点一下：拨一声，并把这个音名在全琴上的位置亮出来。 */
  const playDot = useCallback(
    (dot: BoardDot) => {
      const ctx = ensureCtx();
      setActive(dot);
      setSelectedMidi(dot.midi);
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      schedulePluck(ctx, dot.freq, ctx.currentTime + 0.01, 0.6, dot.kind);
    },
    [ensureCtx],
  );

  /** 走手音：一条持续音，频率跟着手指走。与点弦的拨弦是两种声音。 */
  const startGlide = useCallback(
    (freq: number) => {
      const ctx = ensureCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      stopVoice(0.05);

      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      filter.type = "lowpass";
      filter.frequency.value = Math.min(12000, freq * 5);
      filter.Q.value = 0.7;

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.16, now + 0.02);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);

      voiceRef.current = { osc, gain, filter };
    },
    [ensureCtx, stopVoice],
  );

  const glideTo = useCallback(
    (freq: number) => {
      const voice = voiceRef.current;
      const ctx = ctxRef.current;
      if (!voice || !ctx) return;
      const now = ctx.currentTime;
      voice.osc.frequency.setTargetAtTime(freq, now, 0.02);
      voice.filter.frequency.setTargetAtTime(Math.min(12000, freq * 5), now, 0.04);
    },
    [],
  );

  /** 屏幕坐标 → 第几弦、弦长比例。 */
  const pointToPosition = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((event.clientY - rect.top) / rect.height) * VIEW_H;
    const stringIndex = Math.round((y - STRING_Y0) / STRING_GAP);
    if (stringIndex < 0 || stringIndex > BOARD_STRINGS - 1) return null;
    return { stringIndex, ratio: clampRatio((x - STRING_X0) / (STRING_X1 - STRING_X0)) };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pos = pointToPosition(event);
    if (!pos) return;
    dragRef.current = { stringIndex: pos.stringIndex, startX: event.clientX, moved: false };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 6) return;
    const pos = pointToPosition(event);
    if (!pos) return;

    if (mode === "散") return; // 空弦没有「走手」
    const dot = boardDotAt(pos.stringIndex, pos.ratio, mode, tuning, concertPitch);
    if (!dot) return;

    if (!drag.moved) {
      drag.moved = true;
      // 拖动开始才捕获指针：提前捕获会把圆点的 click 抢走，点一下就没声。
      event.currentTarget.setPointerCapture?.(event.pointerId);
      startGlide(dot.freq);
    }
    setActive(dot);

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastGlideAt.current < GLIDE_MIN_INTERVAL_MS) return;
    lastGlideAt.current = now;
    glideTo(dot.freq);
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) stopVoice();
  };

  const hint =
    mode === "散"
      ? "散音就是空弦：点一下听空弦。"
      : `${mode}音 ${dots.length} 个位置 + 七根空弦 · 点一下听，按住左右拖是走手音`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["按", "泛", "散"] as NoteType[]).map((k) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            aria-pressed={mode === k}
            className={`min-h-[34px] rounded border px-3 text-[11px] tracking-wider transition-colors ${
              mode === k
                ? "border-amber-700/60 bg-amber-800/15 text-stone-900"
                : "border-amber-700/25 text-stone-600 hover:border-amber-600/50"
            }`}
          >
            {k}音
          </button>
        ))}
        <span className="text-[10px] text-stone-500">{hint}</span>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full select-none touch-none"
        role="img"
        aria-label="古琴琴面音位全览：七弦十三徽"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* 琴身 */}
        <rect
          x={BODY_X}
          y={BODY_Y}
          width={BODY_W}
          height={BODY_H}
          rx="10"
          fill="#f6ecd8"
          stroke="#c2a173"
          strokeWidth="1.2"
        />
        {/* 岳山（右手弹弦处）与龙龈 */}
        <line x1={STRING_X0} y1={BODY_Y + 6} x2={STRING_X0} y2={BODY_Y + BODY_H - 6} stroke="#b08a5a" strokeWidth="2.4" />
        <line x1={STRING_X1} y1={BODY_Y + 6} x2={STRING_X1} y2={BODY_Y + BODY_H - 6} stroke="#b08a5a" strokeWidth="1.4" />

        {/* 徽位刻度与编号 */}
        {Array.from({ length: BOARD_HUI }, (_, i) => i + 1).map((hui) => {
          const x = huiX(huiRatio(hui));
          return (
            <g key={`hui-${hui}`}>
              <line
                x1={x}
                y1={BODY_Y + 8}
                x2={x}
                y2={BODY_Y + BODY_H - 8}
                stroke="#a98a5c"
                strokeDasharray="2 4"
                strokeWidth="0.8"
                opacity="0.55"
              />
              <text
                x={x}
                y={hui >= 11 ? HUI_LABEL_Y + 13 : HUI_LABEL_Y}
                textAnchor="middle"
                fontSize={hui >= 11 ? 9 : 10}
                fill="#6b563c"
                opacity="0.75"
              >
                {huiNumeral(hui)}
              </text>
            </g>
          );
        })}

        {/* 七根弦 */}
        {Array.from({ length: BOARD_STRINGS }, (_, s) => (
          <line
            key={`string-${s}`}
            x1={SCATTER_X - 10}
            y1={stringY(s)}
            x2={STRING_X1}
            y2={stringY(s)}
            stroke="#8a6a44"
            strokeWidth={s === 0 ? 1.6 : 1}
            opacity="0.5"
          />
        ))}

        {/* 落点 */}
        {visible.map((dot) => {
          const isSame = focusMidi !== null && Math.round(dot.midi) === Math.round(focusMidi);
          const dim = focusMidi !== null && !isSame;
          const isActive = active?.key === dot.key;
          const cx = dot.hui == null ? SCATTER_X : huiX(dot.ratio);
          const cy = stringY(dot.stringIndex);
          return (
            <circle
              key={dot.key}
              data-testid="qin-board-dot"
              data-key={dot.key}
              role="button"
              tabIndex={0}
              aria-label={`${dot.stringNumber}弦${dot.hui == null ? "散音" : `${huiNumeral(dot.hui)}徽`} ${dot.noteName}`}
              cx={cx}
              cy={cy}
              r={isSame || isActive ? 6.5 : 4.5}
              fill={dot.kind === "泛" ? "transparent" : isSame ? "#b03a2e" : "#8a5a2b"}
              stroke={isActive ? "#b03a2e" : dot.kind === "泛" ? "#8a5a2b" : "none"}
              strokeWidth={isActive ? 2 : 1.2}
              opacity={dim ? 0.22 : 1}
              style={{ cursor: "pointer" }}
              onClick={() => playDot(dot)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  playDot(dot);
                }
              }}
              onPointerEnter={() => setHoverMidi(dot.midi)}
              onPointerLeave={() => setHoverMidi(null)}
            />
          );
        })}

        {/* 左侧「散」标 */}
        <text x={SCATTER_X} y={BODY_Y - 8} textAnchor="middle" fontSize="10" fill="#6b563c" opacity="0.7">
          散
        </text>
        <text x={STRING_X0 + 8} y={BODY_Y - 8} textAnchor="start" fontSize="10" fill="#6b563c" opacity="0.5">
          岳山
        </text>
      </svg>

      <div className="min-h-[42px] rounded border border-amber-700/20 bg-amber-50/60 px-3 py-2 text-[11px] text-stone-700">
        {active ? (
          <div className="flex flex-col gap-1">
            <div>
              <span className="text-stone-900">
                {active.kind === "散"
                  ? `${active.stringNumber}弦 · 散音`
                  : `${active.stringNumber}弦 · ${ratioToHuiLabel(active.ratio)} · ${active.kind}音`}
              </span>
              <span className="ml-2 text-stone-600">
                {active.noteName}
                {Math.abs(active.cents) >= 8 ? `（${active.cents > 0 ? "+" : ""}${active.cents} 音分）` : ""}
                {" · "}
                {active.freq.toFixed(1)} Hz
              </span>
            </div>
            <div className="text-stone-500">
              {sameNote.length > 1
                ? `${active.noteName} 在这张琴上还有 ${sameNote.length - 1} 个位置，图上已点亮`
                : `${active.noteName} 在这张琴上只有这一处`}
            </div>
          </div>
        ) : (
          <span className="text-stone-500">
            点图上任意一点听音；鼠标悬停可看同一音名在琴上的其他位置。
          </span>
        )}
      </div>
    </div>
  );
}
