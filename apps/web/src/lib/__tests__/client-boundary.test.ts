/**
 * @vitest-environment node
 *
 * 分层守卫：UI 只能通过 `@/lib/client` 接触绑定层。
 *
 * ## 为什么需要一条「测试」来管 import
 *
 * 门面层（`src/lib/client/index.ts`）的价值全在「所有人都走它」。
 * 只要有一个组件图省事直接 `import { ... } from "@/lib/taiyin-wasm"`，
 * 就会：① 让「换实现只改一处」的承诺失效；② 让该组件的测试必须知道 WASM 怎么初始化。
 *
 * 这种退化不会报错，只会在半年后变成「为什么改函数名要改 20 个文件」。
 * 所以把它变成一条会失败的测试，而不是写在文档里等人自觉。
 *
 * ## 允许的例外（都在下面白名单里写明理由）
 *
 * - `lib/client/**` 自身：它就是门面。
 * - `lib/taiyin-wasm.ts` / `lib/api.ts`：绑定层本体。
 * - `components/wasm-bootstrap.tsx`：引擎启动器，职责就是驱动 WASM 加载状态机，
 *   走门面反而绕一圈且拿不到 initSync 等底层入口。
 * - 测试文件：需要 mock 具体模块路径。
 *
 * 注意本文件只做**静态文本扫描**，不执行任何被检代码。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "../..");

/** 递归收集 UI 层源码（组件 + 页面）。 */
function collectUiFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectUiFiles(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.(tsx?|jsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 绑定层模块：UI 不该直接 import。 */
const BINDING_MODULES = ["@/lib/taiyin-wasm", "@/lib/api"];
/** 门面再导出的领域模块：UI 也应经门面拿，便于统一加降级。 */
const FACADE_COVERED = ["@/lib/lianmei", "@/lib/jianzi-rapid"];

const ALLOWED = new Set([
  normalize("components/wasm-bootstrap.tsx"),
]);

function normalize(rel: string): string {
  return rel.split("\\").join("/");
}

/** 抓取 `from "@/lib/xxx"` 与 `import("@/lib/xxx")` 两种写法。 */
function importedModules(text: string): Set<string> {
  const mods = new Set<string>();
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    mods.add(m[1]);
  }
  return mods;
}

describe("分层守卫 · UI 不绕过 @/lib/client", () => {
  const uiFiles = [
    ...collectUiFiles(join(SRC, "components")),
    ...collectUiFiles(join(SRC, "app")),
  ];

  it("UI 不直接 import 绑定层（taiyin-wasm / api）", () => {
    const offenders = [];
    for (const file of uiFiles) {
      const rel = normalize(relative(SRC, file));
      if (ALLOWED.has(rel)) continue;
      const mods = importedModules(readFileSync(file, "utf8"));
      for (const mod of BINDING_MODULES) {
        if (mods.has(mod)) offenders.push(`${rel} → ${mod}`);
      }
    }
    expect(
      offenders,
      `这些文件绕过了门面，请改从 "@/lib/client" 导入：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("UI 不直接 import 已由门面覆盖的领域模块", () => {
    const offenders = [];
    for (const file of uiFiles) {
      const rel = normalize(relative(SRC, file));
      const mods = importedModules(readFileSync(file, "utf8"));
      for (const mod of FACADE_COVERED) {
        if (mods.has(mod)) offenders.push(`${rel} → ${mod}`);
      }
    }
    expect(
      offenders,
      `这些文件应改从 "@/lib/client" 导入：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("门面确实导出了 UI 需要的那几类能力", async () => {
    const client = await import("@/lib/client");
    for (const name of [
      "useWasmInit",
      "isWasmReady",
      "encodeJianziBatch",
      "decodeJianziBatch",
      "arrangeJianpuSequence",
      "getJianziDictionary",
      "normalizeLianmei",
      "parseRapidInput",
      "api",
    ]) {
      expect(client, `门面缺少导出 ${name}`).toHaveProperty(name);
    }
  });
});
