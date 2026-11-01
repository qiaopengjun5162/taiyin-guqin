import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "乐论 · 太音读书 | 古琴减字谱",
  description: "《荀子·乐论篇》读书笔记：音乐是人性自然流露，需雅乐之规范；减字谱正是古琴演奏的「规范化、制度化」。",
};

const ORIGINAL_PASSAGES: string[] = [
  "夫乐者，乐也，人情之所必不免也。故人不能无乐，乐则必发于声音，形于动静；而人之道，声音动静，性术之变尽是矣。故人不能不乐，乐则不能无形，形而不为道，则不能无乱。先王恶其乱也，故制雅颂之声以道之，使其声足以乐而不流，使其文足以辨而不諰，使其曲直、繁省、廉肉、节奏足以感动人之善心，使夫邪污之气无由得接焉。是先王立乐之方也，而墨子非之奈何！",
  "故乐在宗庙之中，君臣上下同听之，则莫不和敬；闺门之内，父子兄弟同听之，则莫不和亲；乡里族长之中，长少同听之，则莫不和顺。故乐者审一以定和者也，比物以饰节者也，合奏以成文者也；足以率一道，足以治万变。是先王立乐之术也，而墨子非之奈何！",
];

const PARAPHRASE: string[] = [
  "音乐是人的本性的自然流露。人心的喜怒哀乐，都要靠声音、行为表达出来。音乐，就是这些表达的规范化、制度化之一。",
  "如果音乐没有规范，人们就会肆意手舞足蹈、放浪形骸，就会混乱不堪。",
  "圣人根据人心表达的需要，制作雅乐、颂声的规范。这样的话，让人们表达情绪的音乐不会混乱，抒发感情的歌谣不会诋毁影射；",
  "音乐的缓急、长短、轻、重、锐、沉，都能感动人心、引导心智，避免邪佞心性的出现。",
  "这就是圣人规范音乐的道理——墨夫子（墨子）不必否定啊！",
];

export default function YuelunPage() {
  return (
    <main className="flex flex-col items-center min-h-dvh py-10 px-4">
      {/* ── 品牌：朱砂印章 ── */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full border-[3px] border-[var(--vermillion)]/50 shadow-xl shadow-[var(--vermillion)]/5">
          <span
            className="text-3xl font-black tracking-[0.25em] text-[var(--vermillion)]/85 select-none ink-bleed font-calligraphy"
          >
            乐论
          </span>
        </div>
        <div className="text-center">
          <h1
            className="text-sm font-bold tracking-[0.4em] text-amber-100/80 leading-relaxed"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            《荀子 · 乐论篇》读书
          </h1>
          <p className="mt-1 text-[10px] tracking-[0.25em] text-amber-600/40">
            太音 · 先王立乐之术
          </p>
        </div>
      </div>

      {/* ── 原文（宣纸卡） ── */}
      <section className="mt-8 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            原 文
          </p>
          <div className="space-y-4 text-[13px] leading-[2] text-[var(--ink)]" style={{ fontFamily: "var(--font-serif)" }}>
            {ORIGINAL_PASSAGES.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <p className="mt-4 text-[10px] tracking-wider text-amber-700/50">
            ——《荀子·乐论篇第二十》，自「夫乐者，乐也」至「是先王立乐之术也」
          </p>
        </div>
      </section>

      {/* ── 现代释义 ── */}
      <section className="mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            释 义
          </p>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            {PARAPHRASE.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* ── 乐论 × 太音 ── */}
      <section className="mt-4 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            乐论 × 太音
          </p>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            <p>
              《荀子》说「先王恶其乱也，故制雅颂之声以道之」——音乐需要规范，否则人们便「放浪形骸、混乱不堪」。
            </p>
            <p>
              减字谱（指法谱字）正是古琴演奏的「规范化、制度化」：它把右手八法、左手吟猱绰注、散泛按音，凝成一套可书写、可传承的符号系统。
            </p>
            <p>
              没有减字谱，琴曲只能口传心授，必致「放浪形骸、混乱不堪」；有了它，缓急、轻重、虚实才有章法，才能「感动人之善心」。
            </p>
            <p>
              太音这个编辑器，做的正是把这套「先王立乐之术」数字化——让你在浏览器里，逐字拼出规范，弹出可以听见的声音。
            </p>
          </div>
        </div>
      </section>

      {/* ── 页脚：返回编辑器 ── */}
      <Link
        href="/"
        className="no-print mt-8 text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
      >
        ← 回到减字谱编辑器
      </Link>
    </main>
  );
}
