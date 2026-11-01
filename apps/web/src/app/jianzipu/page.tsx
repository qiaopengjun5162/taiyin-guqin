import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "减字谱 · 太音科普 | 古琴减字谱",
  description: "什么是古琴减字谱？唐末曹柔创立，由文字谱演化，只记演奏法与音高、不记节奏；一个减字如何拆读，以及太音如何把它数字化。",
};

const INTRO: string[] = [
  "减字谱，又称古琴指法谱，是以记写指位与左右手演奏技法为特征的记谱法。",
  "它将古琴文字谱中的指法、术语，截取其较具特点的部分组合而成，故名「减字谱」。",
  "减字谱由唐末琴家曹柔创立，由文字谱演化而来；只记录演奏法与音高，不记录音名、节奏，特点是「字简而义尽，文约而音赅」。",
  "它是对文字谱记谱法的一次重大改革，沿用千年而未被取代。",
];

const GLYPHS: { label: string; pos: string; meaning: string }[] = [
  { label: "夕", pos: "左上角", meaning: "左手无名指" },
  { label: "大", pos: "左上角", meaning: "左手大指" },
  { label: "中", pos: "左上角", meaning: "左手中指" },
  { label: "亻", pos: "左上角", meaning: "左手食指" },
  { label: "足", pos: "左上角", meaning: "跪指（无名指卷曲）" },
  { label: "徽位", pos: "右上角", meaning: "十三徽及徽分（标明按弦位置）" },
  { label: "乚", pos: "旁部", meaning: "右手指法：食指「挑」" },
  { label: "勹", pos: "旁部", meaning: "右手指法：中指「勾」" },
  { label: "大写数字", pos: "下半部", meaning: "弦数（七弦，写几即第几弦）" },
];

export default function JianzipuPage() {
  return (
    <main className="flex flex-col items-center min-h-dvh py-10 px-4">
      {/* ── 品牌：朱砂印章 ── */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full border-[3px] border-[var(--vermillion)]/50 shadow-xl shadow-[var(--vermillion)]/5">
          <span
            className="text-2xl font-black tracking-[0.1em] text-[var(--vermillion)]/85 select-none ink-bleed font-calligraphy"
          >
            减字谱
          </span>
        </div>
        <div className="text-center">
          <h1
            className="text-sm font-bold tracking-[0.4em] text-amber-100/80 leading-relaxed"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            古琴 · 指法谱 · 科普
          </h1>
          <p className="mt-1 text-[10px] tracking-[0.25em] text-amber-600/40">
            字简而义尽 · 文约而音赅
          </p>
        </div>
      </div>

      {/* ── 什么是减字谱 ── */}
      <section className="mt-8 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            什么是减字谱
          </p>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            {INTRO.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* ── 一个减字怎么读 ── */}
      <section className="mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            一个减字怎么读
          </p>
          <p className="mb-4 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            以谱字「名十勾五」为例：左手无名指按五弦十徽，同时右手中指勾五弦得音。一个减字，可拆为上、下两部分来读——
          </p>
          <div className="space-y-2">
            {GLYPHS.map((g, i) => (
              <div
                key={i}
                className="flex items-baseline gap-3 text-[12px] leading-[1.8] text-[var(--ink-light)]"
              >
                <span className="shrink-0 w-14 text-center text-[var(--vermillion)] font-bold font-calligraphy">
                  {g.label}
                </span>
                <span className="shrink-0 w-12 text-[10px] tracking-wider text-amber-700/60">
                  {g.pos}
                </span>
                <span className="flex-1">{g.meaning}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 减字谱 × 太音 ── */}
      <section className="mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            减字谱 × 太音
          </p>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            <p>
              减字谱把「怎么弹」凝成一个方块字，是古琴传承千年的「规范」——恰如《乐论》所言「先王立乐之术」。
            </p>
            <p>
              但一个减字由十几个部件拼成，手写、录入门槛都不低。太音做的，是把这套拆字逻辑反过来：你选音色（散 / 泛 / 按）、点指法、点弦徽，编辑器实时拼出规范减字，并播放对应声音。
            </p>
            <p>
              学谱、记谱、演奏三步合一，让「字简而义尽」的千年智慧，在浏览器里活起来。
            </p>
          </div>
        </div>
      </section>

      {/* ── 页脚：返回编辑器 ── */}
      <div className="no-print mt-8 flex flex-col items-center gap-2">
        <Link
          href="/yuelun"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          乐论 · 《荀子》读书
        </Link>
        <Link
          href="/"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          ← 回到减字谱编辑器
        </Link>
      </div>
    </main>
  );
}
