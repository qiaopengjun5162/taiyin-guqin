"use client";

import { useState, useRef } from "react";
import { SavedJianziBar } from "./saved-jianzi-bar";
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
import {
  parseRapidInput,
  normalizeRapidInput,
  RAPID_CHEATSHEET,
  RAPID_SLOT_LABEL,
} from "@/lib/jianzi-rapid";
import { JianzipuPreview } from "./jianzipu-preview";
import { JianziExplainPanel } from "./jianzi-explain-panel";

type Section =
  | "toneType"
  | "rhythmMode"
  | "leftFinger"
  | "hui"
  | "fen"
  | "slide"
  | "rightAction"
  | "stringNumber";

/**
 * 装饰记号拆两组摆：绰/注 是走手音（真的滑音），急 是弹法（音高不动）。
 * 数据层是同一个 slide 字段——字体只有这一个槽位，三者互斥。
 */
const SLIDE_ONLY = DEFAULT_KEYBOARD.slides.filter((s) => s !== "急");
const URGENT_ONLY = DEFAULT_KEYBOARD.slides.filter((s) => s === "急");

/** 连打模式还没敲出字时，「我的减字」的 current 用这个空状态（模块级，别每次渲染新建）。 */
const EMPTY_JIANZI: JianziState = createEmptyState();

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
  const [inputMode, setInputMode] = useState<"point" | "pinyin" | "rapid">(
    "point",
  );
  /**
   * 连打刚打完的那个字。
   *
   * 连打是「打满即入谱」，输入框立刻清空，主 state 里并没有「正在拼的字」。
   * 但「我的减字」要靠 current 才知道能存什么——若不给它这个字，
   * 连打模式下「存为常用 / 图 / 矢」永远点不动，
   * 「敲一个字 → 存成 PNG 贴笔记」这条轻用路径就断了。
   */
  const [lastRapid, setLastRapid] = useState<JianziState | null>(null);
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
        next.slide = null;
      }
      // 走手音只在按音上成立：改判成散/泛时必须清掉，
      // 否则谱面会留一个弹不出来的标记
      if (section === "toneType" && value !== "按") {
        next.slide = null;
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
        {(
          [
            ["point", "点选"],
            ["pinyin", "拼音"],
            ["rapid", "连打"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setInputMode(mode)}
            className={`flex-1 py-2 text-xs tracking-wider transition-all duration-200 ${
              inputMode === mode
                ? "bg-stone-800 text-amber-50"
                : "bg-transparent text-stone-500 hover:text-stone-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 预览区（连打模式在输入框旁自带实时预览） ── */}
      {inputMode !== "rapid" && (
        <div className="flex w-full flex-col items-center gap-2">
          <JianzipuPreview state={state} />
          <JianziExplainPanel state={state} />
        </div>
      )}

      {/* ── 输入模式内容 ── */}
      {inputMode === "rapid" ? (
        <div className="w-full">
          <RapidInput
            toneType={state.toneType ?? "散"}
            onToneType={(t) => handleSelect("toneType", t)}
            onCommit={(jianzi) => {
              // 入谱的同时记住这个字：连打没有「编辑态预览」，
              // 少了这一步「我的减字」就永远没有可存的字。
              setLastRapid(jianzi);
              onAppend?.({
                id: defaultNote?.id ?? crypto.randomUUID(),
                jianpuNumber: defaultNote?.jianpuNumber ?? null,
                jianpuOctave: defaultNote?.jianpuOctave ?? "",
                jianpuDot: defaultNote?.jianpuDot ?? false,
                duration: defaultNote?.duration ?? "四分",
                jianzi,
              });
              // 连打是「一个谱字接一个谱字」的流水录入，提交后只保留音色语境
              setState((prev) => ({
                ...createEmptyState(),
                toneType: prev.toneType,
                rhythmMode: prev.rhythmMode,
              }));
            }}
          />
        </div>
      ) : inputMode === "pinyin" ? (
        <div className="w-full">
          <PinyinInput
            value={pinyinText}
            onChange={setPinyinText}
            onSubmit={(text) => {
              if (!text.trim()) return false;
              // 纯拼音（未经过候选词替换成汉字）解析不出减字：
              // 返回 false 让输入框把原因说出来，别让回车石沉大海。
              if (!/[一-鿿]/.test(text)) return false;
              const parsed = parseJianziText(text);
              // 散音分支只做「尽力而为」的解析，缺字段也返回对象——
              // 这里必须再验一次完整性，否则会往谱面追加一个空壳谱字。
              if (!parsed || !isComplete(parsed)) return false;
              // 编辑模式下保留原有简谱/时值数据
              const note: NoteColumn = {
                id: defaultNote?.id ?? crypto.randomUUID(),
                jianpuNumber: defaultNote?.jianpuNumber ?? null,
                jianpuOctave: defaultNote?.jianpuOctave ?? "",
                jianpuDot: defaultNote?.jianpuDot ?? false,
                duration: defaultNote?.duration ?? "四分",
                jianzi: parsed,
              };
              onAppend?.(note);
              setPinyinText("");
              return true;
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
                    {(["··", "·", "", ",", ",,"] as JianpuOctave[]).map((oct) => (
                      <button
                        key={oct || "mid"}
                        onClick={() => setJianpuOctave(jianpuOctave === oct ? "" : oct)}
                        className={`px-2.5 py-1.5 text-xs rounded border transition-all duration-150 active:scale-95 ${
                          jianpuOctave === oct
                            ? "border-amber-700/60 bg-amber-700/90 text-amber-50 shadow-sm"
                            : "border-stone-300/50 text-stone-600 hover:border-amber-600/30 hover:bg-amber-50 hover:text-stone-800"
                        }`}
                      >
                        {oct === "··" ? "高二" : oct === "·" ? "高" : oct === "," ? "低" : oct === ",," ? "低二" : "中"}
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
              {/* 装饰记号：绰/注 是按音的走手音（滑音），急 是急弹记号。
                  字体把三者压进同一个槽位（互斥、三选一），所以写的是同一个字段；
                  但读法不同，界面上分两组摆，免得以为「急」也会滑音。
                  散音没有左手可滑，泛音是虚按徽位一滑就脱离节点，都不给这两栏。 */}
              {state.toneType === "按" && (
                <>
                  <SectionGroup
                    label="走手音"
                    items={SLIDE_ONLY}
                    active={state.slide}
                    onSelect={(v) => handleSelect("slide", v)}
                  />
                  <SectionGroup
                    label="弹法"
                    items={URGENT_ONLY}
                    active={state.slide}
                    onSelect={(v) => handleSelect("slide", v)}
                  />
                </>
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

      {/* ── 我的减字：三种录入模式都要能存图 ──
          原先这块只挂在「预览区」里，连打模式下整块不渲染；
          而连打又是最快的录字方式，于是「敲一个字 → 存成 PNG 贴笔记」
          这条最高频的轻用路径是断的。现在统一放在输入区之后：
          连打用「刚打完的那个字」，点选 / 拼音用正在拼的字。 */}
      <SavedJianziBar
        current={inputMode === "rapid" ? (lastRapid ?? EMPTY_JIANZI) : state}
        onPick={(picked) => {
          setState({ ...picked });
          setPinyinText(jianziToText(picked));
          setLastRapid(picked);
          // 连打没有编辑态预览，填回要看得见就切回点选
          if (inputMode === "rapid") setInputMode("point");
        }}
      />
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
  /** 返回 true = 已入谱；false = 没读懂，输入框要说明原因。 */
  onSubmit: (text: string) => boolean;
}) {
  const [matches, setMatches] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [reject, setReject] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 提交并给出失败原因——打字打谱最怕回车没反应。 */
  function submit(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (onSubmit(text)) {
      setReject(null);
      return;
    }
    setReject(
      /[一-鿿]/.test(text)
        ? "没读懂这个谱字：按「左手 + 徽位 + 分数 + 绰/注/急 + 右手 + 弦」的顺序写，例：大九六绰勾四"
        : "先把拼音选成汉字，再回车入谱",
    );
  }

  /** 获取当前最后一个 token */
  function getCurrentToken(val: string): string {
    const tokens = val.split(/[\s,，]+/);
    return tokens[tokens.length - 1] ?? "";
  }

  function handleChange(val: string) {
    onChange(val);
    setReject(null);
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
        输入汉字（如 大九勾四 / 大九六绰勾四）或拼音（如 da gou），敲回车入谱。
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
                submit(text);
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
          onClick={() => submit(text)}
          disabled={!text.trim()}
          className="px-4 py-2 text-sm rounded bg-stone-800 text-amber-50 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-700 active:scale-[0.98] transition-all duration-200"
        >
          提交
        </button>
      </div>
      {reject && (
        <p className="text-[11px] leading-relaxed text-amber-700/80" role="status">
          {reject}
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 连打输入组件（键盘盲打，不弹候选词）
// ──────────────────────────────────────────────

function RapidInput({
  toneType,
  onToneType,
  onCommit,
}: {
  toneType: NoteType;
  onToneType: (tone: NoteType) => void;
  onCommit: (jianzi: JianziState) => void;
}) {
  const [buffer, setBuffer] = useState("");
  const [committed, setCommitted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = parseRapidInput(buffer, toneType);
  // 串里写了音色前缀（s/f/a）时，按钮的高亮跟着串走，
  // 否则会出现「明明打着 a（按音），上面还亮着散」的错位。
  const prefixTone = parsed.tokens.find((t) => t.slot === "toneType")?.value as
    | NoteType
    | undefined;
  const activeTone = prefixTone ?? toneType;

  function handleChange(raw: string) {
    const next = normalizeRapidInput(raw);
    const result = parseRapidInput(next, toneType);
    // 打满一个完整谱字就立刻成字，并清空输入继续下一个
    if (result.complete) {
      onCommit(result.state);
      setBuffer("");
      setCommitted((n) => n + 1);
      return;
    }
    setBuffer(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionGroup
        label="音色"
        items={DEFAULT_KEYBOARD.toneTypes}
        active={activeTone}
        onSelect={(v) => onToneType(v as NoteType)}
      />

      <div className="flex w-full flex-col items-center gap-3">
        {/* 平时不占一个空框：只有识别出槽位才显示实时预览 */}
        {parsed.tokens.length > 0 && (
          <>
            <JianzipuPreview state={parsed.state} />
            <JianziExplainPanel state={parsed.state} />
          </>
        )}
        {/* 教程的两个例子就写在 placeholder 里：占位符颜色必须够深，
            否则「一句话 + 两个例子」实际只给了一句话。 */}
        <input
          ref={inputRef}
          autoFocus
          value={buffer}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setBuffer("");
              e.preventDefault();
              return;
            }
            // 回车 = 明确表态：自动逻辑不敢判的歧义串（如按音界面下打 g4），
            // 由用户自己按最优解读入谱，不用回去点音色按钮。
            if (e.key === "Enter" && buffer) {
              const forced = parseRapidInput(buffer, toneType, { force: true });
              if (forced.complete) {
                onCommit(forced.state);
                setBuffer("");
                setCommitted((n) => n + 1);
              }
              e.preventDefault();
            }
          }}
          placeholder={
            toneType === "散" ? "例：g4 · sg3" : "例：d9g4 · ad9f6cg4"
          }
          className="w-full px-3 py-2 text-base tracking-[0.3em] text-center rounded border border-stone-300/50 bg-[#f8f3eb] text-stone-800 placeholder:text-stone-500/80 placeholder:tracking-normal outline-none focus:border-amber-600/40 focus:ring-1 focus:ring-amber-600/20 transition-all"
        />

        {/* 已识别槽位 */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 min-h-[26px]">
          {parsed.tokens.length === 0 ? (
            /* 上手引导刻意只有一句话 + 一条消歧（两个例子在 placeholder 里）。
               完整规则折在下面的速查表，别一上来就摆七行表吓人。 */
            <span className="text-center text-[11px] leading-relaxed tracking-[0.05em] text-stone-500">
              按书写顺序打，打满自动成字（音色可写 s/f/a）。分位要带 f，如 f6；裸数字是徽位。
            </span>
          ) : (
            parsed.tokens.map((t, i) => (
              <span
                key={`${t.slot}-${i}`}
                className="px-2 py-0.5 text-[11px] rounded border border-amber-700/30 bg-amber-700/10 text-stone-700"
              >
                <span className="text-stone-400">{RAPID_SLOT_LABEL[t.slot]}</span>
                <span className="mx-1 text-stone-300">·</span>
                {t.value}
              </span>
            ))
          )}
          {buffer && parsed.nextSlot && (
            <span className="px-2 py-0.5 text-[11px] rounded border border-dashed border-stone-300 text-stone-400">
              下一个：{RAPID_SLOT_LABEL[parsed.nextSlot]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] tracking-[0.15em] text-stone-400">
          <span>已录入 {committed} 字</span>
          {buffer && (
            <button
              onClick={() => setBuffer("")}
              className="text-stone-500 hover:text-stone-800 transition-colors"
            >
              Esc 清空
            </button>
          )}
        </div>
      </div>

      <details className="w-full rounded border border-stone-700/10 bg-stone-700/[0.03]">
        <summary className="px-3 py-2 text-[11px] tracking-[0.15em] text-stone-500 cursor-pointer select-none">
          连打速查表（徽位打数字，音色可写 s/f/a）
        </summary>
        <ul className="px-3 pb-3 space-y-1.5">
          {RAPID_CHEATSHEET.map((row) => (
            <li key={row.title} className="flex gap-2 text-[11px] leading-relaxed">
              <span className="shrink-0 w-8 text-stone-400">{row.title}</span>
              <span className="text-stone-600">{row.text}</span>
            </li>
          ))}
        </ul>
      </details>
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
