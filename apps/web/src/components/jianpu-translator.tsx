"use client";

import { useState, useSyncExternalStore } from "react";
import { useWasmInit } from "@/lib/taiyin-wasm";
import { getServerTuning, getTuning, subscribeTuning } from "@/lib/tuning";
import { SingleNoteMode } from "./jianpu-translator/single-note-mode";
import { SequenceMode } from "./jianpu-translator/sequence-mode";
import {
  TUNING_OPTIONS,
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
