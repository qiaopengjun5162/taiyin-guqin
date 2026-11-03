"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { NoteColumn } from "@/lib/types";
import { ScoreView } from "@/components/score-view";
import { JianzipuKeyboard } from "@/components/jianzipu-keyboard";
import { JianziRecognizer } from "@/components/jianzi-recognizer";
import { JianziSheetRecognizer } from "@/components/jianzi-sheet-recognizer";
import { PracticePlayer } from "@/components/practice-player";
import { RecorderPanel } from "@/components/recorder-panel";
import { PracticeLogPanel } from "@/components/practice-log-panel";
import { TunerPanel } from "@/components/tuner-panel";
import { QinBoard } from "@/components/qin-board";
import { SaveLoadToolbar } from "@/components/save-load-toolbar";
import { LoadDialog, type LoadDialogTab } from "@/components/load-dialog";
import { BackendSettings } from "@/components/backend-settings";
import { ExportFooter } from "@/components/export-footer";
import { JianpuTranslator } from "@/components/jianpu-translator";
import { JianziCodeImport } from "@/components/jianzi-code-import";
import { useExportImage } from "@/lib/use-export-image";
import { useScoreHistory } from "@/lib/use-score-history";
import { EXAMPLE_SCORES, findExampleScore } from "@/lib/example-scores";
import { formatScoreAsText, downloadTextFile } from "@/lib/score-export";
import { buildScoreShareUrl, readSharedScoreId } from "@/lib/share-link";
import { getStoredAuthor } from "@/lib/settings";
import { forgetMyScore, isMyScore, rememberMyScore } from "@/lib/owner-token";
import { encodeJianziBatch } from "@/lib/taiyin-wasm";
import { useScorePlayer } from "@/lib/use-score-player";
import { useMetronome } from "@/lib/use-metronome";
import {
  CONCERT_PITCH_DEFAULT,
  CONCERT_PITCH_MAX,
  CONCERT_PITCH_MIN,
  getConcertPitch,
  getServerConcertPitch,
  setConcertPitch,
  subscribeConcertPitch,
} from "@/lib/concert-pitch";
import { renderScoreToBuffer, downloadWav } from "@/lib/audio-export";
import { scoreToMidi, downloadMidi } from "@/lib/midi-export";
import {
  TUNINGS,
  getServerTuning,
  getTuning,
  getTuningById,
  setTuning,
  subscribeTuning,
  type TuningId,
} from "@/lib/tuning";
import * as api from "@/lib/api";
import Link from "next/link";

/** useSyncExternalStore 的空订阅：存储模式在页面生命周期内不会变，无需通知。 */
const subscribeNoop = () => () => {};

/**
 * 数据流：
 *
 *   ScoreView（展示）          JianzipuKeyboard（编辑）
 *       │  onEdit(index)            ↑ defaultNote (回填)
 *       │  onRemove(id)             │ onAppend (追加 / 替换)
 *       └────→  page.tsx ──────────┘
 *               ↑
 *           editingIndex: 编辑中的音符序号
 *
 * 编辑模式：点击 ScoreView 中的音符列 → editingIndex 赋值为该列索引 →
 * key 变化强制键盘 remount → defaultNote 填充键盘 state → 修改后确认 →
 * editingIndex !== null 时替换 score[editingIndex] 而非 append。
 *
 * 追加模式：editingIndex === null，纯 append。
 *
 * 删除时若恰好删除编辑中的音符，即时退出编辑模式。
 */
