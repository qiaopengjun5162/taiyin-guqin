import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静态导出：前端是客户端重应用，WASM + AudioContext 均在浏览器运行，
  // 无需 Next.js SSR。产物可直接部署到 CDN/nginx。
  output: "export",
  distDir: "dist",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
