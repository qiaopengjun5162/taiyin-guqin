"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import type { NoteColumn } from "@/lib/types";
import { ScoreView } from "@/components/score-view";
import { JianzipuKeyboard } from "@/components/jianzipu-keyboard";
import { PhrasePractice } from "@/components/phrase-practice";
import { FollowPlayPanel } from "@/components/follow-play-panel";
import { PracticePanels } from "@/components/practice-panels";
import { SkipLink, SiteHeader, SectionNav, SiteFooter, BackToTop } from "@/components/page-chrome";
import { SaveLoadToolbar } from "@/components/save-load-toolbar";
import { LoadDialog, type LoadDialogTab } from "@/components/load-dialog";
import { BackendSettings } from "@/components/backend-settings";
import { ExportFooter } from "@/components/export-footer";
import { JianpuTranslator } from "@/components/jianpu-translator";
import { JianziCodeImport } from "@/components/jianzi-code-import";
import {
  clearLianmei,
  lianmeiRelation,
  linkLianmei,
  normalizeLianmei,
  relationFits,
  LIANMEI_OPTIONS,
  api,
  type LianmeiRelation,
} from "@/lib/client";
/*
 * 网络判定与本地写入从**独立模块**导入，不经 `@/lib/client`。
 *
 * 原因：组件测试用 `vi.mock("@/lib/api")` 替换绑定层，而门面会 re-export 它，
 * 于是从门面拿这两个函数会穿透到 mock 替身、拿到 undefined。
 * 它们是与 HTTP 实现无关的纯逻辑，独立成模块后既不被 mock 影响，也能单测。
 */
import { isBackendUnreachable } from "@/lib/net-error";
import { localCreateScore } from "@/lib/local-score-store";
import { jianziToFrequency } from "@/lib/jianzi-pitch";
import {
  DENSITY_OPTIONS,
  LAYOUT_OPTIONS,
  WIDTH_MAX_REM,
  WIDTH_OPTIONS,
  getLayoutPref,
  getLayoutPrefServerSnapshot,
  setLayoutPref,
  subscribeLayoutPref,
  type ScoreDensity,
  type ScoreLayout,
  type ScoreWidth,
} from "@/lib/score-layout";
import { scoreFingerprint, confirmDiscard } from "@/lib/unsaved-guard";
import { clearDraft, formatDraftAge } from "@/lib/draft-store";
import { useScoreHistory } from "@/lib/use-score-history";
import { EXAMPLE_SCORES, findExampleScore } from "@/lib/example-scores";
import { buildScoreShareUrl, readSharedScoreId } from "@/lib/share-link";
import { getStoredAuthor } from "@/lib/settings";
import { forgetMyScore, isMyScore, rememberMyScore } from "@/lib/owner-token";
import { getCurrentUserId } from "@/lib/auth";
import { useScorePlayer } from "@/lib/use-score-player";
import { usePhrasePractice } from "@/lib/use-phrase-practice";
import { useScoreExport } from "@/lib/use-score-export";
import { useScoreDraft } from "@/lib/use-score-draft";
import { PRACTICE_REPEATS } from "@/lib/score-phrases";
import { useMetronome } from "@/lib/use-metronome";
import { addEntry } from "@/lib/practice-log";
import {
  CONCERT_PITCH_DEFAULT,
  CONCERT_PITCH_MAX,
  CONCERT_PITCH_MIN,
  getConcertPitch,
  getServerConcertPitch,
  setConcertPitch,
  subscribeConcertPitch,
} from "@/lib/concert-pitch";
import {
  TUNINGS,
  getServerTuning,
  getTuning,
  getTuningById,
  setTuning,
  subscribeTuning,
  type TuningId,
} from "@/lib/tuning";

/**
 * 把任意 catch 到的错误翻成一句给用户看的话。
 *
 * ## 为什么需要包一层（2026-11-18 实测踩到）
 *
 * 原先每处都写 `err instanceof api.ApiError ? err.message : "保存失败"`。
 * 这在测试里会炸：测试用 `vi.mock` 替换了整个 `@/lib/api` 模块，
 * 而替身里没有 `ApiError` 这个类——`instanceof undefined` 直接抛
 * `TypeError: Right-hand side of 'instanceof' is not an object`，
 * 于是本该走到「已保存」的用例全部变成「保存失败」。
 *
 * ## 为什么优先用 fallback 而不是 err.message
 *
 * `ApiError` 的 message 是**后端写给人看的话**（「超出配额」「口令不对」），可以直出。
 * 但普通 `Error` 的 message 是给开发者看的（`ECONNREFUSED`、`Cannot read x of undefined`），
 * 扔给用户只会增加困惑 → 这种情况一律用调用方给的 fallback（如「删除失败」）。
 */
function errorText(err: unknown, fallback: string): string {
  const ApiErrorClass = api.ApiError;
  if (typeof ApiErrorClass === "function" && err instanceof ApiErrorClass) {
    return err instanceof Error && err.message ? err.message : fallback;
  }
  return fallback;
}

