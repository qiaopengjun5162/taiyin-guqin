import type { Metadata } from "next";
import Link from "next/link";
import { JianziDictionary } from "@/components/jianzi-dictionary";
import { JianziFrequencyPanel } from "@/components/jianzi-frequency-panel";

export const metadata: Metadata = {
  title: "减字字典 · 太音字全表 | 古琴减字谱",
  description: "减字谱结构化目录：把每个减字拆开给人看——字形、人话读法、音高提示，可按音色 / 指法 / 弦序检索并试听。",
};

export default function ZidianPage() {
  return (
    <main className="flex flex-col items-center min-h-dvh py-10 px-4">
      {/* ── 品牌：朱砂印章 ── */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full border-[3px] border-[var(--vermillion)]/50 shadow-xl shadow-[var(--vermillion)]/5">
          <span
            className="text-2xl font-black tracking-[0.1em] text-[var(--vermillion)]/85 select-none ink-bleed font-calligraphy"
          >
            字全表
          </span>
        </div>
        <div className="text-center">
          <h1
            className="text-sm font-bold tracking-[0.4em] text-amber-100/80 leading-relaxed"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            古琴 · 减字谱 · 字典
          </h1>
          <p className="mt-1 text-[10px] tracking-[0.25em] text-amber-600/40">
            字简而义尽 · 一文一指法
          </p>
        </div>
      </div>

      {/* ── 为什么要这份字全表 ── */}
      <section className="mt-8 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            为什么要一份减字字典
          </p>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            <p>
              减字谱诞生千年，至今未纳入 Unicode 编码，录入仍靠手写或复制图片。要把它数字化，第一步是摸清「到底有多少个减字、每个字由哪些部件拼成、有哪些写法变体」。
            </p>
            <p>
              太音不另造字——减字由「音色 + 左手 + 徽位 + 右手 + 弦序」五个部件拼成。下面这份字全表，就是把常用减字逐个拆开：左边看字形，右边读人话，点一下还能听。
            </p>
            <p>
              每张卡片底部那串字母数字（如 <span className="font-mono text-[11px] text-amber-800/70">ad9g4</span>）是
              <strong className="font-semibold text-[var(--ink)]">减字码</strong>：按「音色 + 左手 + 徽位 + 右手 + 弦序」排出来，
              和连打输入框里的打法完全一致。照着敲就能把字打出来，拿它当搜索词也能直接查到字。
            </p>
            <p className="text-amber-700/50">
              注：减字谱尚无统一 Unicode，下表为常用减字参考，并非穷尽全部历史变体。
            </p>
          </div>
        </div>
      </section>

      {/* ── 字典本体 ── */}
      <section className="mt-4 w-full max-w-md">
        <JianziDictionary />
      </section>

      {/* ── 量化分析：字频 + 变体 ── */}
      <section className="mt-8 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <p className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            量化分析 · 字频与变体
          </p>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            <p>
              有了结构化字全表，就能再往前走一步：统计一首曲子里哪些减字用得最多、各占多少；同一指法在不同抄本里有几种写法（名/夕、食/亻、勾/勹、挑/乚……）。
            </p>
            <p className="text-amber-700/50">
              统计前先按规范字形把不同写法合并，再计数——这正是「系统自动合并所有标注」。字频与归并都在 Rust 引擎里算。
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 w-full max-w-md">
        <JianziFrequencyPanel />
      </section>

      {/* ── 页脚 ── */}
      <div className="mt-8 flex flex-col items-center gap-2">
        <Link
          href="/"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          ← 回到减字谱编辑器
        </Link>
        <Link
          href="/jianzipu"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          减字谱 · 科普
        </Link>
        <Link
          href="/yuelun"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          乐论 · 《荀子》读书
        </Link>
      </div>
    </main>
  );
}
