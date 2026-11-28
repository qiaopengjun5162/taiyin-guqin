"use client";

/**
 * 单功能页的统一外壳：品牌顶栏 + 功能导航 + 一张内容卡 + 页脚。
 *
 * 2026-11-28 改版：以前所有工具都挤在主页右栏的五个折叠面板里，
 * 用户看到的是「一个页面上有十二件事」。现在一件功能一个页面，
 * 这里给出共同的框架，让用户在页与页之间不会迷路。
 *
 * 注意：这是**页面导航**，不是主页那块页内锚点导航（SectionNav 仍在
 * page-chrome.tsx）。两者职责不同，别合并。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BackToTop } from "./page-chrome";

const NAV_GROUPS = [
  {
    label: "打 谱",
    items: [
      { href: "/", label: "打谱工作台" },
      { href: "/translate", label: "简谱转减字" },
      { href: "/recognize", label: "图片识别" },
    ],
  },
  {
    label: "练 琴",
    items: [
      { href: "/qin-board", label: "琴面音位" },
      { href: "/tuner", label: "调音定弦" },
      { href: "/practice-audio", label: "跟录音练" },
      { href: "/recorder", label: "录音回听" },
      { href: "/practice-log", label: "练琴日志" },
    ],
  },
  {
    label: "查 与 学",
    items: [
      { href: "/zidian", label: "减字字典" },
      { href: "/jianzipu", label: "减字谱科普" },
      { href: "/yuelun", label: "乐论" },
      { href: "/settings", label: "设置" },
    ],
  },
] as const;

export function FeatureNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="功能导航" className="no-print mt-3 w-full rounded-lg border border-amber-700/25 bg-[#211f1c] px-3 py-2.5 shadow-lg shadow-black/30">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex items-center gap-2">
            <span className="shrink-0 text-[10px] tracking-[0.15em] text-amber-200/45">
              {group.label}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`min-h-[28px] rounded px-2 py-1 text-[11px] tracking-wider transition-colors ${
                      active
                        ? "border border-amber-600/60 bg-amber-800/30 text-amber-100"
                        : "border border-transparent text-amber-200/65 hover:border-amber-700/40 hover:text-amber-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function FeatureShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col items-center gap-4 px-4 py-4">
      <header className="ty-hero mt-2 flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="ty-seal font-calligraphy">太音</div>
          <div className="min-w-0 leading-tight">
            <p className="ty-title">太音 · 古琴打谱</p>
            <p className="ty-subtitle">把看不懂的老谱，变成能弹的曲子</p>
          </div>
        </div>
        <div className="ty-ai-badge shrink-0 whitespace-nowrap" title="打开网页就能用，不用装任何软件">
          <span className="ty-ai-dot" />
          免安装
        </div>
      </header>
      <FeatureNav />
      <main id="main-content" tabIndex={-1} className="mt-4 w-full max-w-4xl pb-10">
        <section className="ty-panel rounded-lg bg-[var(--paper)]">
          <div className="ty-panel-accent" />
          <div className="p-5 sm:p-6">
            <p className="ty-section-sub">太音 · 单功能页</p>
            <h1 className="mt-1 font-serif text-xl font-bold tracking-wider text-[var(--ink)]">
              {title}
            </h1>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-light)]">
              {description}
            </p>
            <div className="mt-5">{children}</div>
          </div>
        </section>
      </main>
      <footer className="no-print mb-8 flex w-full max-w-4xl flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[11px] tracking-wider text-amber-200/45">
        <Link href="/" className="underline underline-offset-2 hover:text-amber-100">
          回打谱工作台
        </Link>
        <a
          href="https://www.wjjzp.com/jzpWeb/index.html"
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 hover:text-amber-100"
        >
          减字谱字形：忘机减字谱楷体（OFL 1.1）
        </a>
      </footer>
      <BackToTop />
    </div>
  );
}
