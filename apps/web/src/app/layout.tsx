import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Serif_SC, Ma_Shan_Zheng } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
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

/**
 * 站点部署根（构建期内联）。下面多处要用，提前声明避免顺序陷阱。
 * - GitHub Pages：`/taiyin-guqin`
 * - Vercel / 根部署：`""`
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "太音 · 古琴AI传习平台",
  description: "古琴减字谱输入法 | AI 简谱翻译 | 琴友社区 — 用科技复活非遗文化",
  applicationName: "太音",
  // iOS「添加到主屏」读的是 apple-mobile-web-app-* 这组标签，
  // 不加的话从主屏打开会带上 Safari 地址栏，不像 App。
  appleWebApp: {
    capable: true,
    title: "太音",
    statusBarStyle: "default",
  },
  // Next 16 只输出标准化的 `mobile-web-app-capable`；iOS 15.4 以前不认 manifest 的
  // display:standalone，只认这个带 apple- 前缀的老名字。补一份，老机器从主屏打开
  // 才不会带 Safari 地址栏。
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: `${BASE_PATH}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${BASE_PATH}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: `${BASE_PATH}/icons/apple-touch-icon.png`,
  },
};

export const viewport: Viewport = {
  // 与 manifest 的 theme_color、图标底色一致：状态栏和图标不会两个颜色
  themeColor: "#1c1b1a",
  colorScheme: "light",
};

/**
 * 减字谱字体按部署路径注入。
 *
 * 字体在 `public/fonts/` 下，路径必须是 `/fonts/...`（根部署）或
 * `/taiyin-guqin/fonts/...`（GitHub Pages 子路径）。写死在 globals.css 里
 * 只能对一半：Vercel 上会请求到不存在的子路径，被 SPA rewrites 兜成
 * 200 的 HTML，浏览器解析失败后静默回退系统字体——减字谱整片退化成
 * 「散挑二」这类汉字，看起来"能用"但其实核心渲染失效。
 *
 * `NEXT_PUBLIC_BASE_PATH` 由 next.config.ts 的 `env` 在构建期内联，
 * 与 basePath / assetPrefix 同源，三处不会走偏。
 */
/**
 * 字体族名用**原名**而不是自取别名。
 *
 * 这个字体是第三方开源作品（忘机减字谱楷体，OFL 1.1），本站只是使用者。
 * 曾经把它改名成「TaiYinJianZiPuKaiTi」并抹掉版权字段分发，等于把别人的
 * 署名换成自己的——既违反 OFL，也让「字是谁做的」在开发者工具里消失。
 * 现在原样分发官方文件，族名照抄，署名在页脚与 public/fonts/README.md。
 */
const JIANZI_FONT_CSS = `@font-face{font-family:"WangJiJianZiPuKaiTi";src:url("${BASE_PATH}/fonts/WangJiJianZiPuKaiTi.ttf") format("truetype");font-weight:normal;font-style:normal;font-display:swap}`;

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
      <head>
        {/* 减字谱楷体：路径随部署根变化，见 JIANZI_FONT_CSS 注释 */}
        <style dangerouslySetInnerHTML={{ __html: JIANZI_FONT_CSS }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        {/* 只负责注册 Service Worker，不渲染任何内容（见 components/pwa-register.tsx） */}
        <PwaRegister />
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
