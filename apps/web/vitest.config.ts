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
      // 下限 = 2026-10-30 实测基线（行 92.54 / 分支 84.02 / 函数 86.86 / 语句 89.78）
      // 略降约 2 个点，用来「防退步」而不是「刷高分」。
      // 加了新代码却没加测试 → 这里会红，逼迫补测或显式调整阈值（并在 PR 里说明理由）。
      thresholds: {
        lines: 90,
        statements: 87,
        branches: 82,
        functions: 85,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/wasm": path.resolve(__dirname, "./wasm"),
    },
  },
});
