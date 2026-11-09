"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { JianziState } from "@/lib/types";
import { parseJianziText } from "@/lib/jianzi";
import { SvgJianziBlock } from "@/components/svg-jianzi-block";
import { recognizeJianzi, isBrowserOnlyMode } from "@/lib/api";
import {
  loadTemplateIndex,
  recognizeFile,
  type TemplateMatch,
} from "@/lib/jianzi-template";
import { schedulePluck } from "@/lib/audio-synth";
import { jianziToFrequency, jianziToJianpu } from "@/lib/jianzi-pitch";
import { usePitchContext } from "@/lib/use-pitch-context";
import { getTuningById } from "@/lib/tuning";

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

/** 模板索引的静态地址：随 basePath 变化，用文档基准 URL 解析最稳。 */
function templateIndexUrl(): string {
  return new URL("data/template_index.json", document.baseURI).toString();
}

/**
 * 纯前端识别：模板索引懒加载 → 归一化 → 最近邻。
 *
 * 线上是静态托管，没有后端可调；但模板匹配本来就是确定性算术，
 * 完全可以在浏览器里跑，识别因此不再依赖服务器。
 */
async function recognizeInBrowser(f: File): Promise<TemplateMatch> {
  const index = await loadTemplateIndex(templateIndexUrl());
  const match = await recognizeFile(index, f);
  if (!match) throw new Error("图片里没有找到墨迹，换一张更清晰的减字图试试");
  return match;
}

/** 该模式在页面生命周期内不变，无需通知。 */
const subscribeNoop = () => () => {};

/**
 * 匹配度低于此值就明确告警：`confidence = margin/(distance+margin)`，
 * top-2 距离接近时趋于 0 —— 也就是算法自己都分不清是哪一个。
 * 这类结果宁可不给，也不能当答案摆着。
 */
const LOW_CONFIDENCE = 0.2;

/**
 * 减字谱识别面板（⚠️ 能力受限，见下）。
 *
 * 上传一张减字谱图像 → 匹配为规范减字文本 →
 * 前端用既有 `parseJianziText` 解析为可视化状态并渲染 → 可点听。
 *
 * ⚠️ 2026-11-09 判定：模板索引 257 模板 / 385 文本里 **0 条标准完整减字**
 * （「大九勾四」= 左指 + 徽 + 右指法 + 弦），全是字体 GSUB 预烘焙的复合指法
 * 符号（勾剔 / 抹勾 / 间勾…）。内置曲 27 个真实减字跑覆盖率 0/27 —— 连编辑器
 * 自己产出的谱字都认不出。**旧注释称「大九勾四这类整字都在」是错的，已更正。**
 * 全文见 docs/articles/material/2026-11-09-真谱适用性判定-识别结构性失效.md。
 *
 * 两条路径都不产出可靠的完整减字：
 * - 静态站点（线上）：浏览器内模板匹配用上述索引，且 `matchPixels` 无拒识门槛
 *   （白纸 / 噪点也会硬返回一个减字），结果**必须逐格人工校正**；
 * - 有后端：`RECOGNIZE_MODE=auto` 走「模板优先 + LLM 兜底」，模板分支用同一份
 *   索引；LLM 分支 42 条评测 exact 0%，无 key 时又用模板结果兜底、绕过置信度门槛。
 *
 * 拍照、手写、扫描件的光照与笔画粘连另有一层噪声问题，同样不适用。
 *
 * 试听按识别出的减字经 `jianziToFrequency` 精确推算（含当前定弦与基准音），
 * 用的是同一个反推入口，不另做近似；拼不成谱字时按钮置灰并说明原因。
 */
