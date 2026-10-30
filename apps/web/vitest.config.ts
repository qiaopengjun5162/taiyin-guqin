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
      // 下限 = 2026-10-30 实测基线（行 94.44 / 语句 92.05 / 分支 85.29 / 函数 90.99，
      // 含此前被覆盖率工具静默排除的 taiyin-wasm.ts）略降约 2 个点，
      // 用来「防退步」而不是「刷高分」。
      // 加了新代码却没加测试 → 这里会红，逼迫补测或显式调整阈值（并在 PR 里说明理由）。
      thresholds: {
        lines: 92,
        statements: 89,
        branches: 83,
        functions: 88,
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
