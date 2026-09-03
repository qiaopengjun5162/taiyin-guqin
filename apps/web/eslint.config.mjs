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
  ]),
]);

export default eslintConfig;
