"use client";

import { useState, useSyncExternalStore } from "react";
import { useWasmInit } from "@/lib/taiyin-wasm";
import { getServerTuning, getTuning, getTuningById, subscribeTuning } from "@/lib/tuning";
import { SingleNoteMode } from "./jianpu-translator/single-note-mode";
import { SequenceMode } from "./jianpu-translator/sequence-mode";
import {
  TUNING_OPTIONS,
  TUNING_TO_ID,
  isArrangementTuning,
  tuningFromId,
  type InputMode,
  type Tuning,
  type JianpuTranslatorProps,
} from "./jianpu-translator/types";

export function JianpuTranslator({ onSelect }: JianpuTranslatorProps) {
  const [mode, setMode] = useState<InputMode>("single");
  // 默认跟随当前曲谱的定弦：在工具栏选了慢角调，这里还按正调算，
  // 算出来的三弦会差半音——谱字看着对，弹出来是另一个音。
  const [override, setOverride] = useState<Tuning | null>(null);
  const scoreTuning = useSyncExternalStore(subscribeTuning, getTuning, getServerTuning);
  const tuning = override ?? tuningFromId(scoreTuning);
  const { state: wasmState, error: wasmError } = useWasmInit();

  const wasmReady = wasmState === "ready";
  // 编排按这里的调式出候选，试听也按它；但候选放回曲谱后，播放走的是
  // 曲谱自己的定弦。两者不一致必须说破——尤其是那三种没有编排调式的外调。
  const scoreTuningName = getTuningById(scoreTuning).name;
  const arrangementName = TUNING_OPTIONS.find((t) => t.value === tuning)?.label ?? tuning;
  const tuningMismatch = TUNING_TO_ID[tuning] !== scoreTuning;
  const unsupportedScoreTuning = !isArrangementTuning(scoreTuning);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {[
          { key: "single", label: "单音" },
          { key: "sequence", label: "序列" },
        ].map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key as InputMode)}
            className={`px-2 py-0.5 text-[10px] tracking-wider rounded border transition-colors ${
              mode === m.key
                ? "border-amber-700/60 bg-amber-100 text-amber-900"
                : "border-amber-700/20 text-stone-500 hover:text-stone-700"
            }`}
          >
            {m.label}
          </button>
        ))}
        <select
          value={tuning}
          onChange={(e) => setOverride(e.target.value as Tuning)}
          className="ml-auto px-2 py-0.5 text-[10px] tracking-wider rounded border border-amber-700/20 bg-transparent text-stone-700 outline-none"
        >
          {TUNING_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {tuningMismatch && (
        <p
          role="status"
          className="rounded border border-amber-700/30 bg-amber-50 px-2 py-1 text-[10px] leading-relaxed tracking-wider text-amber-900"
        >
          {unsupportedScoreTuning
            ? `当前曲谱定弦「${scoreTuningName}」没有对应的编排调式（编排只支持正调 / 蕤宾 / 慢角）。这里按「${arrangementName}」出候选，放回曲谱后却会按「${scoreTuningName}」发声，弹出来会差半音；建议先把上方定弦切回这三种之一。`
            : `当前曲谱定弦「${scoreTuningName}」与这里的编排调式「${arrangementName}」不一致：候选试听按编排调式，放回曲谱后按曲谱定弦发声。`}
        </p>
      )}
      {wasmState === "loading" && (
        <p className="text-[10px] tracking-wider text-stone-500">
          减字引擎加载中…
        </p>
      )}
      {wasmState === "error" && (
        <p className="text-[10px] tracking-wider text-red-400/80">
          引擎加载失败：{wasmError?.message ?? "未知错误"}，请刷新页面重试
        </p>
      )}
      {mode === "single" ? (
        <SingleNoteMode tuning={tuning} onSelect={onSelect} disabled={!wasmReady} />
      ) : (
        <SequenceMode tuning={tuning} onSelect={onSelect} disabled={!wasmReady} />
      )}
    </div>
  );
}