export default function Home() {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const {
    score,
    title: scoreTitle,
    setScore,
    setTitle: setScoreTitle,
    commitScore,
    commitTitle: commitScoreTitle,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useScoreHistory([], "未命名曲谱");

  // 持久化状态
  const [currentScoreId, setCurrentScoreId] = useState<string | null>(null);
  const [loadTabs, setLoadTabs] = useState<LoadDialogTab[]>([]);
  // 纯前端模式（静态托管无后端）时，曲谱改存浏览器本地，需在 UI 上说明。
  // 用 useSyncExternalStore 读取「仅浏览器可得」的值：服务端快照固定为 server，
  // 挂载后取真实值，既不触发水合不一致，也避免在 effect 里同步 setState。
  const storageMode = useSyncExternalStore<"server" | "browser">(
    subscribeNoop,
    api.scoreStorageMode,
    () => "server",
  );
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  // 本机→社区一键迁移的进度与结果提示
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 成功/中性提示（如「分享链接已复制」），与红色错误框分开，避免误读成失败
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isExportingAudio, setIsExportingAudio] = useState(false);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [bpm, setBpm] = useState(120);
  // 基准音：古琴常整床偏低（丝弦尤甚），改 A4 频率即可让整谱跟着自己的琴走。
  // 同样用 useSyncExternalStore 读「仅浏览器可得」的 localStorage 值。
  const concertPitch = useSyncExternalStore(
    subscribeConcertPitch,
    getConcertPitch,
    getServerConcertPitch,
  );
  // 定弦：同一组减字在不同定弦上音高不同（紧五弦差半音），
  // 所以它既是「偏好」也是「曲谱属性」——保存时随谱走，加载时还原。
  const tuning = useSyncExternalStore(subscribeTuning, getTuning, getServerTuning);
  // 定弦显示名（名字 + 别名/宫音）。导出文本与打印页脚共用同一份写法。
  const tuningLabel = `${getTuningById(tuning).name} · ${getTuningById(tuning).alias}`;
  const [linkMetronome, setLinkMetronome] = useState(true);
  const [exportWithCountIn, setExportWithCountIn] = useState(true);
  const [showRecognizer, setShowRecognizer] = useState(false);
  const [showPractice, setShowPractice] = useState(false);
  const [showPracticeLog, setShowPracticeLog] = useState(false);
  const [practiceLogTab, setPracticeLogTab] = useState<"record" | "log">("record");
  const [showTuner, setShowTuner] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [recognizerTab, setRecognizerTab] = useState<"single" | "sheet">("single");
  // 录入区两种进法：点选简谱转减字，或把减字码整段粘回来。
  const [inputTab, setInputTab] = useState<"jianpu" | "code">("jianpu");
  const { play, stop: stopPlayback, isPlaying, playingIndex } = useScorePlayer(
    score,
    bpm,
    concertPitch,
    tuning,
  );
  const { toggle: toggleMetronome, stop: stopMetronome, isRunning: metronomeRunning, currentBeat } = useMetronome(beatsPerBar, bpm);
  const exportRef = useRef<HTMLDivElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 分享链接只自动加载一次（防 StrictMode 双跑 / 重渲染重复拉取） */
  const sharedLoadedRef = useRef(false);
  const { exportPng, exportSvg, isExporting } = useExportImage({
    containerRef: exportRef,
    title: scoreTitle,
  });

  function showError(message: string) {
    setErrorMessage(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMessage(null), 4000);
  }

  function showInfo(message: string) {
    setInfoMessage(message);
    if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
    infoTimerRef.current = setTimeout(() => setInfoMessage(null), 4000);
  }

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
    };
  }, []);

  // 分享直达：URL 带 ?score=<id> 时自动加载该社区谱（仅首次挂载执行一次）
  useEffect(() => {
    if (sharedLoadedRef.current) return;
    const sharedId = readSharedScoreId(window.location.search);
    if (!sharedId) return;
    sharedLoadedRef.current = true;
    void (async () => {
      try {
        const data = await api.getScore(sharedId);
        commitScore(() => data.notes);
        commitScoreTitle(data.title);
        setTuning(data.tuning);
        setCurrentScoreId(data.id);
        // 分享链接打开时把署名亮出来：让人知道这首谱是谁打的
        if (data.author) showInfo(`已载入 ${data.author} 的《${data.title}》`);
      } catch {
        showError(
          storageMode === "server"
            ? "分享的曲谱不存在或已删除"
            : "打开分享曲谱需要连接社区后端，请先在设置里填写后端地址",
        );
      }
    })();
    // 只在首次挂载读一次 URL；sharedLoadedRef 防 StrictMode / 重渲染重复拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 全局撤销/重做快捷键 */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      const target = e.target as HTMLElement;
      const isTextInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "z" && !e.shiftKey) {
        if (isTextInput) return;
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        if (isTextInput) return;
        e.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  /**
   * 播放/停止必须用 useCallback 稳定引用：它们是空格键 useEffect 的依赖，
   * 若每次渲染都产生新函数，监听器会每帧卸载重装（见 exhaustive-deps 告警）。
   */
  /** 播放：可联动启动节拍器（共享同速、重拍对齐乐谱小节） */
  const handlePlay = useCallback(() => {
    void play();
    if (linkMetronome && !metronomeRunning) void toggleMetronome();
  }, [play, linkMetronome, metronomeRunning, toggleMetronome]);

  /** 停止：可联动停止节拍器 */
  const handleStop = useCallback(() => {
    stopPlayback();
    if (linkMetronome && metronomeRunning) stopMetronome();
  }, [stopPlayback, linkMetronome, metronomeRunning, stopMetronome]);

  /** 空格键播放/停止：焦点在输入框/按钮等交互元素上时交给原生行为，避免误触与页面滚动 */
  useEffect(() => {
    function handleSpace(e: KeyboardEvent) {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A" ||
        tag === "OPTION" ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      if (isPlaying) handleStop();
      else handlePlay();
    }
    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [isPlaying, handlePlay, handleStop]);

  /** 点击乐谱流音符 → 键盘回填数据 + 滚动到键盘区 */
  function handleEdit(index: number) {
    setEditingIndex(index);
    document.getElementById("keyboard-area")?.scrollIntoView({ behavior: "smooth" });
  }

  function handleAppend(note: NoteColumn) {
    commitScore((prev) => {
      if (editingIndex !== null) {
        const next = [...prev];
        next[editingIndex] = note;
        return next;
      }
      return [...prev, note];
    });
    setEditingIndex(null);
  }

  function handleRemove(id: string) {
    const removedIdx = score.findIndex((n) => n.id === id);
    commitScore((prev) => prev.filter((n) => n.id !== id));
    if (editingIndex === null) return;
    if (removedIdx === editingIndex) {
      setEditingIndex(null);
    } else if (removedIdx >= 0 && removedIdx < editingIndex) {
      // 删除发生在「正在编辑的音」之前：数组整体前移一位，
      // editingIndex 必须同步减一，否则键盘会错位到别的音、确认时改错音。
      setEditingIndex(editingIndex - 1);
    }
  }

  /** 点击歌词：从该音符起播（先停后播，联动节拍器则一并重启对齐） */
  function handleSeekLyric(index: number) {
    stopPlayback();
    void play(index);
    if (linkMetronome && metronomeRunning) {
      stopMetronome();
      void toggleMetronome();
    }
  }

  /** 保存曲谱到后端 */
  async function handleSave() {
    if (score.length === 0) return;
    setSaveStatus("saving");
    try {
      if (currentScoreId) {
        try {
          // 署名只在「首次发布」时写入：每次保存都带上当前昵称的话，
          // 别人打开你的社区谱随手保存一次，作者就变成他了。
          await api.updateScore(currentScoreId, { title: scoreTitle, notes: score, tuning });
        } catch (err) {
          // 403 = 这首谱不是本机凭证发布的（别人的谱 / 换过设备 / 无主老谱）。
          // 直接报错会让人以为坏了，实际意图通常是「我想基于它改一版」，
          // 所以自动另存为新谱，并说明发生了什么。
          if (!(err instanceof api.ApiError) || err.status !== 403) throw err;
          const created = await api.createScore(scoreTitle, score, tuning, getStoredAuthor());
          setCurrentScoreId(created.id);
          rememberMyScore(created.id);
          showInfo("这不是你发布的曲谱，已另存为新谱");
        }
      } else {
        const created = await api.createScore(scoreTitle, score, tuning, getStoredAuthor());
        setCurrentScoreId(created.id);
        // 记住「这首是我发布的」：下次保存才走更新，服务端也认得出是我的凭证
        rememberMyScore(created.id);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setSaveStatus("error");
      showError(err instanceof api.ApiError ? err.message : "保存失败，请检查网络或后端状态");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }

  /**
   * 复制当前谱的分享直达链接（`?score=<id>`）。
   * 只有已发布到社区（有服务器 id）的谱才可分享——本机 id 换设备打不开。
   */
  async function handleShareScore() {
    if (storageMode !== "server" || !currentScoreId) {
      showError("请先「发布到社区」，再分享链接");
      return;
    }
    const url = buildScoreShareUrl(currentScoreId);
    try {
      await navigator.clipboard.writeText(url);
      showInfo("分享链接已复制");
    } catch {
      // 非安全上下文（http）或剪贴板权限被拒：退回手动复制
      window.prompt("复制分享链接", url);
    }
  }

  /** 打开加载对话框：连后端时同时拉「社区共享谱」与「本机谱」两个 tab */
  async function openLoadDialog() {
    try {
      if (storageMode === "server") {
        const serverList = await api.listScores(); // 失败走外层 catch 提示
        let localList: api.ScoreListItem[] = [];
        try {
          localList = await api.localListScores();
        } catch {
          // 隐私模式 / IndexedDB 不可用：本机 tab 直接为空即可，不影响社区浏览
        }
        const tabs: LoadDialogTab[] = [
          {
            key: "community",
            label: "社区曲谱",
            scores: serverList,
            readOnly: true,
            // 只读是「不让你删别人的谱」，自己发布的仍要能删（否则发布即不可撤回）
            myScoreIds: serverList.filter((s) => isMyScore(s.id)).map((s) => s.id),
          },
        ];
        if (localList.length > 0) {
          tabs.push({ key: "local", label: "本机", scores: localList, showMigrate: true });
        }
        setLoadTabs(tabs);
      } else {
        const localList = await api.listScores();
        setLoadTabs([{ key: "local", label: "已保存的曲谱", scores: localList }]);
      }
      setShowLoadDialog(true);
    } catch {
      showError("无法连接到服务器，请确认后端已启动");
    }
  }

  /**
   * 删除选中的曲谱。
   *
   * 两条路：
   * - **本机谱**（含 server 模式下「本机」tab 里的）：走本地存储，
   *   绝不把本地 id 发到服务器（会 404）。
   * - **我发布的社区谱**：走 api.deleteScore，带所有权凭证，服务端认得出是我；
   *   别人的谱在对话框里没有删除按钮，所以不会走到这里。
   */
  async function handleDeleteScore(id: string, title: string) {
    if (!confirm(`确认删除「${title}」？`)) return;
    try {
      if (storageMode === "server" && !isMyScore(id)) {
        await api.localDeleteScore(id);
      } else {
        await api.deleteScore(id);
      }
      forgetMyScore(id);
      setLoadTabs((prev) =>
        prev.map((t) => ({
          ...t,
          scores: t.scores.filter((s) => s.id !== id),
          myScoreIds: t.myScoreIds?.filter((x) => x !== id),
        })),
      );
      if (currentScoreId === id) {
        setScore([]);
        setScoreTitle("未命名曲谱");
        setCurrentScoreId(null);
      }
    } catch (err) {
      showError(err instanceof api.ApiError ? err.message : "删除失败");
    }
  }

  /**
   * 加载选中的曲谱。
   * browser 模式下 api.getScore 内部已走本地存储，无需分流；
   * 仅 server 模式下的「本机」tab 才强制走本地——否则 api.getScore 会把本地 id 发到服务器而 404。
   */
  async function handleLoadScore(id: string, tabKey: string) {
    try {
      const scoreData =
        storageMode === "server" && tabKey === "local"
          ? await api.localGetScore(id)
          : await api.getScore(id);
      commitScore(() => scoreData.notes);
      commitScoreTitle(scoreData.title);
      // 回到这首谱自己的定弦：换定弦后再加载，若沿用当前设置，
      // 接着往里加的音就会按错定弦反推（差半音且不易察觉）。
      setTuning(scoreData.tuning);
      // 本机谱的 id（local-xxx）与服务器 id 体系不互通：若保留，下次
      // 「发布到社区」会走 updateScore(本地id) 命中服务器 404。置 null 让发布即新建。
      // 社区 tab 的谱保留 id：它确实是服务器上那首；若不是我发布的，
      // handleSave 会在 403 时自动另存为新谱（见下），不必在这里提前丢弃。
      setCurrentScoreId(storageMode === "server" && tabKey === "local" ? null : scoreData.id);
      setShowLoadDialog(false);
      setEditingIndex(null);
    } catch {
      showError("加载失败");
    }
  }

  /**
   * 一键把本机谱批量发布到社区共享池。
   * 仅 server 模式（已连后端）有意义；browser 模式提示先配置后端。
   * 按曲名去重，已存在同名谱则跳过，使重复点击幂等。
   */
  async function handleMigrateLocalToCommunity() {
    if (api.isBrowserOnlyMode()) {
      showError("请先在「社区后端」设置里填写后端地址，再发布到社区");
      return;
    }
    if (!confirm("将把本机保存的曲谱公开发布到社区，确定继续？")) return;
    setMigrating(true);
    setMigrateMsg(null);
    try {
      const localList = await api.localListScores();
      if (localList.length === 0) {
        setMigrateMsg("本机暂无曲谱可发布");
        return;
      }
      const community = await api.listScores();
      const existing = new Set(community.map((c) => c.title));
      // 迁移等价于「一次性发布多首」，统一记当前昵称；没设置则为匿名。
      const author = getStoredAuthor();
      let migrated = 0;
      let skipped = 0;
      for (const item of localList) {
        if (existing.has(item.title)) {
          skipped++;
          continue;
        }
        const full = await api.localGetScore(item.id);
        const created = await api.createScore(item.title, full.notes, item.tuning, author);
        // 迁移上来的也是「我发布的」，记下来才能在本机改 / 删
        rememberMyScore(created.id);
        migrated++;
      }
      await openLoadDialog(); // 刷新社区 tab，刚发布的谱立即可见
      setMigrateMsg(
        `已发布 ${migrated} 首到社区` + (skipped ? `，跳过 ${skipped} 首已存在的同名谱` : ""),
      );
    } catch {
      showError("发布到社区失败，请稍后重试");
    } finally {
      setMigrating(false);
    }
  }

  /** 加载预置示例曲谱 */
  function handleLoadExample(id: string) {
    const example = findExampleScore(id);
    if (!example) return;
    commitScore(() => example.notes);
    commitScoreTitle(example.title);
    setCurrentScoreId(null);
    setEditingIndex(null);
  }

  /**
   * 导出纯文本对照谱。
   *
   * 除了简谱 / 减字 / 歌词，还带上每个减字的**编码**（`ad9g4` 这种）：
   * 减字那一行离开我们的字体就是一堆生僻字，码却是谁都能看、能照着敲的。
   * 编码在 Rust 端算；引擎没起来时退回不带码的三行，不让导出整个失败。
   */
  function handleExportText() {
    void (async () => {
      let codes: (string | null)[] | undefined;
      try {
        codes = await encodeJianziBatch(score.map((note) => note.jianzi));
      } catch {
        codes = undefined;
      }
      const text = formatScoreAsText(score, {
        title: scoreTitle,
        beatsPerBar,
        tuning: tuningLabel,
        codes,
        // 时值跟着码走：导出的文本能被「减字码入谱」原样读回，节奏不丢。
        annotateRhythm: true,
      });
      downloadTextFile(text, `${scoreTitle || "taiyin-score"}.txt`);
    })();
  }

  /** 导出旋律为 WAV 音频（离线渲染，与播放音色一致） */
  async function handleExportWav() {
    if (score.length === 0) return;
    setIsExportingAudio(true);
    try {
      const buffer = await renderScoreToBuffer(score, bpm, {
        beatsPerBar,
        withMetronome: linkMetronome,
        leadInBars: exportWithCountIn ? 2 : 0,
        concertPitch,
        tuning,
      });
      downloadWav(buffer, `${scoreTitle || "taiyin-score"}.wav`);
    } catch {
      showError("音频导出失败");
    } finally {
      setIsExportingAudio(false);
    }
  }

  /** 导出标准 MIDI 谱（可导入打谱软件 / DAW；音高为正调推定） */
  function handleExportMidi() {
    if (score.length === 0) return;
    const bytes = scoreToMidi(score, {
      title: scoreTitle || "taiyin-score",
      bpm,
      beatsPerBar,
      concertPitch,
      tuning,
    });
    downloadMidi(bytes, `${scoreTitle || "taiyin-score"}.mid`);
  }

  /**
   * 导出 PDF —— 走浏览器原生打印通道。
   *
   * jsPDF 这类库没法嵌入古琴减字字体（中文字库以 MB 计，根本塞不进 PDF），
   * 而浏览器打印到 PDF 会自动把用到的字形子集嵌进文件，
   * 减字才能正确显示、且矢量无损。用户在打印框里选「另存为 PDF」即可。
   * 具体页面尺寸 / 边距 / 隐藏交互都在 globals.css 的 @media print 里。
   */
  function handleExportPdf() {
    if (score.length === 0) return;
    window.print();
  }

  return (
    <main className="flex flex-col items-center min-h-dvh py-10 px-4">
      {/* ── 品牌：朱砂印章（主视觉标识） ── */}
      <div className="flex flex-col items-center gap-4">
        {/* 朱砂印章 */}
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full border-[3px] border-[var(--vermillion)]/50 shadow-xl shadow-[var(--vermillion)]/5">
          <span
            className="text-3xl font-black tracking-[0.25em] text-[var(--vermillion)]/85 select-none ink-bleed font-calligraphy"
          >
            太音
          </span>
        </div>
        <div className="text-center">
          <h1
            className="text-sm font-bold tracking-[0.4em] text-amber-100/80 leading-relaxed"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            古琴 · 减字谱 · 拼装键盘
          </h1>
          <p className="mt-1 text-[10px] tracking-[0.25em] text-amber-600/40">
            TAIYIN GUQIN
          </p>
        </div>
      </div>

      {/* ── 全局错误 / 中性提示 ── */}
      {errorMessage && (
        <div className="no-print mt-4 w-full max-w-md px-3 py-2 rounded border border-red-400/30 bg-red-900/20 text-[11px] tracking-wider text-red-200/80">
          {errorMessage}
        </div>
      )}
      {infoMessage && (
        <div className="no-print mt-4 w-full max-w-md px-3 py-2 rounded border border-emerald-500/30 bg-emerald-900/20 text-[11px] tracking-wider text-emerald-200/80">
          {infoMessage}
        </div>
      )}

      {/* ── 乐谱流（导出截图目标） ── */}
      <div id="score-area" ref={exportRef} className="mt-8 w-full max-w-md">
        <ScoreView notes={score} beatsPerBar={beatsPerBar} onRemove={handleRemove} onEdit={handleEdit} onSeekLyric={handleSeekLyric} editingIndex={editingIndex} playingIndex={playingIndex} />
        {score.length === 0 && (
          <div className="mt-4 text-center">
            <p className="text-[11px] tracking-wider text-amber-700/40">
              暂无音符 · 用「简谱转减字」输入，或从上方「示例」加载一首曲谱
            </p>
            <div className="mt-2 flex items-center justify-center gap-2">
              {EXAMPLE_SCORES.slice(0, 2).map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => handleLoadExample(ex.id)}
                  className="px-2 py-1 text-[10px] tracking-wider rounded border border-amber-700/20 text-amber-700/50 hover:text-amber-100/70 hover:border-amber-600/40 transition-all"
                >
                  {ex.title.replace("（片段）", "")}
                </button>
              ))}
            </div>
          </div>
        )}
        {score.length > 0 && <ExportFooter title={scoreTitle} tuning={tuningLabel} />}
      </div>

      {/* ── 工具栏：标题 + 保存 / 加载 / 导出 ── */}
      <SaveLoadToolbar
        title={scoreTitle}
        storageMode={storageMode}
        onTitleChange={setScoreTitle}
        onTitleBlur={() => commitScoreTitle(scoreTitle)}
        onSave={handleSave}
        onLoad={openLoadDialog}
        onShare={handleShareScore}
        canShare={storageMode === "server" && currentScoreId !== null}
        onExportPng={exportPng}
        onExportSvg={exportSvg}
        onExportText={handleExportText}
        onExportWav={handleExportWav}
        onExportMidi={handleExportMidi}
        onExportPdf={handleExportPdf}
        isExportingAudio={isExportingAudio}
        examples={EXAMPLE_SCORES}
        onLoadExample={handleLoadExample}
        hasNotes={score.length > 0}
        saveStatus={saveStatus}
        isExporting={isExporting}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      {/* ── 导出选项（仅在有音符时显示） ── */}
      {score.length > 0 && (
        <div className="no-print mt-2 w-full max-w-md flex flex-wrap items-center justify-end gap-3">
          <label className="flex items-center gap-1.5 text-[10px] tracking-wider text-amber-600/50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={exportWithCountIn}
              onChange={(e) => setExportWithCountIn(e.target.checked)}
              aria-label="导出音频时包含 2 小节预备拍"
              className="accent-amber-600"
            />
            导出音频含预备拍
          </label>
        </div>
      )}

      {/* ── 拍号选择 + 播放 ── */}
      <div className="no-print mt-2 w-full max-w-md flex flex-wrap items-center justify-end gap-2 gap-y-2">
        <button
          onClick={toggleMetronome}
          aria-label={metronomeRunning ? "停止节拍器" : "启动节拍器"}
          className={`px-2 py-1 min-h-[44px] text-[10px] tracking-wider rounded border transition-all ${
            metronomeRunning
              ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
              : "border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50"
          }`}
        >
          节拍
        </button>
        <button
          onClick={isPlaying ? handleStop : handlePlay}
          disabled={score.length === 0}
          aria-label={isPlaying ? "停止播放" : "播放"}
          title="空格键播放 / 停止"
          className="px-2 py-1 min-h-[44px] text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50 disabled:opacity-30 transition-all"
        >
          {isPlaying ? "停止" : "播放"}
        </button>
        <label className="flex items-center gap-1.5 text-[10px] tracking-wider text-amber-600/50 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={linkMetronome}
            onChange={(e) => setLinkMetronome(e.target.checked)}
            className="accent-amber-600"
            aria-label="播放时联动节拍器"
          />
          播放带节拍
        </label>
        <span className="text-[10px] tracking-wider text-amber-600/50">拍号</span>
        <select
          value={beatsPerBar}
          onChange={(e) => setBeatsPerBar(parseInt(e.target.value, 10))}
          aria-label="拍号"
          className="px-2 py-1 min-h-[44px] text-[10px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 outline-none focus:border-amber-600/50"
        >
          <option value={3}>3/4</option>
          <option value={4}>4/4</option>
          <option value={6}>6/8</option>
        </select>
      </div>

      {/* ── 拍点高亮（节拍器/联动播放时显示，重拍为朱砂色） ── */}
      {metronomeRunning && (
        <div className="no-print mt-2 w-full max-w-md flex items-center justify-center gap-2" aria-hidden>
          {Array.from({ length: beatsPerBar }, (_, i) => {
            const active = currentBeat === i;
            const isDown = i === 0;
            return (
              <span
                key={i}
                className={`inline-block rounded-full transition-all duration-100 ${
                  active
                    ? isDown
                      ? "w-3.5 h-3.5 bg-[var(--vermillion)] shadow-[0_0_10px_var(--vermillion)]"
                      : "w-3 h-3 bg-amber-300 shadow-[0_0_6px_var(--vermillion)]"
                    : "w-3 h-3 bg-amber-700/30"
                }`}
              />
            );
          })}
        </div>
      )}

      {/* ── 速度（BPM）调节 ── */}
      <div className="no-print mt-2 w-full max-w-md flex items-center gap-3 py-1.5">
        <span className="text-[10px] tracking-wider text-amber-600/50 whitespace-nowrap">
          速度 {bpm} BPM
        </span>
        <input
          type="range"
          min={40}
          max={200}
          step={1}
          value={bpm}
          onChange={(e) => setBpm(parseInt(e.target.value, 10))}
          aria-label="播放速度（BPM）"
          className="flex-1 accent-amber-600 h-2"
        />
      </div>

      {/* ── 定弦（调式）：七根空弦各自的音高。同一组减字换定弦就换音高，
             所以它跟基准音是两个独立维度：定弦定弦间音程，基准音定整体高低。 ── */}
      <div className="no-print mt-1 w-full max-w-md flex items-center gap-3 py-1.5">
        <span className="text-[10px] tracking-wider text-amber-600/50 whitespace-nowrap">
          定弦
        </span>
        <select
          value={tuning}
          onChange={(e) => setTuning(e.target.value as TuningId)}
          aria-label="定弦（调式）"
          title={`${getTuningById(tuning).hint}\n切换只影响之后录入时按哪种定弦反推音高；已录入音符的简谱不会被改写。保存时随谱一起存。`}
          className="px-2 py-1 min-h-[44px] text-[10px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 outline-none focus:border-amber-600/50"
        >
          {TUNINGS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="flex-1 truncate text-[10px] tracking-wider text-amber-600/40">
          {getTuningById(tuning).alias}
        </span>
      </div>

      {/* ── 基准音（A4）调节：古琴常整床偏低，按自己琴上的实际音高设 ── */}
      <div className="no-print mt-1 w-full max-w-md flex items-center gap-3 py-1.5">
        <span className="text-[10px] tracking-wider text-amber-600/50 whitespace-nowrap">
          基准音 {concertPitch} Hz
        </span>
        <input
          type="range"
          min={CONCERT_PITCH_MIN}
          max={CONCERT_PITCH_MAX}
          step={1}
          value={concertPitch}
          onChange={(e) => setConcertPitch(parseInt(e.target.value, 10))}
          aria-label="基准音（A4 频率 Hz）"
          className="flex-1 accent-amber-600 h-2"
        />
        <button
          onClick={() => setConcertPitch(CONCERT_PITCH_DEFAULT)}
          disabled={concertPitch === CONCERT_PITCH_DEFAULT}
          className="shrink-0 rounded border border-amber-700/25 px-2 py-0.5 text-[10px] tracking-wider text-amber-700/60 transition-colors hover:text-amber-900 disabled:opacity-30 disabled:hover:text-amber-700/60"
          title="回到标准音高 A4=440"
        >
          标准
        </button>
      </div>

      {/* ── 社区后端设置（可选）：填了就能浏览 / 发布社区曲谱 ── */}
      <BackendSettings />

      {/* ── 加载对话框 ── */}
      <LoadDialog
        key={showLoadDialog ? "load-open" : "load-closed"}
        open={showLoadDialog}
        onClose={() => setShowLoadDialog(false)}
        tabs={loadTabs}
        onLoad={handleLoadScore}
        onDelete={handleDeleteScore}
        onMigrate={handleMigrateLocalToCommunity}
        migrating={migrating}
        migrateMsg={migrateMsg}
      />

      {/* ── 主卡片 —— 宣纸质感 ── */}
      <div
        id="keyboard-area"
        className="no-print mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30"
      >
        {/* 卡片顶部装饰线（朱砂色） */}
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />

        <div className="p-5">
          {editingIndex !== null && (
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] tracking-wider text-amber-600/60">
                正在编辑第 {editingIndex + 1} 音 · 确认后更新
              </p>
              <button
                onClick={() => setEditingIndex(null)}
                className="text-[10px] tracking-wider text-stone-400 hover:text-stone-600 transition-colors underline underline-offset-2"
              >
                取消编辑
              </button>
            </div>
          )}

          {/* 录入入口：简谱转减字 / 减字码入谱（同一块地方，两种进法） */}
          {editingIndex === null && (
            <div className="mb-4 p-3 rounded border border-amber-700/20 bg-amber-900/10">
              <div className="mb-2 flex items-center gap-2">
                {[
                  { key: "jianpu", label: "简谱转减字" },
                  { key: "code", label: "减字码入谱" },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setInputTab(t.key as "jianpu" | "code")}
                    aria-pressed={inputTab === t.key}
                    className={`min-h-[32px] px-2 py-0.5 text-[10px] tracking-wider rounded border transition-colors ${
                      inputTab === t.key
                        ? "border-amber-600/60 bg-amber-100 text-amber-900"
                        : "border-amber-700/25 text-stone-500 hover:text-stone-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {inputTab === "jianpu" ? (
                <JianpuTranslator
                  onSelect={(notes) => {
                    commitScore((prev) => [...prev, ...notes]);
                  }}
                />
              ) : (
                <JianziCodeImport
                  onImport={(notes) => commitScore((prev) => [...prev, ...notes])}
                />
              )}
            </div>
          )}

          {/*
           * key 随 editingIndex 变化强制键盘组件完全重建，确保 useState 初始值携带新数据。
           * defaultNote 为 undefined 时键盘表现正常（追加模式）。
           */}
          <JianzipuKeyboard
            key={editingIndex ?? "default"}
            defaultNote={editingIndex !== null ? score[editingIndex] : undefined}
            onAppend={handleAppend}
          />
        </div>
      </div>

      {/* ── 减字谱 AI 识别（对标 udywang「琴与人的交互 1 号」） ── */}
      <div className="no-print mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <button
            onClick={() => setShowRecognizer((v) => !v)}
            className="text-[10px] tracking-wider text-amber-800/80 hover:text-amber-900 transition-colors"
          >
            {showRecognizer ? "收起 AI 识别" : "＋ 用 AI 识别减字图片"}
          </button>
          {showRecognizer && (
            <div className="mt-3">
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => setRecognizerTab("single")}
                  className={`px-2 py-1 text-[10px] tracking-wider rounded border transition-all ${
                    recognizerTab === "single"
                      ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                      : "border-amber-700/30 text-stone-500 hover:text-stone-300"
                  }`}
                >
                  单字
                </button>
                <button
                  onClick={() => setRecognizerTab("sheet")}
                  className={`px-2 py-1 text-[10px] tracking-wider rounded border transition-all ${
                    recognizerTab === "sheet"
                      ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                      : "border-amber-700/30 text-stone-500 hover:text-stone-300"
                  }`}
                >
                  整页
                </button>
              </div>
              {recognizerTab === "single" ? (
                <JianziRecognizer />
              ) : (
                <JianziSheetRecognizer
                  onImport={(notes) => commitScore((prev) => [...prev, ...notes])}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 琴面音位全览（七弦十三徽 · 点哪听哪 · 按住拖是走手音） ── */}
      <div className="no-print mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <button
            onClick={() => setShowBoard((v) => !v)}
            className="text-[10px] tracking-wider text-amber-800/80 hover:text-amber-900 transition-colors"
          >
            {showBoard ? "收起琴面" : "＋ 琴面音位全览（七弦十三徽 · 点哪听哪 · 按住拖是走手音）"}
          </button>
          {showBoard && (
            <div className="mt-3">
              <QinBoard />
            </div>
          )}
        </div>
      </div>

      {/* ── 调音 · 定弦（定弦决定减字反推的音高） ── */}
      <div className="no-print mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <button
            onClick={() => setShowTuner((v) => !v)}
            className="text-[10px] tracking-wider text-amber-800/80 hover:text-amber-900 transition-colors"
          >
            {showTuner ? "收起调音" : "＋ 调音 / 定弦（麦克风校弦 · 换调式）"}
          </button>
          {showTuner && (
            <div className="mt-3">
              <TunerPanel />
            </div>
          )}
        </div>
      </div>

      {/* ── 跟录音练琴（对标华夏古琴网的「古琴播放器」） ── */}
      <div className="no-print mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <button
            onClick={() => setShowPractice((v) => !v)}
            className="text-[10px] tracking-wider text-amber-800/80 hover:text-amber-900 transition-colors"
          >
            {showPractice ? "收起跟录音练" : "＋ 跟录音练（导入音频 / AB 循环 / 变速）"}
          </button>
          {showPractice && (
            <div className="mt-3">
              <PracticePlayer />
            </div>
          )}
        </div>
      </div>

      {/* ── 练琴记录（对标「古琴助手」的录音器 + 打卡 + 统计） ── */}
      <div className="no-print mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <button
            onClick={() => setShowPracticeLog((v) => !v)}
            className="text-[10px] tracking-wider text-amber-800/80 hover:text-amber-900 transition-colors"
          >
            {showPracticeLog ? "收起练琴记录" : "＋ 练琴记录（录音回听 · 打卡 · 周月统计）"}
          </button>
          {showPracticeLog && (
            <div className="mt-3">
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => setPracticeLogTab("record")}
                  aria-pressed={practiceLogTab === "record"}
                  className={`min-h-[36px] px-2 py-1 text-[10px] tracking-wider rounded border transition-colors ${
                    practiceLogTab === "record"
                      ? "border-amber-600/50 bg-amber-800/15 text-stone-900"
                      : "border-amber-700/25 text-stone-600 hover:border-amber-600/50"
                  }`}
                >
                  录音
                </button>
                <button
                  onClick={() => setPracticeLogTab("log")}
                  aria-pressed={practiceLogTab === "log"}
                  className={`min-h-[36px] px-2 py-1 text-[10px] tracking-wider rounded border transition-colors ${
                    practiceLogTab === "log"
                      ? "border-amber-600/50 bg-amber-800/15 text-stone-900"
                      : "border-amber-700/25 text-stone-600 hover:border-amber-600/50"
                  }`}
                >
                  打卡与统计
                </button>
              </div>
              {practiceLogTab === "record" ? (
                <RecorderPanel scoreTitle={scoreTitle} />
              ) : (
                <PracticeLogPanel scoreTitle={scoreTitle} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 页脚 ── */}
      <div className="no-print mt-auto pt-10 flex flex-col items-center gap-2">
        <p className="text-[11px] tracking-[0.15em] text-amber-700/30">
          先选音色，再依次拼出完整减字
        </p>
        <Link
          href="/yuelun"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          乐论 · 《荀子》读书
        </Link>
        <Link
          href="/jianzipu"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          减字谱 · 科普
        </Link>
        <Link
          href="/zidian"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          减字字典 · 字全表
        </Link>
      </div>
    </main>
  );
}
