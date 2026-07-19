"use client";

import { useState } from "react";
import type { NoteColumn } from "@/lib/types";
import { useWasmInit } from "@/lib/taiyin-wasm";
import { SingleNoteMode } from "./jianpu-translator/single-note-mode";
import { SequenceMode } from "./jianpu-translator/sequence-mode";
import {
  TUNING_OPTIONS,
  type InputMode,
  type Tuning,
  type JianpuTranslatorProps,
} from "./jianpu-translator/types";

export function JianpuTranslator({ onSelect }: JianpuTranslatorProps) {
  const [mode, setMode] = useState<InputMode>("single");
  const [tuning, setTuning] = useState<Tuning>("zheng");
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
                ? "border-amber-600/50 bg-amber-800/30 text-amber-100"
                : "border-amber-700/20 text-amber-100/50 hover:text-amber-100/70"
            }`}
          >
            {m.label}
          </button>
        ))}
        <select
          value={tuning}
          onChange={(e) => setTuning(e.target.value as Tuning)}
          className="ml-auto px-2 py-0.5 text-[10px] tracking-wider rounded border border-amber-700/20 bg-transparent text-amber-100/70 outline-none"
        >
          {TUNING_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {wasmState === "loading" && (
        <p className="text-[10px] tracking-wider text-amber-600/50">
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
