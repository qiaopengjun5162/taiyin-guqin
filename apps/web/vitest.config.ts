import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "lcov"],
      // 只统计业务代码：测试自身、生成类型、WASM 胶水不纳入口径。
      include: ["src/lib/**", "src/components/**", "src/app/**"],
      exclude: [
        "src/**/*.test.*",
        "src/**/__tests__/**",
        "src/lib/generated/**",
        "src/lib/svg-paths.qiji.ts",
        // 静态资源不是可执行代码，计入只会制造 0% 噪声
        "src/**/*.css",
        "src/app/favicon.ico",
      ],
      // 下限 = 2026-11-08 CI 实测（行 95.51 / 语句 92.90 / 分支 85.79 / 函数 93.52）
      // 各留 1.5 点以上余量（page.tsx 接线补漏 +56 行后余量足够，分支也抬了）。
      // 用途是「防退步」而不是「刷高分」。
      // 加了新代码却没加测试 → 这里会红，逼迫补测或显式调整阈值（并在 PR 里说明理由）。
      thresholds: {
        lines: 94,
        statements: 91,
        branches: 84,
        functions: 92,
      },
    },
  },
  resolve: {
    // 数组按顺序匹配：更具体的 @/wasm 必须排在 @ 前面，
    // 否则 "@/wasm/taiyin_core" 会被 "@" 先吃掉、解析成 src/wasm/…（不存在）。
    // 这个顺序 bug 曾让 taiyin-wasm.ts 无法在测试中加载（覆盖率工具解析失败静默排除）。
    alias: [
      { find: /^@\/wasm\//, replacement: path.resolve(__dirname, "./wasm") + "/" },
      { find: /^@\//, replacement: path.resolve(__dirname, "./src") + "/" },
    ],
  },
});
