"use client";

import { useRef, useState } from "react";
import type { JianziState } from "@/lib/types";
import { parseJianziText } from "@/lib/jianzi";
import { SvgJianziBlock } from "@/components/svg-jianzi-block";
import { recognizeJianzi } from "@/lib/api";
import { schedulePluck } from "@/lib/audio-synth";
import { jianziToFrequency, jianziToJianpu } from "@/lib/jianzi-pitch";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 减字谱单字图像识别面板（对标 udywang「琴与人的交互 1 号」）。
 *
 * 上传/拍照一张减字谱单字 → 后端 Claude 多模态识别为规范减字文本 →
 * 前端用既有 `parseJianziText` 解析为可视化状态并渲染 → 可点听。
 *
 * 试听采用「正调七弦空弦音 + 识别音色」近似（徽位精确音高留待后续），
 * 仅用于建立"这个减字听起来是什么弦"的直觉。
 */
export function JianziRecognizer() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [glyph, setGlyph] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [state, setState] = useState<JianziState | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(f: File) {
    setError(null);
    setGlyph(null);
    setExplanation(null);
    setConfidence(null);
    setState(null);
    setLoading(true);
    try {
      const base64 = await fileToBase64(f);
      const mediaType = f.type || "image/jpeg";
      const resp = await recognizeJianzi(base64, mediaType);
      setGlyph(resp.glyph);
      setExplanation(resp.explanation);
      setConfidence(resp.confidence);
      if (resp.glyph) {
        setState(parseJianziText(resp.glyph));
      } else if (resp.method === "unavailable") {
        setError("后端未启用 AI 识别（缺少 ANTHROPIC_API_KEY），无法识别图片。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "识别失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  function handlePlay() {
    if (!state) return;
    const freq = jianziToFrequency(state);
    if (freq == null) return;
    const ctx = ctxRef.current ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const tone = state.toneType === "散" ? "散" : state.toneType === "泛" ? "泛" : "按";
    schedulePluck(ctx, freq, ctx.currentTime + 0.05, 1.2, tone);
  }

  return (
    <div className="p-3 rounded border border-amber-700/20 bg-amber-900/10">
      <p className="mb-2 text-[10px] tracking-wider text-amber-600/60">
        减字谱单字识别（AI 图像识别）
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="px-3 py-1.5 min-h-[40px] text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-400 hover:text-stone-200 hover:border-amber-600/50 disabled:opacity-40 transition-all"
        >
          {loading ? "识别中…" : "上传减字图片"}
        </button>
        <p className="text-[10px] tracking-wider text-amber-700/40">
          拍/传一张减字谱单字（如「大九勾四」）
        </p>
      </div>

      {error && (
        <p className="mt-2 text-[10px] tracking-wider text-red-200/80">{error}</p>
      )}

      {(glyph || state) && (
        <div className="mt-3 flex items-start gap-3">
          {/* 渲染识别出的减字（字体 GSUB 优先，SVG 降级兜底） */}
          <div className="flex flex-col items-center gap-1">
            <div className="w-16 h-20 flex items-center justify-center rounded border border-amber-700/20 bg-[var(--paper)]">
              {state ? (
                <SvgJianziBlock state={state} fontSize="40px" />
              ) : (
                <span className="text-[11px] text-amber-700/50">未识别</span>
              )}
            </div>
            {state && (
              <button
                onClick={handlePlay}
                disabled={jianziToFrequency(state) == null}
                title="试听（按减字精确推算音高）"
                className="px-2 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-400 hover:text-stone-200 hover:border-amber-600/50 disabled:opacity-40 transition-all"
              >
                试听
              </button>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {glyph && (
              <p className="text-[11px] tracking-wider text-amber-100/80">
                识别为：<span className="font-medium">{glyph}</span>
              </p>
            )}
            {confidence !== null && (
              <p className="mt-0.5 text-[10px] tracking-wider text-amber-700/50">
                置信度：{(confidence * 100).toFixed(0)}%
              </p>
            )}
            {explanation && (
              <p className="mt-1 text-[10px] leading-relaxed text-amber-700/60">
                {explanation}
              </p>
            )}
            {state && (() => {
              const jp = jianziToJianpu(state);
              const freq = jianziToFrequency(state);
              if (!jp || freq == null) {
                return (
                  <p className="mt-1 text-[10px] tracking-wider text-amber-700/40">
                    暂无法推算音高（按/泛音需给出徽位）
                  </p>
                );
              }
              return (
                <p className="mt-1 text-[10px] tracking-wider text-amber-700/40">
                  试听为「{state.stringNumber}弦」{state.toneType}音 · 约简谱 {jp.number}{jp.octave}（{freq.toFixed(1)}Hz）
                </p>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
