/**
 * 自动草稿 —— 从 `page.tsx` 拆出来的一个关注点。
 *
 * ## 为什么是草稿，而不是「整个曲谱状态」
 *
 * 曲谱本身（`score`/`title`/undo 栈）与页面里几乎所有 UI 都相连，动它风险最高。
 * 草稿是一块**边界清晰**的独立逻辑：只读曲谱、只写 localStorage、只对外暴露
 * 「有没有待恢复的草稿」与两个动作。先把它摘出来，页面少一个跨关注点的隐式耦合，
 * 而 `score` 的所有权暂时不动。
 *
 * ## 刻意的两条行为
 *
 * 1. **只在页面还是空的时候提示恢复**。用户一旦开始录入，提示自动消失，
 *    草稿照常被新内容覆盖——「开始录」就是选了「不恢复」，比加一堆确认框更合直觉。
 * 2. **分享直达时不弹草稿**。`?score=` 本身就是「载入一份内容」，
 *    此时再问「要不要恢复上次的草稿」等于让两条载入路径打架。
 */

import { useCallback, useEffect, useState } from "react";
import {
  clearDraft,
  readDraft,
  writeDraft,
  type ScoreDraft,
} from "./draft-store";
import { readSharedScoreId } from "./share-link";
import type { NoteColumn } from "./types";
import type { TuningId } from "./tuning";

interface Options {
  score: NoteColumn[];
  scoreTitle: string;
  tuning: TuningId;
  currentScoreId: string | null;
  /** 有未保存修改（页面算好传进来：草稿不该自己再判一遍脏标记）。 */
  isDirty: boolean;
  /** 新建曲谱的默认标题；同时是「用户是否动过标题」的判断基准。 */
  untitledTitle: string;
}

export function useScoreDraft({
  score,
  scoreTitle,
  tuning,
  currentScoreId,
  isDirty,
  untitledTitle,
}: Options) {
  const [pendingDraft, setPendingDraft] = useState<ScoreDraft | null>(null);

  const isPristine = score.length === 0 && scoreTitle === untitledTitle;
  const showDraftBanner = pendingDraft !== null && isPristine;

  // 读草稿只能在 effect 里做：渲染期读 localStorage 会让预渲染与客户端首帧不一致。
  //
  // ⚠ `window` 也只能在这里碰。早先把「是不是分享直达」在渲染期算好当参数传进来，
  // 预渲染阶段直接 `ReferenceError: window is not defined` 让整站构建失败
  // （静态导出没有 window）。判断必须留在客户端侧的 effect 内。
  useEffect(() => {
    // 分享直达（?score=）本身就是「载入一份内容」，此时再弹草稿提示会互相打架
    if (readSharedScoreId(window.location.search) !== null) return;
    const draft = readDraft();
    if (!draft || draft.notes.length === 0) return;
    // 把「外部存储里的草稿」搬进 React 状态，正是 effect 存在的意义
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部存储 → React 状态的同步
    setPendingDraft(draft);
  }, []);

  // 有未保存修改时防抖写草稿（600ms，避免每敲一个音就写一次盘）
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      writeDraft({ title: scoreTitle, notes: score, tuning, scoreId: currentScoreId });
    }, 600);
    return () => clearTimeout(timer);
  }, [isDirty, scoreTitle, score, tuning, currentScoreId]);

  /** 丢弃待恢复的草稿提示（不删盘上的草稿，等下次编辑覆盖）。 */
  const dismissDraft = useCallback(() => {
    setPendingDraft(null);
  }, []);

  /** 彻底丢弃：清盘并收起提示。 */
  const discardDraft = useCallback(() => {
    clearDraft();
    setPendingDraft(null);
  }, []);

  /**
   * 取出要恢复的内容并收起提示。
   *
   * 返回值交给调用方去应用——应用草稿要动 `score`/`title`/`tuning`/`currentScoreId`，
   * 那是曲谱状态的职责，不该由草稿 hook 越界写入。
   * 本机 id（`local-` 开头）在 server 模式下发给后端只会 404，这里只做判断、不替调用方决定。
   */
  const takeDraftForRestore = useCallback((): ScoreDraft | null => {
    if (!pendingDraft) return null;
    const draft = pendingDraft;
    setPendingDraft(null);
    return draft;
  }, [pendingDraft]);

  return {
    pendingDraft,
    showDraftBanner,
    dismissDraft,
    discardDraft,
    takeDraftForRestore,
  };
}