/** 该错误是否带指定 HTTP 状态（如 403 = 不是这首谱的主人）。 */
function hasStatus(err: unknown, status: number): boolean {
  const ApiErrorClass = api.ApiError;
  if (typeof ApiErrorClass !== "function" || !(err instanceof ApiErrorClass)) return false;
  return (err as { status?: number }).status === status;
}

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
/** 新谱的默认标题；同时是「用户是否动过标题」的判断基准。 */
const UNTITLED_TITLE = "未命名曲谱";

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
  } = useScoreHistory([], UNTITLED_TITLE);

  // 持久化状态
  const [currentScoreId, setCurrentScoreId] = useState<string | null>(null);
  const [loadTabs, setLoadTabsState] = useState<LoadDialogTab[]>([]);
  /**
   * 当前账号收藏的曲谱 id。
   *
   * 只在打开发布列表时刷新：收藏跟账号走（未登录恒为空），
   * 与其搞一套跨组件订阅，不如在「看得见它」的那一刻取一次真值。
   */
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  /**
   * `loadTabs` 的镜像。
   *
   * 为什么需要：`openLoadDialog` 把 `onLoadMore` 写进 tab 对象时，回调闭包捕获的是
   * **那一次渲染**的 `loadTabs`——而此时它还是空的。于是点「加载更多」会读到空数组、
   * 直接 return，表现是「按钮点了没反应」，而且只在分页时才暴露。
   * 用 ref 读当前值，回调就不会被首次渲染的旧状态钉住。
   *
   * ref 的更新必须与状态**同刻**发生：早先用 `useEffect` 同步，副作用是延迟跑的，
   * 「提交后、副作用前」的窗口里点按钮照样读到旧数组而静默早退——
   * CI 慢机上「加载更多失败」提示从不出现就是这个窗口（2026-11-10 定位）。
   * 所以包一层 setter，在更新状态的同一刻写 ref；四个处理器的防重
   * （`tab.loadingMore`）也读它，ref 旧了连双击防重都不可靠。
   */
  const loadTabsRef = useRef<LoadDialogTab[]>([]);
  const setLoadTabs = (action: SetStateAction<LoadDialogTab[]>) => {
    setLoadTabsState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      loadTabsRef.current = next;
      return next;
    });
  };
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
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  // 谱面排版偏好（布局/疏密/行宽）存 localStorage：属于读谱习惯，不是谱子内容，
  // 所以跟着人不跟着曲。用 useSyncExternalStore 读，避免 effect 里同步 setState。
  const layoutPref = useSyncExternalStore(
    subscribeLayoutPref,
    getLayoutPref,
    getLayoutPrefServerSnapshot,
  );
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
  // 录入区两种进法：点选简谱转减字，或把减字码整段粘回来。
  const [inputTab, setInputTab] = useState<"jianpu" | "code">("jianpu");

  /**
   * 逐句慢练的全部状态与动作（关注点已拆到 `usePhrasePractice`）。
   *
   * 与播放器之间是个环：播放器每一遍走完要回调 `handlePracticeEnd` 记账，
   * 而记账要用到「这一遍实际走的档」——那是本 hook 的状态。用 `practiceEndRef`
   * 打断：播放器拿一个永远稳定的包装函数，内部转发到最新的实现。
   * 这样播放器不必因记账函数变化而重建，也不会读到过期的闭包。
   */
  const practiceEndRef = useRef<() => void>(() => {});
  const stablePracticeEnd = useCallback(() => practiceEndRef.current(), []);

  const { play, stop: stopPlayback, isPlaying, playingIndex, practicePass } = useScorePlayer(
    score,
    bpm,
    concertPitch,
    tuning,
    stablePracticeEnd,
  );
  const { toggle: toggleMetronome, stop: stopMetronome, isRunning: metronomeRunning, currentBeat } = useMetronome(beatsPerBar, bpm);

  const {
    scorePhrases,
    sticking,
    activePractice,
    activePracticeIndex,
    activeJoinTo,
    practiceTempo,
    setPracticeTempo,
    practiceIndex,
    phraseProgress,
    practicePhrase,
    practiceSticking,
    practiceJoin,
    stopPractice,
    handlePracticeEnd,
    handleFollowPass,
  } = usePhrasePractice({
    score,
    currentScoreId,
    scoreTitle,
    play,
    stopPlayback,
    metronomeRunning,
    stopMetronome,
    isPlaying,
    practicePass,
  });

  // 把最新实现转给播放器：ref 在每次渲染时更新，包装函数保持不变（见上方说明）。
  useEffect(() => {
    practiceEndRef.current = handlePracticeEnd;
  }, [handlePracticeEnd]);
  const exportRef = useRef<HTMLDivElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 分享链接只自动加载一次（防 StrictMode 双跑 / 重渲染重复拉取） */
  const sharedLoadedRef = useRef(false);
  /**
   * 「先听一首」的自动起播标记。play() 闭包吃的是当前渲染的 score，
   * 点按钮时空谱还没换掉，必须等下一次渲染再播，故用 ref 跨一次提交传话。
   * 载入成功才置位：下拉选示例 / 被「未保存」确认拦下都不该跟着响。
   */
  const autoPlayPendingRef = useRef(false);

  /**
   * 未保存保护：曲谱只活在内存里（没有自动草稿），载入别的谱会直接覆盖，
   * 刷新页面更是全丢。`savedFingerprint` 记录「上次保存 / 载入时」的内容指纹，
   * 与当前内容不一致即视为有未保存的修改。
   *
   * 初值 null = 基线尚未建立（用户还没保存 / 载入过任何谱）。这段时间改用
   * 「谱上有没有东西」判断：空谱不打扰，一旦录了音或改了标题就算未保存。
   * 这样不必在 effect 里补基线——既少一次渲染，也不会因为定弦从 localStorage
   * 水合（server snapshot → 真实值）把空谱误判成「已修改」。
   */
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const currentFingerprint = useMemo(
    () => scoreFingerprint(scoreTitle, score, tuning),
    [scoreTitle, score, tuning],
  );
  const isDirty =
    savedFingerprint === null
      ? score.length > 0 || scoreTitle !== UNTITLED_TITLE
      : savedFingerprint !== currentFingerprint;

  // 有未保存修改时，刷新 / 关标签页前拦一下（浏览器弹标准确认框）
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // 部分浏览器仍要求给 returnValue 赋值才会弹
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  /**
   * 自动草稿：有未保存修改时把谱写进 localStorage，下次打开可恢复。
   *
   * 读写与防抖都在 `useScoreDraft` 里；这里只负责「恢复」这一步——
   * 它要动 score/title/tuning/currentScoreId，属于曲谱状态的职责，
   * 草稿 hook 不该越界写入。
   *
   * 恢复后的行为刻意如此：草稿本身仍未保存，所以恢复完页面照常显示「未保存」。
   */
  const { pendingDraft, showDraftBanner, discardDraft, takeDraftForRestore } =
    useScoreDraft({
      score,
      scoreTitle,
      tuning,
      currentScoreId,
      isDirty,
      untitledTitle: UNTITLED_TITLE,
    });

  /** 恢复上次没保存的草稿（草稿本身未保存，恢复后仍显示「未保存」）。 */
  function handleRestoreDraft() {
    const draft = takeDraftForRestore();
    if (!draft) return;
    commitScore(() => draft.notes);
    commitScoreTitle(draft.title);
    setTuning(draft.tuning);
    // 本机 id（local-xxx）在 server 模式下发给后端只会 404：
    // 与 handleLoadScore 同一处理——置 null 让保存走「新建」。
    setCurrentScoreId(
      storageMode === "server" && draft.scoreId?.startsWith("local-")
        ? null
        : draft.scoreId,
    );
    setEditingIndex(null);
    showInfo("已恢复上次未保存的草稿，记得保存");
  }

  /** 丢弃草稿。 */
  function handleDiscardDraft() {
    discardDraft();
  }

  function showError(message: string) {
    setErrorMessage(message);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMessage(null), 4000);
  }

  const {
    exportPng,
    exportSvg,
    exportText,
    exportWav,
    exportMidi,
    exportPdf,
    isExporting,
    isExportingAudio,
  } = useScoreExport({
    score,
    scoreTitle,
    bpm,
    beatsPerBar,
    concertPitch,
    tuning,
    tuningLabel,
    linkMetronome,
    exportWithCountIn,
    containerRef: exportRef,
    onError: showError,
  });

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
        // 打开分享链接只是「看别人发的谱」，不该立刻提示未保存
        setSavedFingerprint(scoreFingerprint(data.title, data.notes, data.tuning));
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

  /**
   * 轻用卡的「去敲一个字」：滚到键盘区。
   * jsdom 不实现 scrollIntoView，typeof 挡一下（与 score-view 同一写法），
   * 否则测试环境点一下就抛 TypeError。
   */
  function jumpToKeyboard() {
    const el = document.getElementById("keyboard-area");
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }

  /** 点击乐谱流音符 → 键盘回填数据 + 滚动到键盘区 */
  function handleEdit(index: number) {
    setEditingIndex(index);
    // 与 `jumpToKeyboard` 同一保护：jsdom 不实现 scrollIntoView，
    // 直接调用会让「点音符列」在测试环境抛 TypeError，看起来像交互坏了。
    const el = document.getElementById("keyboard-area");
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth" });
    }
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

  /**
   * 拖动改时值：直接落到音符上，不再走「进编辑模式 → 改键盘时值 → 确认」。
   *
   * 顺手退出编辑模式：键盘里那份时值状态还是旧的，留着它再点「确认」
   * 会把刚拖好的时值改回去——这种"改完又被覆盖"最难查。
   */
  function handleChangeDuration(
    index: number,
    value: { duration: NoteColumn["duration"]; dotted: boolean },
  ) {
    commitScore((prev) =>
      prev.map((n, i) =>
        i === index
          ? { ...n, duration: value.duration, jianpuDot: value.dotted }
          : n,
      ),
    );
    if (editingIndex === index) setEditingIndex(null);
  }

  /**
   * 把「正在编辑的这一个音」与它后面那个音标成一组联袂。
   *
   * 只允许相邻成组：联袂在谱面上就是两个挨着的字，隔着别的音去连，
   * 谱面既画不出来、音乐上也讲不通。
   */
  function handleLinkLianmei(kind: (typeof LIANMEI_OPTIONS)[number]["kind"]) {
    if (editingIndex === null) return;
    commitScore((prev) =>
      normalizeLianmei(linkLianmei(prev, editingIndex, kind)),
    );
  }

  function handleClearLianmei() {
    if (editingIndex === null) return;
    commitScore((prev) => normalizeLianmei(clearLianmei(prev, editingIndex)));
  }

  /**
   * 正在编辑的音与下一个音的音程关系。
   *
   * 四种联袂都要求两声同度（放合可八度），所以这里直接把关系摆出来——
   * 不合的时候不禁用按钮，只是提示：古谱里确实有写法不规范的地方，
   * 硬拦着不让标，用户只会觉得功能坏了。
   */
  const lianmeiRelationInfo: {
    relation: LianmeiRelation;
    description: string;
  } | null = (() => {
    if (editingIndex === null || editingIndex + 1 >= score.length) return null;
    const ctx = { tuning, concertPitch };
    const a = jianziToFrequency(score[editingIndex].jianzi, ctx);
    const b = jianziToFrequency(score[editingIndex + 1].jianzi, ctx);
    const relation = lianmeiRelation(a, b);
    const description =
      relation === "同度"
        ? "两音同度，四种联袂都成立"
        : relation === "八度"
          ? "两音差八度，只合「放合」"
          : a == null || b == null
            ? "有一音推算不出音高（缺弦序或徽位），无法判断"
            : "两音既不同度也不成八度，标了会与实际发声对不上";
    return { relation, description };
  })();

  function handleRemove(id: string) {
    const removedIdx = score.findIndex((n) => n.id === id);
    // 删掉组首会让成员变成孤儿、删掉中间音会把组打断——都要顺手解组，
    // 否则谱面上会留下一条连不起来的连音线。
    commitScore((prev) => normalizeLianmei(prev.filter((n) => n.id !== id)));
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


  /** 判定通过顺手记一笔练琴，不然「练了多久」还要用户自己再填一遍。 */
  const handleFollowLog = useCallback(
    (seconds: number) => {
      if (practiceIndex === null) return;
      void addEntry({
        scoreTitle,
        seconds,
        note: `跟弹 · 第 ${practiceIndex + 1} 句 · ${practiceTempo}×`,
        source: "judge",
      });
    },
    [practiceIndex, scoreTitle, practiceTempo],
  );

  /**
   * 开始判定前先把会出声的都停掉。
   *
   * 不停就会把参考音录进麦克风，判定结果必然满分——等于自己给自己打分。
   * 这件事不能只写在提示语里（那等于没写），必须在代码里保证。
   */
  const handleFollowBeforeStart = useCallback(() => {
    stopPlayback();
    if (metronomeRunning) stopMetronome();
  }, [stopPlayback, metronomeRunning, stopMetronome]);

  /** 跟弹时的高亮：单独一条通道，不与播放的 playingIndex 抢。 */
  const [followHighlight, setFollowHighlight] = useState<number | null>(null);

  /**
   * 保存曲谱。
   *
   * 两条路：
   * - **后端可达**：发布到社区 / 更新已有谱（`api.createScore` / `updateScore`）。
   * - **后端连不上**：降级存本机浏览器，并**如实告知**「换设备会丢」。
   *
   * ## 为什么要做降级（2026-11-18 实拍发现）
   *
   * 本机开发时若没起 `taiyin-server`，页面仍按 server 模式发请求 → 连接被拒 →
   * 用户看到「保存失败」，而且**什么都没存上**（localStorage 是空的）。
   * 这个工具本来就支持纯前端使用，不该因为没开后端就丢掉保存能力。
   *
   * 只降级「连不上」这一种。服务端回了 401/409/403 等真实判断时照常上报——
   * 那些是业务结论，不是网络故障。
   */
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
          if (!hasStatus(err, 403)) throw err;
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
      // 保存成功：当前内容成为新的「干净基线」，之后再改动才算未保存
      setSavedFingerprint(scoreFingerprint(scoreTitle, score, tuning));
      // 已经存进库里了，草稿不再需要——否则下次打开会提示「恢复」一份早就存好的谱
      clearDraft();
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      /*
       * 后端连不上 → 存本机，并告诉用户这次没进社区。
       *
       * 「以为发到了社区、其实只在这台机器上」比「保存失败」更危险：
       * 失败他会重试，误以为成功就再也不会检查。
       */
      if (!isBackendUnreachable(err)) {
        setSaveStatus("error");
        showError(errorText(err, "保存失败，请检查网络或后端状态"));
        setTimeout(() => setSaveStatus("idle"), 3000);
        return;
      }
      try {
        const local = localCreateScore(scoreTitle, score, tuning);
        setCurrentScoreId(local.id);
        setSavedFingerprint(scoreFingerprint(scoreTitle, score, tuning));
        clearDraft();
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        showInfo("后端连不上，已存到本机浏览器（换设备或清缓存会丢失）");
      } catch {
        setSaveStatus("error");
        showError("保存失败：浏览器不允许本地存储（可能处于隐私模式）");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
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

  /**
   * 社区列表再取一页，追加到当前 tab。
   *
   * 只取一页而不是一次拉完：社区谱会越攒越多，全量拉取会随曲谱数量线性变慢，
   * 而用户通常只关心最近发布的那些。
   */
  async function handleLoadMoreCommunity() {
    // 从 ref 读：这里的回调是首次渲染时被写进 tab 对象的，直接读 state 会读到空数组
    const tab = loadTabsRef.current.find((t) => t.key === "community");
    // 找不到 tab 是「点了按钮却没有列表」：绝不静默吞掉（静默早退正是
    // 2026-11-10 CI 假红的形态）。加载中不重入：按钮已 disabled，
    // 但双击 / 回车仍可能连发。
    if (!tab) {
      showError("列表状态已失效，请关闭后重新打开");
      return;
    }
    if (tab.loadingMore) return;

    setLoadTabs((prev) =>
      prev.map((t) => (t.key === "community" ? { ...t, loadingMore: true } : t)),
    );
    try {
      const page = await api.listScoresPage({
        limit: 50,
        offset: tab.scores.length,
        sort: tab.sort,
        query: tab.query,
        tuning: tab.tuning ?? undefined,
      });
      setLoadTabs((prev) =>
        prev.map((t) => {
          if (t.key !== "community") return t;
          return {
            ...t,
            scores: [...t.scores, ...page.items],
            total: page.total ?? t.total ?? null,
            // 「我的谱」集合必须跟着一起扩。少这一步的表现是：翻到第二页，
            // 明明是自己发的谱却没有删除按钮——看起来像「我的谱突然删不掉了」。
            myScoreIds: [
              ...(t.myScoreIds ?? []),
              ...page.items.filter((x) => isMyScore(x.id)).map((x) => x.id),
            ],
            loadingMore: false,
          };
        }),
      );
    } catch {
      setLoadTabs((prev) =>
        prev.map((t) => (t.key === "community" ? { ...t, loadingMore: false } : t)),
      );
      showError("加载更多失败，请稍后再试");
    }
  }

  /**
   * 切换社区列表排序（最新 / 最热）。
   *
   * 不是「在前端把现有几页重排」——那只能排已加载的几十首，藏在前几页之后的热门谱
   * 永远排不出来。而是带上 sort 参数重新拉第一页，让服务端按收藏数重排；
   * 翻页也跟着用同一个 sort（见 `handleLoadMoreCommunity`），保证整列顺序一致。
   */
  async function handleCommunitySortChange(sort: "recent" | "popular") {
    const tab = loadTabsRef.current.find((t) => t.key === "community");
    // 重入保护与翻页一致：正在加载时忽略再次点击；找不到 tab 同样要出声
    if (!tab) {
      showError("列表状态已失效，请关闭后重新打开");
      return;
    }
    if (tab.loadingMore) return;

    setLoadTabs((prev) =>
      prev.map((t) => (t.key === "community" ? { ...t, loadingMore: true } : t)),
    );
    try {
      const page = await api.listScoresPage({
        limit: 50,
        sort,
        query: tab.query,
        tuning: tab.tuning ?? undefined,
      });
      setLoadTabs((prev) =>
        prev.map((t) => {
          if (t.key !== "community") return t;
          return {
            ...t,
            sort,
            scores: page.items,
            total: page.total ?? t.total ?? null,
            // 「我的谱」集合要跟着新的一页重建，否则第二页里自己发的谱没了删除按钮
            myScoreIds: page.items.filter((x) => isMyScore(x.id)).map((x) => x.id),
            loadingMore: false,
          };
        }),
      );
    } catch {
      setLoadTabs((prev) =>
        prev.map((t) => (t.key === "community" ? { ...t, loadingMore: false } : t)),
      );
      showError("切换排序失败，请稍后再试");
    }
  }

  /**
   * 社区列表关键词 / 定弦过滤：带 query + tuning 重新拉第一页，替换整列。
   *
   * 与排序、翻页共三条纪律：①不可重入（loadingMore 保护，双击 / 回车不连发）；
   * ②失败复位 loadingMore，否则按钮卡在禁用态；③把 query / tuning 写回 tab，
   * 这样接下去的翻页、切排序都跟着同一组过滤——否则翻到第二页过滤悄悄失效，
   * 用户会以为「搜索只在前面几十首里查」其实是整库都漏了后面的热门谱。
   */
  async function handleCommunityFilterChange(query: string, tuning: TuningId | null) {
    const tab = loadTabsRef.current.find((t) => t.key === "community");
    if (!tab) {
      showError("列表状态已失效，请关闭后重新打开");
      return;
    }
    if (tab.loadingMore) return;

    setLoadTabs((prev) =>
      prev.map((t) => (t.key === "community" ? { ...t, loadingMore: true } : t)),
    );
    try {
      const page = await api.listScoresPage({
        limit: 50,
        sort: tab.sort,
        query,
        tuning: tuning ?? undefined,
      });
      setLoadTabs((prev) =>
        prev.map((t) => {
          if (t.key !== "community") return t;
          return {
            ...t,
            query,
            tuning,
            scores: page.items,
            total: page.total ?? t.total ?? null,
            myScoreIds: page.items.filter((x) => isMyScore(x.id)).map((x) => x.id),
            loadingMore: false,
          };
        }),
      );
    } catch {
      setLoadTabs((prev) =>
        prev.map((t) => (t.key === "community" ? { ...t, loadingMore: false } : t)),
      );
      showError("筛选失败，请稍后再试");
    }
  }

  /** 「我的收藏」翻页。与社区翻页同样的两条纪律：不可重入、失败要复位 loadingMore。 */
  async function handleLoadMoreFavorites() {
    const tab = loadTabsRef.current.find((t) => t.key === "favorites");
    if (!tab) {
      showError("列表状态已失效，请关闭后重新打开");
      return;
    }
    if (tab.loadingMore) return;

    setLoadTabs((prev) =>
      prev.map((t) => (t.key === "favorites" ? { ...t, loadingMore: true } : t)),
    );
    try {
      const page = await api.listFavoritesPage({ limit: 50, offset: tab.scores.length });
      setLoadTabs((prev) =>
        prev.map((t) => {
          if (t.key !== "favorites") return t;
          return {
            ...t,
            scores: [...t.scores, ...page.items],
            total: page.total ?? t.total ?? null,
            // 「我的谱」集合要跟着扩，否则第二页里自己发的谱没有删除按钮
            myScoreIds: [
              ...(t.myScoreIds ?? []),
              ...page.items.filter((x) => isMyScore(x.id)).map((x) => x.id),
            ],
            loadingMore: false,
          };
        }),
      );
    } catch {
      setLoadTabs((prev) =>
        prev.map((t) => (t.key === "favorites" ? { ...t, loadingMore: false } : t)),
      );
      showError("加载更多收藏失败，请稍后再试");
    }
  }

  /**
   * 收藏 / 取消收藏一首谱。
   *
   * 三点刻意为之：
   * ① 未登录直接提示去登录——静默失败会让人以为按钮坏了；
   * ② 取消收藏时，若正停在「我的收藏」tab，这一行要**立刻消失**，
   *    否则用户会以为没生效、再点一次（虽然接口幂等，但体验是坏的）；
   * ③ 失败不改本地状态：宁可显示没收藏，也不能显示「已收藏」而服务端没记上。
   */
  async function handleToggleFavorite(id: string, favorited: boolean) {
    if (!getCurrentUserId()) {
      showError("收藏需要先登录：在「社区后端」面板里注册 / 登录后，收藏会跟着账号走");
      return;
    }
    try {
      if (favorited) {
        await api.favoriteScore(id);
        setFavoriteIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        showInfo("已加入我的收藏");
      } else {
        await api.unfavoriteScore(id);
        setFavoriteIds((prev) => prev.filter((x) => x !== id));
        setLoadTabs((prev) =>
          prev.map((t) =>
            t.key === "favorites"
              ? {
                  ...t,
                  scores: t.scores.filter((s) => s.id !== id),
                  total: t.total === null || t.total === undefined ? t.total : Math.max(0, t.total - 1),
                }
              : t,
          ),
        );
      }
    } catch (err) {
      showError(errorText(err, "收藏失败，请检查网络或后端状态"));
    }
  }

  /** 打开加载对话框：连后端时同时拉「社区共享谱」与「本机谱」两个 tab */
  async function openLoadDialog() {
    try {
      if (storageMode === "server") {
        /*
         * 社区列表拉不到时**不能连累整个对话框**（2026-11-18 实拍发现）。
         *
         * 原先这里直接 await，失败就抛到外层 catch → 对话框根本不打开。
         * 于是「后端没起」的用户连**本机谱**都打不开——他明明存过谱，
         * 却因为社区那一栏拉不到而看不到自己的东西。这是最气人的那种坏法。
         *
         * 现在分开处理：社区拉不到就记下来，本机谱照常显示，并在对话框里说明。
         */
        let serverList: api.ScoreListItem[] = [];
        let serverPageTotal: number | null = null;
        let communityFailed = false;
        try {
          const firstPage = await api.listScoresPage({ limit: 50 });
          serverList = firstPage.items;
          serverPageTotal = firstPage.total;
        } catch {
          communityFailed = true;
        }
        let localList: api.ScoreListItem[] = [];
        try {
          localList = await api.localListScores();
        } catch {
          // 隐私模式 / IndexedDB 不可用：本机 tab 直接为空即可，不影响社区浏览
        }

        const myId = getCurrentUserId();
        const tabs: LoadDialogTab[] = [];
        // 收藏 tab 排在最前：它是「我还要再弹一次」的短列表，比在社区里重新找快得多。
        // 只在**确实收过谱**时加：一打开就落在空列表上，比没有这个 tab 更让人困惑。
        if (myId) {
          try {
            const favPage = await api.listFavoritesPage({ limit: 50 });
            const favTotal = favPage.total ?? favPage.items.length;
            if (favTotal > 0) {
              tabs.push({
                key: "favorites",
                label: "我的收藏",
                scores: favPage.items,
                readOnly: true,
                myScoreIds: favPage.items.filter((s) => isMyScore(s.id)).map((s) => s.id),
                myUserId: myId,
                total: favPage.total,
                onLoadMore: handleLoadMoreFavorites,
              });
            }
            setFavoriteIds(await api.listFavoriteIds());
          } catch {
            // 收藏是附加能力：接口挂了不该让「打开曲谱」整个失败
            setFavoriteIds([]);
          }
        } else {
          setFavoriteIds([]);
        }

        if (!communityFailed) {
          tabs.push({
          key: "community",
          label: "社区曲谱",
          scores: serverList,
          readOnly: true,
          // 只读是「不让你删别人的谱」，自己发布的仍要能删（否则发布即不可撤回）
          myScoreIds: serverList.filter((s) => isMyScore(s.id)).map((s) => s.id),
          // 登录者的账号 id：换设备发的谱，靠它也能认出是「我的」
          myUserId: myId,
          // 总数与翻页：只有第一页时用户会以为社区就这么几首
          total: serverPageTotal,
          // 社区列表默认按更新时间；用户切到「最热」时由 onCommunitySortChange 重拉
          sort: "recent",
          // 关键词 / 定弦过滤的客户端回显，初始为空（不做过滤）
          query: "",
          tuning: null,
          onLoadMore: handleLoadMoreCommunity,
          });
        }
        if (localList.length > 0) {
          tabs.push({ key: "local", label: "本机", scores: localList, showMigrate: true });
        }
        if (communityFailed) {
          // 说清楚「社区那一栏为什么没有」，而不是让用户以为谱丢了
          showInfo("连不上社区后端，只显示本机保存的曲谱");
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
      // 服务端的收藏行会随曲谱一起级联删除，本地这份也要跟着去掉，
      // 否则同一次会话里再打开收藏 tab，星标还亮着却点不出内容
      setFavoriteIds((prev) => prev.filter((x) => x !== id));
      setLoadTabs((prev) =>
        prev.map((t) => ({
          ...t,
          scores: t.scores.filter((s) => s.id !== id),
          myScoreIds: t.myScoreIds?.filter((x) => x !== id),
        })),
      );
      if (currentScoreId === id) {
        setScore([]);
        setScoreTitle(UNTITLED_TITLE);
        setCurrentScoreId(null);
        // 删掉当前谱后编辑区回到空谱，应算「干净」——否则关页会莫名拦一次
        setSavedFingerprint(scoreFingerprint(UNTITLED_TITLE, [], tuning));
        // 谱已经删了，别在下次打开时提示恢复它
        clearDraft();
      }
    } catch (err) {
      showError(errorText(err, "删除失败"));
    }
  }

  /**
   * 认领旧谱：把「这台设备用凭证发布的谱」挂到登录账号下。
   *
   * 认领前这首谱只认本机凭证——清缓存、换电脑就再也改不动它。
   * 认领后服务端记的是账号，换设备登录照样改删。
   * 服务端要求同时出示登录态与原凭证，所以别人的谱点了也只会 403。
   */
  async function handleClaimScore(id: string, title: string) {
    if (!getCurrentUserId()) {
      showError("请先登录，再认领曲谱");
      return;
    }
    if (!confirm(`把「${title}」挂到我的账号下？之后换设备也能改删它。`)) return;
    try {
      const claimed = await api.claimScore(id);
      // 就地更新列表：让「我的」标记立刻出现，不必关掉对话框重开
      setLoadTabs((prev) =>
        prev.map((t) => ({
          ...t,
          scores: t.scores.map((s) => (s.id === id ? { ...s, owner_user_id: claimed.owner_user_id } : s)),
        })),
      );
      showInfo("已认领到我的账号，之后换设备也能改删它");
    } catch (err) {
      showError(errorText(err, "认领失败"));
    }
  }

  /**
   * 举报别人的谱。
   *
   * 只提交线索，**不会当场下架**——下架必须由管理员看过后手动执行。
   * 这是刻意的：注册不验邮箱，若「N 人举报即下架」，攻击者开三个小号
   * 就能删掉任何一首好谱。所以这里的文案也不能承诺「已处理」。
   */
  async function handleReportScore(id: string, title: string) {
    if (!getCurrentUserId()) {
      showError("举报需要登录（这样才认得举报人、也才能去重）");
      return;
    }
    if (!confirm(`举报「${title}」？\n\n举报只会把线索交给管理员，不会自动下架。`)) return;
    try {
      const result = await api.reportScore(id);
      showInfo(
        result.reported
          ? `已收到举报，感谢（当前 ${result.reports_count} 人举报）`
          : "你之前已经举报过这首，管理员会一并处理",
      );
    } catch (err) {
      showError(errorText(err, "举报失败"));
    }
  }

  /**
   * 加载选中的曲谱。
   * browser 模式下 api.getScore 内部已走本地存储，无需分流；
   * 仅 server 模式下的「本机」tab 才强制走本地——否则 api.getScore 会把本地 id 发到服务器而 404。
   */
  async function handleLoadScore(id: string, tabKey: string) {
    // 载入会直接覆盖编辑区，而内存里没有自动草稿：先问一句再动手
    if (isDirty && !confirmDiscard()) return;
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
      // 账号归属也算「我的」：换设备登录后载入自己以前发的谱，
      // 保存应当走更新而不是另建副本——这正是账号体系要兑现的承诺。
      // `owner_user_id` 只有服务端谱才有，本机谱没有该字段，故按可选读取。
      const myId = getCurrentUserId();
      const ownerId = (scoreData as { owner_user_id?: string | null }).owner_user_id;
      if (myId && ownerId === myId) rememberMyScore(scoreData.id);
      setShowLoadDialog(false);
      setEditingIndex(null);
      // 刚载入的内容就是「干净基线」，不该一进来就提示未保存
      setSavedFingerprint(scoreFingerprint(scoreData.title, scoreData.notes, scoreData.tuning));
      // 用户已明确选择载入别的谱，旧草稿作废
      clearDraft();
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

  /** 加载预置示例曲谱；返回是否真的换了谱（供「先听一首」决定是否自动起播） */
  function handleLoadExample(id: string): boolean {
    const example = findExampleScore(id);
    if (!example) return false;
    // 示例下拉就在工具栏上，误点一下就会把正在录的谱整首换掉
    if (isDirty && !confirmDiscard()) return false;
    commitScore(() => example.notes);
    commitScoreTitle(example.title);
    setCurrentScoreId(null);
    setEditingIndex(null);
    setSavedFingerprint(scoreFingerprint(example.title, example.notes, tuning));
    // 载入示例是明确的内容选择，旧草稿一并作废
    clearDraft();
    return true;
  }

  /**
   * 「先听一首」：载入示例后自动出声。
   * 名字承诺的是「听」，只把谱摆出来等于少给一半——新访客点一下就该听见琴声，
   * 这也是「打谱工具能出声」最省解释的一次演示。
   */
  function handleListenExample() {
    if (handleLoadExample("canghaixiaoxiao")) autoPlayPendingRef.current = true;
  }

  // 等 score 提交完的下一次渲染再播：此刻 useScorePlayer 已用新谱重建 play()。
  // 直接调 play() 而不走 handlePlay()：后者默认联动节拍器（linkMetronome=true），
  // 一点「先听一首」就谱也响、拍子也响，那是练琴，不是给新访客听一首曲子。
  // 有 ref 守着，score 后续再变（打字、切定弦）都不会莫名其妙自己响。
  useEffect(() => {
    if (!autoPlayPendingRef.current || score.length === 0) return;
    autoPlayPendingRef.current = false;
    void play();
  }, [score, play]);


  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="flex flex-col items-center min-h-dvh py-10 px-4 xl:grid xl:grid-cols-[minmax(0,576px)_360px] xl:gap-6 xl:items-start xl:justify-center xl:max-w-[1280px] xl:mx-auto xl:px-6 xl:mt-6">

      <SiteHeader />

      <div className="xl:col-start-1 w-full min-w-0 flex flex-col items-center">

      {/*
       * ── 首屏：一句话 + 两个按钮（2026-11-18 按「一句话原则」重写） ──
       *
       * ## 旧版错在哪
       *
       * 实测量过：1440×900 的首屏里有 **407 个字、34 个文本块**，而真正的操作区
       * （减字键盘）不在首屏——要滚到 978px 才看得到。文档里自己写着
       * 「不会用：首屏是『选音色→点指法→点弦徽』，对路人是重交互」，一直没改。
       *
       * 一个新手（假设他毫无耐心、也不懂古琴术语）打开页面，只需要回答一个问题：
       * **「我能用它干什么，从哪点开始？」** 别的都是噪声。
       *
       * ## 现在只有三层信息
       *
       * 1. 一句话说清是什么（标题区已有，这里不重复）
       * 2. 两个动作：听不懂就先听（最低门槛），会一点就开始打（主路径）
       * 3. 「第一次用？」折叠着三行说明——想看的人点开，不想看的人永远不用见
       *
       * 三入口（不会弹 / 会弹 / 在学）不再铺成一屏列表：那是产品经理的分类，
       * 不是用户的心智。他只要知道「先听」还是「自己打」。
       */}
      {score.length === 0 && (
        <section
          aria-label="开始使用"
          className="no-print order-last mt-4 w-full max-w-xl rounded-lg border border-amber-700/25 bg-[var(--paper)] shadow-sm xl:order-none xl:col-start-1"
        >
          <div className="ty-panel-accent" />
          <div className="p-4">
            <p className="text-[13px] leading-relaxed text-stone-700">
              把看不懂的古琴老谱，变成能弹、能听的曲子。
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleListenExample}
                className="min-h-[44px] flex-1 rounded bg-amber-800 px-3 text-[13px] tracking-wider text-amber-50 transition-colors hover:bg-amber-900"
              >
                先听一首
              </button>
              <button
                type="button"
                onClick={jumpToKeyboard}
                className="min-h-[44px] flex-1 rounded border border-amber-700/40 px-3 text-[13px] tracking-wider text-amber-900 transition-colors hover:bg-amber-700/10"
              >
                开始打谱
              </button>
            </div>
            {/* 想深入了解的人自己点开；不想看的人不会被 407 个字挡住 */}
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] tracking-wider text-stone-500 select-none">
                第一次用？看这三行
              </summary>
              <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-stone-600">
                <li>· 手上有老谱照片 → 下面「识别减字图片」，逐格校对</li>
                <li>· 想自己打谱 → 下面键盘点几下就出一个字，或直接粘简谱</li>
                <li>· 在学琴 → 逐句慢练、节拍器、调音器都在右侧</li>
              </ul>
            </details>
          </div>
        </section>
      )}

      {/* ── 全局错误 / 中性提示 ── */}
      {/* ── 未保存草稿恢复提示（只在编辑区还空着时出现） ── */}
      {showDraftBanner && pendingDraft && (
        <div className="no-print mt-4 w-full max-w-xl rounded-lg border border-amber-700/30 bg-[var(--paper)] shadow-sm xl:col-start-1">
          <div className="ty-panel-accent" />
          <div className="flex items-center gap-2 px-3 py-2">
            <p className="flex-1 text-[11px] leading-relaxed tracking-wider text-stone-700">
              上次有未保存的草稿：《{pendingDraft.title}》· {pendingDraft.notes.length} 个音 ·{" "}
              {formatDraftAge(pendingDraft.updatedAt)}
            </p>
            <button
              type="button"
              onClick={handleRestoreDraft}
              className="px-2 py-1 text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/40 text-stone-700 hover:text-stone-900 hover:border-amber-700/60 transition-all"
            >
              恢复
            </button>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="px-2 py-1 text-[10px] tracking-wider whitespace-nowrap rounded border border-amber-700/20 text-stone-400 hover:text-red-600 transition-all"
            >
              丢弃
            </button>
          </div>
        </div>
      )}
      {errorMessage && (
        <div className="no-print mt-4 w-full max-w-xl px-3 py-2 rounded border border-red-400/30 bg-red-900/20 text-[11px] tracking-wider text-red-200/80 xl:col-start-1">
          {errorMessage}
        </div>
      )}
      {infoMessage && (
        <div className="no-print mt-4 w-full max-w-xl px-3 py-2 rounded border border-emerald-500/30 bg-emerald-900/20 text-[11px] tracking-wider text-emerald-200/80 xl:col-start-1">
          {infoMessage}
        </div>
      )}

      {/* ── 谱面排版：布局 / 疏密 / 行宽（只影响显示与导出，不进打印稿） ── */}
      {score.length > 0 && (
        <div className="no-print mt-6 flex w-full max-w-xl flex-wrap items-center justify-end gap-1.5 xl:col-start-1">
          <span className="text-[10px] tracking-wider text-amber-600/50 mr-1">
            谱面
          </span>
          {LAYOUT_OPTIONS.map((o) => {
            const active = layoutPref.layout === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setLayoutPref({ layout: o.id as ScoreLayout })}
                aria-pressed={active}
                title={o.hint}
                className={`px-2 py-1 min-h-[44px] text-[10px] tracking-wider rounded border transition-all ${
                  active
                    ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                    : "border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50"
                }`}
              >
                {o.label}
              </button>
            );
          })}
          <span className="text-[10px] tracking-wider text-amber-600/50">
            密
          </span>
          <select
            value={layoutPref.density}
            onChange={(e) =>
              setLayoutPref({ density: e.target.value as ScoreDensity })
            }
            aria-label="谱面疏密"
            title="音符之间的间距"
            className="px-2 py-1 min-h-[44px] text-[10px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 outline-none focus:border-amber-600/50"
          >
            {DENSITY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] tracking-wider text-amber-600/50">
            宽
          </span>
          <select
            value={layoutPref.width}
            onChange={(e) =>
              setLayoutPref({ width: e.target.value as ScoreWidth })
            }
            aria-label="谱面行宽"
            title="一行能放多少音；宽档一屏看得更多"
            className="px-2 py-1 min-h-[44px] text-[10px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 outline-none focus:border-amber-600/50"
          >
            {WIDTH_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <h2 className="sr-only">曲谱</h2>
      {/* ── 乐谱流（导出截图目标） ── */}
      <div
        id="score-area"
        ref={exportRef}
        className="mt-8 w-full xl:col-start-1"
        style={{ maxWidth: `${WIDTH_MAX_REM[layoutPref.width]}rem` }}
      >
        <ScoreView notes={score} beatsPerBar={beatsPerBar} layout={layoutPref.layout} density={layoutPref.density} onRemove={handleRemove} onEdit={handleEdit} onSeekLyric={handleSeekLyric} onChangeDuration={handleChangeDuration} editingIndex={editingIndex} playingIndex={playingIndex ?? followHighlight} />
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

      {/*
       * ── 轻用场景引导：只在空谱时出现 ──
       * 放在 #score-area 之外：那一块是整谱导出截图的靶子，写进来会被一起截进 PNG。
       * 内容对应的能力是真的闭环（连打敲完的字也能「存为常用 → 图 / 矢」），
       * 不是宣传话术；有音符以后收起，不占正在打谱的人的屏幕。
       *
       * 移动端同样 `order-last`：与「太音是什么」一样，它是引导不是主操作，
       * 不该把减字键盘推到一屏之外（详见上方介绍区的说明）。
       */}
      {/*
       * ── 「只想记一个字」：改成折叠，默认收起（2026-11-18） ──
       *
       * 这是**次要场景**（记一个指法贴进课件），却和主路径（打一首谱）平排在首屏，
       * 各占一大块。实测量过：它把首屏文字从 400 字推到「看不清重点」的程度。
       *
       * 现在收成一行标题，想用的人点开。主路径上不该有两个同等重量的入口。
       */}
      {score.length === 0 && (
        <details className="no-print order-last mt-3 w-full max-w-xl rounded-lg border border-amber-700/25 bg-[var(--paper)] shadow-sm xl:order-none xl:col-start-1">
          <summary className="cursor-pointer px-4 py-3 text-[12px] tracking-wider text-stone-600 select-none">
            只想记一个字？不必打整首谱
          </summary>
          <div className="px-4 pb-4">
            <ul className="space-y-1 text-[12px] leading-relaxed text-stone-600">
              <li>· 课后记下老师所授的一处指法</li>
              <li>· 备课、批改时在课件里标一个减字</li>
              <li>· 写文章、发视频时配一张准确的减字图</li>
            </ul>
            <p className="mt-2 text-[12px] leading-relaxed text-stone-600">
              敲一个减字 →「存为常用」→ 点卡片上的「图 / 矢」，即得 PNG / SVG，
              贴进笔记或课件。不用装字体、不用装输入法。
            </p>
            <button
              type="button"
              onClick={jumpToKeyboard}
              className="mt-3 min-h-[40px] rounded border border-amber-700/40 px-3 text-[12px] tracking-wider text-amber-900 transition-colors hover:bg-amber-700/10"
            >
              去敲一个字
            </button>
          </div>
        </details>
      )}

      {/* ── 工具栏：标题 + 保存 / 加载 / 导出 ── */}
      <div className="xl:col-start-1 w-full flex justify-center">
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
        onExportText={exportText}
        onExportWav={exportWav}
        onExportMidi={exportMidi}
        onExportPdf={exportPdf}
        isExportingAudio={isExportingAudio}
        examples={EXAMPLE_SCORES}
        onLoadExample={handleLoadExample}
        hasNotes={score.length > 0}
        isDirty={isDirty}
        saveStatus={saveStatus}
        isExporting={isExporting}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      </div>

      <h2 className="sr-only">录入减字</h2>
      {/* ── 主卡片 —— 宣纸质感 ── */}
      <div
        id="keyboard-area"
        className="no-print mt-4 w-full max-w-xl rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30 ty-panel"
      >
        {/* 卡片顶部装饰线（朱砂色） */}
        <div className="ty-panel-accent" />

        <div className="p-5">
          {editingIndex !== null && (
            <div className="mb-3">
              <div className="flex items-center justify-between">
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

              {/* ── 联袂指法：与后一个音成组 ── */}
              {editingIndex + 1 < score.length && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] tracking-wider text-rose-700/70">
                    与后一音联袂
                  </span>
                  {LIANMEI_OPTIONS.map((o) => {
                    const linked = score[editingIndex].lianmei;
                    const isThisHead =
                      linked?.kind === o.kind &&
                      linked.headId === score[editingIndex].id;
                    const fits =
                      lianmeiRelationInfo &&
                      relationFits(o.kind, lianmeiRelationInfo.relation);
                    return (
                      <button
                        key={o.kind}
                        onClick={() => handleLinkLianmei(o.kind)}
                        aria-pressed={isThisHead}
                        title={o.hint}
                        className={`px-2 py-1 min-h-[32px] text-[10px] tracking-wider rounded border transition-all ${
                          isThisHead
                            ? "border-rose-500/60 bg-rose-100 text-rose-800"
                            : fits
                              ? "border-rose-400/30 text-rose-700/70 hover:border-rose-500/60"
                              : "border-stone-400/30 text-stone-400"
                        }`}
                      >
                        {o.kind}
                      </button>
                    );
                  })}
                  {score[editingIndex].lianmei && (
                    <button
                      onClick={handleClearLianmei}
                      className="px-2 py-1 min-h-[32px] text-[10px] tracking-wider rounded border border-stone-400/30 text-stone-500 hover:text-stone-700 transition-all"
                    >
                      解组
                    </button>
                  )}
                </div>
              )}
              {lianmeiRelationInfo && (
                <p
                  data-lianmei-relation
                  className={`mt-1 text-[9px] tracking-wider ${
                    lianmeiRelationInfo.relation === "不合"
                      ? "text-rose-700/80"
                      : "text-emerald-800/70"
                  }`}
                >
                  {lianmeiRelationInfo.description}
                </p>
              )}
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
              <p className="mb-1 text-[9px] leading-relaxed tracking-wider text-amber-700/70">
                提示：在「简谱转减字」里输入简谱（如{" "}
                <code className="rounded bg-amber-900/10 px-1">5 6 1 2 | 3 5 6 -</code>
                ），可一键生成多套减字谱候选并智能编排指法；也支持「减字码入谱」整段粘入。
              </p>
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
      </div>

      <div className="xl:col-start-2 w-full min-w-0 flex flex-col items-stretch">
      <SectionNav />

      {/* ── 演奏控制台 ── */}
      <div id="sec-console" className="ty-panel no-print mt-4 w-full max-w-xl p-4 xl:col-start-2">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="ty-section-title">演奏控制台</h2>
          <span className="ty-section-sub">速度 · 节拍 · 定弦 · 基准音</span>
        </div>
        <div className="ty-console">
          {/* 导出选项（仅在有音符时显示） */}
          {score.length > 0 && (
        <div className="no-print w-full max-w-none flex flex-wrap items-center justify-end gap-3">
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
      <div className="no-print w-full max-w-none flex flex-wrap items-center justify-end gap-2 gap-y-2">
        {/*
         * 节拍器按钮：跑起来时文字改成「■ 节拍中」，不只靠底色。
         *
         * 2026-11-18 实拍：原先文字恒定是「节拍」，运行与否只差一层淡淡的琥珀底。
         * 用户点了之后没法确认它到底响没响——尤其节拍器通常是静音排练时才开，
         * 光看一个色块猜状态太不可靠。文字是最直白的信号。
         */}
        <button
          onClick={toggleMetronome}
          aria-label={metronomeRunning ? "停止节拍器" : "启动节拍器"}
          aria-pressed={metronomeRunning}
          className={`px-2 py-1 min-h-[44px] text-[10px] tracking-wider rounded border transition-all ${
            metronomeRunning
              ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
              : "border-amber-700/30 text-stone-500 hover:text-stone-300 hover:border-amber-600/50"
          }`}
        >
          {metronomeRunning ? "■ 节拍中" : "节拍"}
        </button>
        <button
          onClick={isPlaying ? handleStop : handlePlay}
          disabled={score.length === 0}
          aria-label={isPlaying ? "停止播放" : "播放"}
          title={score.length === 0 ? "先敲一个音，或点上方「先听一首」载入示例曲，才能播放" : "空格键播放 / 停止"}
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

      {/* ── 逐句慢练：按气口切出来的句，点一句就连弹三遍 ── */}
      <PhrasePractice
        phrases={scorePhrases}
        bpm={bpm}
        tempo={practiceTempo}
        activeIndex={activePracticeIndex}
        joinTo={activeJoinTo}
        joinedTempo={activeJoinTo !== null ? (activePractice?.tempo ?? null) : null}
        selectedIndex={practiceIndex}
        pass={practicePass}
        repeat={activePractice?.repeat ?? PRACTICE_REPEATS}
        progress={phraseProgress}
        onTempoChange={setPracticeTempo}
        onStart={practicePhrase}
        onStop={stopPractice}
        onJoin={practiceJoin}
      />

      {/* ── 跟弹判定：关掉参考音，只听你弹得准不准 ── */}
      <FollowPlayPanel
        notes={score}
        phrase={practiceIndex !== null ? scorePhrases[practiceIndex] : undefined}
        bpm={bpm}
        tempo={practiceTempo}
        concertPitch={concertPitch}
        tuning={tuning}
        onBeforeStart={handleFollowBeforeStart}
        onPass={handleFollowPass}
        onLog={handleFollowLog}
        onHighlight={setFollowHighlight}
      />

      {/* ── 拍点高亮（节拍器/联动播放时显示，重拍为朱砂色） ── */}
      {metronomeRunning && (
        <div className="no-print w-full max-w-none flex items-center justify-center gap-2" aria-hidden>
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
      <div className="no-print w-full max-w-none flex items-center gap-3 py-1.5">
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
      <div className="no-print mt-1 w-full max-w-xl flex items-center gap-3 py-1.5">
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
      <div className="no-print mt-1 w-full max-w-xl flex items-center gap-3 py-1.5">
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
          title={concertPitch === CONCERT_PITCH_DEFAULT ? "当前已是标准音高 A4=440" : "回到标准音高 A4=440"}
        >
          标准
        </button>
      </div>
        </div>
      </div>

      {/* ── 社区后端设置（可选）：填了就能浏览 / 发布社区曲谱 ── */}
      <div className="xl:col-start-2 w-full flex justify-center">
        <BackendSettings />
      </div>

      {/* ── 加载对话框 ── */}
      <LoadDialog
        key={showLoadDialog ? "load-open" : "load-closed"}
        open={showLoadDialog}
        onClose={() => setShowLoadDialog(false)}
        tabs={loadTabs}
        onLoad={handleLoadScore}
        onDelete={handleDeleteScore}
        onClaim={handleClaimScore}
        // 与星标同理：举报接口要求登录，未登录就别画一个点了必然 401 的按钮
        onReport={getCurrentUserId() ? handleReportScore : undefined}
        onMigrate={handleMigrateLocalToCommunity}
        migrating={migrating}
        migrateMsg={migrateMsg}
        favoriteIds={favoriteIds}
        // 未登录不传回调 = 对话框不画星标。收藏接口要求登录态，
        // 画一个点了必然 401 的星星，比不画更让人怀疑功能坏了。
        onToggleFavorite={getCurrentUserId() ? handleToggleFavorite : undefined}
        onCommunitySortChange={handleCommunitySortChange}
        onCommunityFilterChange={handleCommunityFilterChange}
      />


      {/* 右栏工具组：五个折叠面板的开合 / tab 状态都收在组件内部 */}
      <PracticePanels
        onImportNotes={(notes) => commitScore((prev) => [...prev, ...notes])}
        scoreTitle={scoreTitle}
        sticking={sticking}
        onPracticePhrase={practiceSticking}
      />

      </div>

      <SiteFooter />
      <BackToTop />
    </main>
    </>
  );
}
