"use client";

import { useState, useRef } from "react";
import {
  type JianziState,
  type NoteColumn,
  type JianpuNumber,
  type Duration,
  type JianpuOctave,
  DEFAULT_KEYBOARD,
  DEFAULT_JIANPU_NUMBERS,
  DEFAULT_DURATIONS,
  type NoteType,
  type RhythmMode,
} from "@/lib/types";
import {
  createEmptyState,
  isComplete,
  jianziToText,
  parseJianziText,
} from "@/lib/jianzi";
import { lookupPinyin } from "@/lib/pinyin-dict";
import { JianzipuPreview } from "./jianzipu-preview";

type Section =
  | "toneType"
  | "rhythmMode"
  | "leftFinger"
  | "hui"
  | "fen"
  | "rightAction"
  | "stringNumber";

/**
 * 减字键盘主组件。
 *
 * 流程：先选音色（散/泛/按）和节奏（板/散/宕），再按顺序拼装。
 *
 * 右手指法采用传统减字偏旁：
 * 乇=托 尸=擘 木=抹 乚=挑 勹=勾 剔 丁=打 倽=摘
 */
export function JianzipuKeyboard({
  onAppend,
  defaultNote,
}: {
  onAppend?: (note: NoteColumn) => void;
  defaultNote?: NoteColumn;
}) {
  /*
   * 编辑模式：父组件通过 key 变化触发 remount，useState 的 init function 在此刻执行，
   * 用 defaultNote 回填所有字段。追加模式下 defaultNote 为 undefined，使用默认初值。
   * 所有字段各自的 useState 独立初始化，便于后续部分重置（如确认后只清左右手、保留音色）。
   */
  const [state, setState] = useState<JianziState>(() => {
    if (defaultNote) return { ...defaultNote.jianzi };
    return { ...createEmptyState(), toneType: "散" };
  });
  const [jianpuNumber, setJianpuNumber] = useState<JianpuNumber | null>(
    () => defaultNote?.jianpuNumber ?? null,
  );
  const [jianpuOctave, setJianpuOctave] = useState<JianpuOctave>(
    () => defaultNote?.jianpuOctave ?? "",
  );
  const [jianpuDot, setJianpuDot] = useState(
    () => defaultNote?.jianpuDot ?? false,
  );
  const [duration, setDuration] = useState<Duration>(
    () => defaultNote?.duration ?? "四分",
  );
  const [inputMode, setInputMode] = useState<"point" | "pinyin">("point");
  const [pinyinText, setPinyinText] = useState(() => {
    if (defaultNote) return jianziToText(defaultNote.jianzi);
    return "";
  });
  const [activeTab, setActiveTab] = useState<"rhythm" | "finger">("finger");

  function handleSelect(section: Section, value: string) {
    setState((prev) => {
      const next = {
        ...prev,
        [section]: value === "" ? null : value,
      };
      // 古琴乐理：散音（空弦）不存在左手指法和徽分
      if (section === "toneType" && value === "散") {
        next.leftFinger = null;
        next.hui = null;
        next.fen = null;
      }
      return next;
    });
  }

  function handleReset() {
    setState(
      defaultNote
        ? { ...defaultNote.jianzi }
        : { ...createEmptyState(), toneType: "散" },
    );
    setJianpuNumber(defaultNote?.jianpuNumber ?? null);
    setJianpuOctave(defaultNote?.jianpuOctave ?? "");
    setJianpuDot(defaultNote?.jianpuDot ?? false);
    setDuration(defaultNote?.duration ?? "四分");
    setActiveTab("finger");
    setPinyinText(defaultNote ? jianziToText(defaultNote.jianzi) : "");
  }

  function handleConfirm() {
    if (!isComplete(state)) return;
    const note: NoteColumn = {
      // 编辑模式保留原始 ID 避免 key 变化导致 React 卸载/重挂
      id: defaultNote?.id ?? crypto.randomUUID(),
      jianpuNumber,
      jianpuOctave,
      jianpuDot,
      duration,
      jianzi: state,
    };
    onAppend?.(note);
    // 提交后只保留音色和节奏模式语境，清空左右手和徽分
    setState((prev) => ({
      ...createEmptyState(),
      toneType: prev.toneType,
      rhythmMode: prev.rhythmMode,
    }));
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* ── 输入模式切换 ── */}
      <div className="flex w-full border border-stone-700/20 rounded overflow-hidden">
        <button
          onClick={() => setInputMode("point")}
          className={`flex-1 py-2 text-xs tracking-wider transition-all duration-200 ${
            inputMode === "point"
              ? "bg-stone-800 text-amber-50"
              : "bg-transparent text-stone-500 hover:text-stone-300"
          }`}
        >
          点选
        </button>
        <button
          onClick={() => setInputMode("pinyin")}
          className={`flex-1 py-2 text-xs tracking-wider transition-all duration-200 ${
            inputMode === "pinyin"
              ? "bg-stone-800 text-amber-50"
              : "bg-transparent text-stone-500 hover:text-stone-300"
          }`}
        >
          拼音
        </button>
      </div>

      {/* ── 预览区 ── */}
      <div className="flex flex-col items-center gap-2">
        <JianzipuPreview state={state} />
      </div>

      {/* ── 输入模式内容 ── */}
      {inputMode === "pinyin" ? (
        <div className="w-full">
          <PinyinInput
            value={pinyinText}
            onChange={setPinyinText}
            onSubmit={(text) => {
              if (!text.trim()) return;
              const parsed = /[一-鿿]/.test(text) ? parseJianziText(text) : null;
              const jianzi = parsed ?? createEmptyState();
              // 编辑模式下保留原有简谱/时值数据
              const note: NoteColumn = {
                id: defaultNote?.id ?? crypto.randomUUID(),
                jianpuNumber: defaultNote?.jianpuNumber ?? null,
                jianpuOctave: defaultNote?.jianpuOctave ?? "",
                jianpuDot: defaultNote?.jianpuDot ?? false,
                duration: defaultNote?.duration ?? "四分",
                jianzi,
              };
              onAppend?.(note);
              setPinyinText("");
            }}
          />
        </div>
      ) : (
        <>
          {/* ── Tab 切换：琴艺指法 / 乐理时值 ── */}
          <div className="flex w-full border border-stone-700/20 rounded overflow-hidden">
            <button
              onClick={() => setActiveTab("finger")}
              className={`flex-1 py-2.5 text-xs tracking-[0.2em] transition-all duration-200 ${
                activeTab === "finger"
                  ? "bg-stone-800 text-amber-50"
                  : "bg-transparent text-stone-500 hover:text-stone-300"
              }`}
            >
              琴艺 · 指法
            </button>
            <button
              onClick={() => setActiveTab("rhythm")}
              className={`flex-1 py-2.5 text-xs tracking-[0.2em] transition-all duration-200 ${
                activeTab === "rhythm"
                  ? "bg-stone-800 text-amber-50"
                  : "bg-transparent text-stone-500 hover:text-stone-300"
              }`}
            >
              乐理 · 时值
            </button>
          </div>

          {/* ── Tab 内容 ── */}
          {activeTab === "rhythm" && (
            <div className="w-full space-y-5 animate-stamp">
              <SectionGroup
                label="简谱"
                items={DEFAULT_JIANPU_NUMBERS}
                active={jianpuNumber}
                onSelect={(v) => setJianpuNumber(v as JianpuNumber)}
              />
              <div className="flex items-end gap-4">
                <div>
                  <p className="text-[11px] tracking-[0.15em] text-stone-500 mb-1.5">
                    八度
                  </p>
                  <div className="flex gap-1.5">
                    {(["·", "", ","] as JianpuOctave[]).map((oct) => (
                      <button
                        key={oct || "mid"}
                        onClick={() => setJianpuOctave(jianpuOctave === oct ? "" : oct)}
                        className={`px-2.5 py-1.5 text-xs rounded border transition-all duration-150 active:scale-95 ${
                          jianpuOctave === oct
                            ? "border-amber-700/60 bg-amber-700/90 text-amber-50 shadow-sm"
                            : "border-stone-300/50 text-stone-600 hover:border-amber-600/30 hover:bg-amber-50 hover:text-stone-800"
                        }`}
                      >
                        {oct === "·" ? "高" : oct === "," ? "低" : "中"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] tracking-[0.15em] text-stone-500 mb-1.5">
                    附点
                  </p>
                  <button
                    onClick={() => setJianpuDot(!jianpuDot)}
                    className={`px-3 py-1.5 text-xs rounded border transition-all duration-150 active:scale-95 ${
                      jianpuDot
                        ? "border-amber-700/60 bg-amber-700/90 text-amber-50 shadow-sm"
                        : "border-stone-300/50 text-stone-600 hover:border-amber-600/30 hover:bg-amber-50 hover:text-stone-800"
                    }`}
                  >
                    {jianpuDot ? "· 开启" : "— 关闭"}
                  </button>
                </div>
              </div>
              <SectionGroup
                label="时值"
                items={DEFAULT_DURATIONS}
                active={duration}
                onSelect={(v) => setDuration(v as Duration)}
              />
            </div>
          )}

          {activeTab === "finger" && (
            <div className="w-full space-y-5 animate-stamp">
              <SectionGroup
                label="音色"
                items={DEFAULT_KEYBOARD.toneTypes}
                active={state.toneType}
                onSelect={(v) => handleSelect("toneType", v as NoteType)}
              />
              <SectionGroup
                label="节奏"
                items={DEFAULT_KEYBOARD.rhythmModes}
                active={state.rhythmMode}
                onSelect={(v) => handleSelect("rhythmMode", v as RhythmMode)}
              />
              {state.toneType && state.toneType !== "散" && (
                <SectionGroup
                  label="左手"
                  items={DEFAULT_KEYBOARD.leftFingers}
                  active={state.leftFinger}
                  onSelect={(v) => handleSelect("leftFinger", v)}
                />
              )}
              {state.toneType && state.toneType !== "散" && (
                <SectionGroup
                  label="徽位"
                  items={DEFAULT_KEYBOARD.huiPositions}
                  active={state.hui}
                  onSelect={(v) => handleSelect("hui", v)}
                />
              )}
              {state.toneType && state.toneType !== "散" && (
                <SectionGroup
                  label="分"
                  items={DEFAULT_KEYBOARD.fenOptions}
                  active={state.fen}
                  onSelect={(v) => handleSelect("fen", v)}
                />
              )}
              <SectionGroup
                label="右手"
                items={DEFAULT_KEYBOARD.rightActions}
                active={state.rightAction}
                onSelect={(v) => handleSelect("rightAction", v)}
              />
              <SectionGroup
                label="弦序"
                items={DEFAULT_KEYBOARD.stringNumbers}
                active={state.stringNumber}
                onSelect={(v) => handleSelect("stringNumber", v)}
              />
            </div>
          )}

          {/* ── 操作按钮（点选模式） ── */}
          <div className="flex gap-3 w-full">
            <button
              onClick={handleReset}
              className="flex-1 px-4 py-2.5 text-sm rounded border border-amber-700/30 text-stone-600 hover:bg-amber-700/10 hover:text-stone-800 transition-all duration-200 active:scale-[0.98]"
            >
              重置
            </button>
            <button
              onClick={handleConfirm}
              disabled={!isComplete(state)}
              className="flex-1 px-4 py-2.5 text-sm rounded bg-stone-800 text-amber-50 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-700 active:scale-[0.98] transition-all duration-200"
            >
              {defaultNote ? "更新" : "确认"}
            </button>
          </div>
          {/* 缺失字段提示 */}
          {!isComplete(state) && <MissingFields state={state} />}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 墨色按键组
// ──────────────────────────────────────────────

function SectionGroup({
  label,
  items,
  active,
  onSelect,
}: {
  label: string;
  items: string[];
  active: string | null;
  onSelect: (value: string) => void;
}) {
  const isFen = label === "分";

  return (
    <div>
      <p className="text-[11px] tracking-[0.15em] text-stone-500 mb-1.5">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {isFen && (
          <button
            onClick={() => onSelect("")}
            className={`px-2.5 py-1 text-xs rounded border transition-all duration-150 ${
              active === null || active === ""
                ? "border-stone-800 bg-stone-800 text-amber-50"
                : "border-stone-300/60 text-stone-400 hover:border-stone-400 hover:text-stone-600"
            }`}
          >
            无
          </button>
        )}
        {items.map((item) => (
          <button
            key={item}
            onClick={() => onSelect(active === item ? "" : item)}
            className={`px-3 py-1.5 text-sm rounded border transition-all duration-150 active:scale-95 ${
              active === item
                ? "border-amber-700/60 bg-amber-700/90 text-amber-50 shadow-sm"
                : "border-stone-300/50 text-stone-600 hover:border-amber-600/30 hover:bg-amber-50 hover:text-stone-800"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 拼音输入组件（带动态候选词下拉）
// ──────────────────────────────────────────────

function PinyinInput({
  value: text,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string) => void;
}) {
  const [matches, setMatches] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 获取当前最后一个 token */
  function getCurrentToken(val: string): string {
    const tokens = val.split(/[\s,，]+/);
    return tokens[tokens.length - 1] ?? "";
  }

  function handleChange(val: string) {
    onChange(val);
    const token = getCurrentToken(val);
    if (token) {
      const results = lookupPinyin(token);
      setMatches(results);
      setSelectedIdx(-1);
    } else {
      setMatches([]);
    }
  }

  function selectMatch(char: string) {
    const tokens = text.split(/[\s,，]+/);
    tokens[tokens.length - 1] = char;
    onChange(tokens.join(" ") + " ");
    setMatches([]);
    setSelectedIdx(-1);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] tracking-[0.15em] text-stone-500">
        输入汉字（如 大九勾四）或拼音（如 da gou），敲回车确认。
      </p>
      <div className="flex gap-2 relative">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && selectedIdx >= 0 && matches[selectedIdx]) {
                selectMatch(matches[selectedIdx]);
                e.preventDefault();
              } else if (e.key === "Enter") {
                onSubmit(text);
              } else if (e.key === "ArrowDown") {
                setSelectedIdx((i) => Math.min(i + 1, matches.length - 1));
                e.preventDefault();
              } else if (e.key === "ArrowUp") {
                setSelectedIdx((i) => Math.max(i - 1, 0));
                e.preventDefault();
              } else if (e.key === " " && matches.length > 0) {
                // 空格选当前 token 的首个候选
                e.preventDefault();
                selectMatch(matches[0]);
              }
            }}
            placeholder="例：大九勾四  或  da gou"
            className="w-full px-3 py-2 text-sm rounded border border-stone-300/50 bg-[#f8f3eb] text-stone-800 placeholder:text-stone-400/40 outline-none focus:border-amber-600/40 focus:ring-1 focus:ring-amber-600/20 transition-all"
          />
          {/* 候选词下拉 */}
          {matches.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-stone-300 rounded-lg shadow-xl overflow-hidden">
              {matches.map((char, i) => (
                <button
                  key={char}
                  onClick={() => selectMatch(char)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`w-full px-3 py-2 text-sm text-left transition-colors ${
                    i === selectedIdx
                      ? "bg-amber-100 text-stone-900 font-medium"
                      : "text-stone-700 hover:bg-amber-50"
                  }`}
                >
                  {char}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onSubmit(text)}
          disabled={!text.trim()}
          className="px-4 py-2 text-sm rounded bg-stone-800 text-amber-50 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-700 active:scale-[0.98] transition-all duration-200"
        >
          提交
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 缺失字段提示
// ──────────────────────────────────────────────

function MissingFields({ state }: { state: JianziState }) {
  const missing: string[] = [];
  if (!state.toneType) {
    missing.push("音色");
  } else if (state.toneType === "散") {
    if (!state.rightAction) missing.push("右手指法");
    if (!state.stringNumber) missing.push("弦序");
  } else {
    if (!state.leftFinger) missing.push("左手指法");
    if (!state.hui) missing.push("徽位");
    if (!state.rightAction) missing.push("右手指法");
    if (!state.stringNumber) missing.push("弦序");
  }

  return (
    <p className="mt-2 text-[10px] tracking-wider text-amber-600/50 text-center select-none">
      还缺：{missing.join("、")}
    </p>
  );
}
