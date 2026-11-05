import type { NextConfig } from "next";

/**
 * 站点部署路径，可由构建期环境变量 `BASE_PATH` 覆盖：
 * - GitHub Pages 项目页走子路径 `/taiyin-guqin`（默认值，CI 里显式传入）；
 * - Vercel / Netlify 部署到根路径时，把 `BASE_PATH` 设为空串即可。
 * 一处定义、三处引用：路由前缀、静态资源前缀、运行时读取的 WASM 路径。
 */
const BASE_PATH = process.env.BASE_PATH ?? "/taiyin-guqin";

const nextConfig: NextConfig = {
  // 静态导出：前端是客户端重应用，WASM + AudioContext 均在浏览器运行，
  // 无需 Next.js SSR。产物可直接部署到 CDN/nginx。
  output: "export",
  // 产物目录按模式分流：build 出静态包到 dist（GitHub Pages 直接用这个目录），
  // dev 走默认的 .next。两边共用同一个 distDir 时，一次 next build 会把正在
  // 运行的 dev server 的 dist/dev 一起清掉，dev 当场 500（实测踩过）。
  distDir: process.env.NODE_ENV === "development" ? ".next" : "dist",
  basePath: BASE_PATH,
  // 开发时的悬浮角标会压在宣纸卡片文字上，本地调试时关掉
  devIndicators: false,
  assetPrefix: BASE_PATH,
  env: {
    // 运行时拼 WASM 的绝对路径用。原先写的是相对路径 "wasm/xxx.wasm"，
    // 在 dev 下页面地址是 /taiyin-guqin（无尾斜杠），相对路径会解析成 /wasm/xxx.wasm
    // → 404、WASM 起不来。生产因为地址带尾斜杠才碰巧正确。
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
  images: {
    unoptimized: true,
  },
  // Next 16 默认把 dev 资源当作跨源请求拦截（localhost 与 127.0.0.1 算两个源）。
  // 不放开的话，用 127.0.0.1:3000 打开时页面能出静态壳，但交互全部失灵——
  // HMR/运行时资源被挡，看起来像「按钮点了没反应」。仅影响开发模式。
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
