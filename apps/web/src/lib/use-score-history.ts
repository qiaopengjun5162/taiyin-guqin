"use client";

import { useCallback, useState, type SetStateAction } from "react";
import type { NoteColumn } from "./types";

type Snapshot = {
  score: NoteColumn[];
  title: string;
};

type History = {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
};

const MAX_HISTORY = 50;

function snapshotEq(a: Snapshot, b: Snapshot): boolean {
  return a.title === b.title && JSON.stringify(a.score) === JSON.stringify(b.score);
}

export function useScoreHistory(
  initialScore: NoteColumn[] = [],
  initialTitle = "未命名曲谱",
) {
  const [history, setHistory] = useState<History>({
    past: [],
    present: { score: initialScore, title: initialTitle },
    future: [],
  });

  const setScore = useCallback((updater: SetStateAction<NoteColumn[]>) => {
    setHistory((prev) => ({
      ...prev,
      present: {
        ...prev.present,
        score:
          typeof updater === "function"
            ? (updater as (prev: NoteColumn[]) => NoteColumn[])(prev.present.score)
            : updater,
      },
    }));
  }, []);

  const setTitle = useCallback((title: string) => {
    setHistory((prev) => ({
      ...prev,
      present: { ...prev.present, title },
    }));
  }, []);

  const commitScore = useCallback((updater: SetStateAction<NoteColumn[]>) => {
    setHistory((prev) => {
      const nextScore =
        typeof updater === "function"
          ? (updater as (prev: NoteColumn[]) => NoteColumn[])(prev.present.score)
          : updater;
      const nextPresent = { ...prev.present, score: nextScore };
      if (snapshotEq(prev.present, nextPresent)) return prev;
      const newPast = [...prev.past, prev.present];
      if (newPast.length > MAX_HISTORY) {
        newPast.splice(1, 1);
      }
      return {
        past: newPast,
        present: nextPresent,
        future: [],
      };
    });
  }, []);

  const commitTitle = useCallback((title: string) => {
    setHistory((prev) => {
      const nextPresent = { ...prev.present, title };
      if (snapshotEq(prev.present, nextPresent)) return prev;
      const newPast = [...prev.past, prev.present];
      if (newPast.length > MAX_HISTORY) {
        newPast.splice(1, 1);
      }
      return {
        past: newPast,
        present: nextPresent,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      return {
        past: prev.past.slice(0, -1),
        present: previous,
        future: [prev.present, ...prev.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      return {
        past: [...prev.past, prev.present],
        present: next,
        future: prev.future.slice(1),
      };
    });
  }, []);

  return {
    score: history.present.score,
    title: history.present.title,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    setScore,
    setTitle,
    commitScore,
    commitTitle,
    undo,
    redo,
  };
}
