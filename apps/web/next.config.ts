import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静态导出：前端是客户端重应用，WASM + AudioContext 均在浏览器运行，
  // 无需 Next.js SSR。产物可直接部署到 CDN/nginx。
  // basePath 与 GitHub Pages 子目录（/taiyin-guqin/）对齐，避免 CSS/JS 404。
  output: "export",
  distDir: "dist",
  basePath: "/taiyin-guqin",
  assetPrefix: "/taiyin-guqin",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