export function JianziRecognizer() {
  // 反推音高依赖当前定弦与基准音：蕤宾调五弦、慢角调三弦各差一个半音
  const { tuning, concertPitch } = usePitchContext();
  const tuningName = getTuningById(tuning).name;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [glyph, setGlyph] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [method, setMethod] = useState<"llm" | "unavailable" | "template" | null>(
    null,
  );
  const [state, setState] = useState<JianziState | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 静态站点无后端时走本机匹配（能力只到部件一级），文案要跟着变。
  // 服务端快照固定 false，避免水合不一致。
  const browserOnly = useSyncExternalStore(subscribeNoop, isBrowserOnlyMode, () => false);

  async function handleFile(f: File) {
    setError(null);
    setGlyph(null);
    setExplanation(null);
    setConfidence(null);
    setEdit(null);
    setMethod(null);
    setState(null);
    setLoading(true);
    try {
      if (browserOnly) {
        const match = await recognizeInBrowser(f);
        setGlyph(match.text);
        setConfidence(match.confidence);
        setMethod("template");
        setExplanation(
          `本机模板匹配（无需后端）：命中 ${match.name}，距离 ${match.distance.toFixed(0)}`,
        );
        setState(parseJianziText(match.text));
        return;
      }
      const base64 = await fileToBase64(f);
      const mediaType = f.type || "image/jpeg";
      const resp = await recognizeJianzi(base64, mediaType);
      setGlyph(resp.glyph);
      setExplanation(resp.explanation);
      setConfidence(resp.confidence);
      setMethod(resp.method ?? null);
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

  // 试听判据只算一次：按钮 disabled、音高说明、合成共用，免得出现
  // 「按钮能点、下面却写着算不出音高」的自相矛盾。
  const previewFreq = state
    ? jianziToFrequency(state, { tuning, concertPitch })
    : null;
  const previewJianpu = state
    ? jianziToJianpu(state, { tuning, concertPitch })
    : null;
  const canListen = previewFreq != null && previewJianpu != null;
  // 当前真正展示的字（校正优先）。校正框清空时不该还留着试听按钮。
  const currentText = (edit ?? glyph ?? "").trim();

  function handlePlay() {
    if (!state || previewFreq == null) return;
    const ctx = ctxRef.current ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const tone = state.toneType === "散" ? "散" : state.toneType === "泛" ? "泛" : "按";
    schedulePluck(ctx, previewFreq, ctx.currentTime + 0.05, 1.2, tone);
  }

  // 校正：用户直接改字（含 AI 漏识补录），实时重解析并反推音高
  function handleEdit(value: string) {
    setEdit(value);
    setState(value.trim() ? parseJianziText(value) : null);
  }

  return (
    <div className="p-3 rounded border border-amber-700/20 bg-amber-900/10">
      <p className="mb-2 text-[10px] tracking-wider text-amber-600/60">
        {browserOnly ? "减字谱识别（本机模板匹配）" : "减字谱单字识别（后端模型）"}
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
        <p className="text-[10px] leading-relaxed tracking-wider text-amber-800/70">
          {browserOnly
            ? "本机模板匹配目前只覆盖复合指法符号，标准完整减字（如「大九勾四」）尚不能识别；拍照、手写、扫描件暂不支持，请用「连打」录入"
            : "传一张减字图；电子谱面/清晰扫描件最准（标准完整减字目前尚不能识别，结果请校正）"}
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
                // 识别成功但拼不成完整演奏谱字（如「大指」「四弦」这类部件）时，
                // 显示识别出的原文，别让用户误以为没识别出来
                <span className="text-[13px] text-stone-700">
                  {edit === null && glyph ? glyph : "未识别"}
                </span>
              )}
            </div>
            {currentText !== "" && (
              <button
                onClick={handlePlay}
                disabled={!canListen}
                title={canListen ? "试听（按减字精确推算音高）" : "信息不全，暂不能试听"}
                className="px-2 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-400 hover:text-stone-200 hover:border-amber-600/50 disabled:opacity-40 transition-all"
              >
                试听
              </button>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {glyph && (
              <label className="block mb-1 text-[10px] tracking-wider text-amber-700/50">
                {edit === null ? "识别为（可校正）" : "减字（已校正）"}
              </label>
            )}
            {glyph && (
              <input
                aria-label="减字校正框"
                value={edit ?? glyph}
                onChange={(e) => handleEdit(e.target.value)}
                placeholder="如：大九勾四"
                className="w-full px-2 py-1 text-[11px] tracking-wider rounded border border-amber-700/30 bg-black/20 text-amber-100/90 focus:outline-none focus:border-amber-500/50"
              />
            )}
            {edit !== null && glyph != null && (
              <p className="mt-0.5 text-[10px] tracking-wider text-amber-500/60">
                已校正（原：{glyph}）
              </p>
            )}
            {confidence !== null && edit === null && (
              <p className="mt-0.5 text-[10px] tracking-wider text-amber-700/50">
                置信度：{(confidence * 100).toFixed(0)}%
                {method === "template" && " · 本机模板匹配"}
                {method === "llm" && " · 后端模型"}
              </p>
            )}
            {confidence !== null && confidence < LOW_CONFIDENCE && edit === null && (
              <p
                role="alert"
                className="mt-1 rounded border border-red-600/40 bg-red-500/10 px-2 py-1 text-[10px] leading-relaxed text-red-800"
              >
                匹配度低：候选之间几乎分不开，这个结果很可能不对。请直接改正，
                或改用「连打」自己录——别拿它当答案。
              </p>
            )}
            {explanation && (
              <p className="mt-1 text-[10px] leading-relaxed text-amber-700/60">
                {explanation}
              </p>
            )}
            {currentText !== "" && !state && (
              <p className="mt-1 text-[10px] leading-relaxed tracking-wider text-amber-700/40">
                暂无法推算音高（这个字还拼不成可弹的谱字，请在上方补全弦序、徽位）
              </p>
            )}
            {state && !canListen && (
              <p className="mt-1 text-[10px] tracking-wider text-amber-700/40">
                暂无法推算音高（按/泛音需给出徽位）
              </p>
            )}
            {state && canListen && (
              <p className="mt-1 text-[10px] tracking-wider text-amber-700/40">
                试听为「{state.stringNumber}弦」{state.toneType}音 · 约简谱 {previewJianpu.number}{previewJianpu.octave}（{previewFreq.toFixed(1)}Hz · {tuningName}推定）
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
