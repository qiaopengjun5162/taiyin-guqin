import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 生成的 WASM 构建产物（由 wasm-pack 产出，非手写源码），排除 lint 噪音。
    // 这些文件在 CI 由 build.yml 的 Build WASM 步骤生成，本地由 just build-wasm 生成。
    "wasm/**",
    "public/wasm/**",
    // Next.js 静态导出产物（output: "export" → apps/web/dist），同样非源码。
    "dist/**",
    // vitest 覆盖率报告（含 lcov-report 的 HTML 与其中的 .js），每次跑覆盖率都会重写。
    "coverage/**",
    // 线上冒烟脚本（e2e/smoke.mjs）：Node 环境执行的发布后验证工具，
    // 不是 Next 运行时源码，顶层 await 与 console.log 是刻意的输出方式。
    "e2e/**",
  ]),
]);

export default eslintConfig;
