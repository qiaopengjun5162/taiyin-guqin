"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * 首页的「页面框架」：跳转链接、品牌顶栏、页内导航、页脚、回到顶部。
 *
 * 这五块彼此位置不连续（跳转链接在 main 之外，其余分散在两栏与末尾），
 * 但都不参与打谱业务，也没有跨块的 state，所以收在一个文件里按位置分别导出。
 * 唯一的 state 是回到顶部的滚动位置，连同监听一起内聚在 BackToTop 里。
 */

/**
 * 键盘用户 Tab 第一下就能跳过顶栏与示例，直接进主内容。
 * 必须放在 main 之外：跳进去之后 Tab 才会继续往内容里走，而不是又回到这条链接。
 * 用 translate 移出视口而不是 sr-only：sr-only 的 not-sr-only 会把 position 重置成
 * static，与 fixed 打架，焦点态会跑位。
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="no-print fixed left-4 top-4 z-[60] -translate-y-24 rounded border border-amber-700/40 bg-[var(--paper)] px-3 py-2 text-[12px] text-[var(--ink)] shadow-lg transition-transform focus:translate-y-0"
    >
      跳到主内容
    </a>
  );
}

/** 品牌：国风科技主视觉顶栏。对外口径改这里要先同步 page.test.tsx 与 docs/pitch.md 档 1。 */
export function SiteHeader() {
  return (
    <header className="ty-hero no-print mt-2 w-full max-w-xl flex items-center justify-between gap-4 px-5 py-3 xl:col-span-2 xl:max-w-none">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="ty-seal font-calligraphy">太音</div>
        <div className="min-w-0 leading-tight">
          {/* 对外口径 = 「古琴打谱」（对仗「AI 释谱」：释谱是看懂，打谱是弹出） */}
          <h1 className="ty-title">太音 · 古琴打谱</h1>
          <p className="ty-subtitle">把看不懂的老谱，变成能弹的曲子</p>
        </div>
      </div>
      {/* 免安装是真卖点；「AI 驱动」是超口径（识别是模板匹配，AI 只做候选择优兜底），已撤下 */}
      <div className="ty-ai-badge shrink-0 whitespace-nowrap" title="打开网页就能用，不用装任何软件">
        <span className="ty-ai-dot" />
        免安装
      </div>
    </header>
  );
}

/** 锚点与右栏面板的 id 一一对应；文案刻意避开测试里的按钮文本正则。 */
const SECTIONS = [
  ["#score-area", "谱面"],
  ["#keyboard-area", "录入减字"],
  ["#sec-console", "演奏控制台"],
  ["#sec-recognizer", "识别减字"],
  ["#sec-board", "琴面音位"],
  ["#sec-tuner", "调音定弦"],
  ["#sec-practice", "跟奏"],
  ["#sec-log", "练琴日志"],
] as const;
const NAV_LINK =
  "inline-block py-1 text-amber-200/70 hover:text-amber-100 transition-colors underline-offset-2 hover:underline";

/**
 * 侧边「本页导航」。
 *
 * ## 为什么不做 sticky（2026-11-18 实拍后改的）
 *
 * 原先写的是 `xl:sticky xl:top-4 xl:z-10` + 半透明底色。实拍结果是：
 * 滚动到右栏中部时，这块导航**浮在「我的署名」面板上**，两段文字叠在一起完全没法读。
 *
 * 只把底色改实也能「盖住」，但那只是把重叠藏起来——导航块依然遮住了下面那块面板的
 * 上半截（用户看到的是「我的署名（可选）」标题被挡掉，只剩后半句）。这不是修好，是换了个症状。
 *
 * 这个侧栏本来就只有八个锚点，页面也不算长；不做 sticky 反而更清楚：
 * 它就在右栏顶部，滚过去就滚过去了，不会挡任何东西。
 * 少一个「永远浮着的小窗」，页面安静很多。
 */
export function SectionNav() {
  return (
    <nav aria-label="本页导航" className="no-print hidden xl:block">
      <div className="rounded-lg border border-amber-700/25 bg-[#211f1c] p-3">
        <p className="ty-section-sub mb-2">本页导航</p>
        <ul className="flex flex-col gap-1 text-[12px]">
          {SECTIONS.map(([href, label]) => (
            <li key={href}>
              <a href={href} className={NAV_LINK}>{label}</a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

const FOOTER_LINKS = [
  ["/yuelun", "乐论 · 《荀子》读书"],
  ["/jianzipu", "减字谱 · 科普"],
  ["/zidian", "减字字典 · 字全表"],
] as const;
const FOOTER_LINK_CLASS =
  "inline-block py-1 text-[11px] tracking-[0.15em] text-amber-200/50 hover:text-amber-100 transition-colors underline underline-offset-2";

export function SiteFooter() {
  return (
    <div className="no-print mt-auto pt-10 flex flex-col items-center gap-2 xl:col-span-2">
      <p className="text-[11px] tracking-[0.15em] text-amber-200/40">
        先选音色，再依次拼出完整减字
      </p>
      {FOOTER_LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={FOOTER_LINK_CLASS}>
          {label}
        </Link>
      ))}
      {/*
       * 字体署名。减字谱字形是这个项目的核心，但那套字形不是我们画的：
       * 是「忘机减字谱楷体」（OFL 1.1）——原样分发，只换引用方式。
       * 署名挂在每个页面都看得见的页脚，而不是塞进源码注释里，
       * 不然「字是谁做的」这件事就只存在于 git 历史中。
       */}
      <a
        href="https://www.wjjzp.com/jzpWeb/index.html"
        target="_blank"
        rel="noreferrer noopener"
        className="inline-block py-1 text-[10px] tracking-[0.15em] text-amber-200/45 hover:text-amber-100 transition-colors underline underline-offset-2"
      >
        减字谱字形：忘机减字谱楷体（OFL 1.1）
      </a>
    </div>
  );
}

/** 页面滚过约一屏后出现；阈值与监听都在这里，主页不再为此持有一份 state。 */
export function BackToTop() {
  const [showBackToTop, setShowBackToTop] = useState(false);
  useEffect(() => {
    function onScroll() {
      setShowBackToTop(window.scrollY > window.innerHeight * 0.8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!showBackToTop) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="回到顶部"
      className="no-print fixed bottom-6 right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-amber-700/40 bg-[#211f1c]/90 text-amber-200/80 shadow-lg shadow-black/40 backdrop-blur transition-colors hover:text-amber-100 hover:border-amber-600/60"
    >
      <span aria-hidden className="text-[16px] leading-none">↑</span>
    </button>
  );
}
