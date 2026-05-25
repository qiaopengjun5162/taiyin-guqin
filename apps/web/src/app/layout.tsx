import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Serif_SC, Ma_Shan_Zheng } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSerifSC = Noto_Serif_SC({
  weight: ["200", "300", "400", "700", "900"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const maShanZheng = Ma_Shan_Zheng({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-calligraphy",
  display: "swap",
});

export const metadata: Metadata = {
  title: "太音 · 古琴AI传习平台",
  description: "古琴减字谱输入法 | AI 简谱翻译 | 琴友社区 — 用科技复活非遗文化",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSerifSC.variable} ${maShanZheng.variable} h-full antialiased`}
    >
      <body className="min-h-dvh flex flex-col">
        {/* 墨迹晕染 SVG 滤镜（全局不可见，供 ink-bleed 类引用） */}
        <svg xmlns="http://www.w3.org/2000/svg" className="hidden" aria-hidden>
          <filter id="inkbleed">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.03"
              numOctaves="3"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="1.5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </svg>
        {children}
      </body>
    </html>
  );
}
