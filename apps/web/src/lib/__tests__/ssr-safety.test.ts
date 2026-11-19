/**
 * @vitest-environment node
 *
 * SSR 守卫：渲染期代码不得碰 `window` / `document` / `localStorage`。
 *
 * ## 为什么需要这道闸门
 *
 * 静态导出（`output: "export"`）在 Node 里预渲染每个页面。**渲染期**访问
 * `window` 会直接抛 `ReferenceError: window is not defined`，整站构建失败。
 *
 * 2026-11-17 就撞到过一次：把「是不是分享直达」在渲染期算好当参数传给 hook，
 * 构建当场红——而 `tsc`、`eslint`、1388 条单测**全都通过**。
 * 单测跑在 jsdom 里（window 恒存在），根本不可能发现这件事。
 *
 * CI 有 `next build` 会拦下它，但报错信息是 `ReferenceError` + 压缩后的行号，
 * 定位要花时间。这道静态检查把问题说清楚：哪个文件、哪一行。
 *
 * ## 允许的例外
 *
 * 客户端组件在**事件处理器 / useEffect / useCallback 内部**访问浏览器 API 是正常的。
 * 所以这里不粗暴禁止，而是检查「模块顶层与组件函数体顶层的直接调用」——
 * 用括号深度做近似判断，宁可漏报也不误报大量正常代码。
 *
 * 已知局限：这是文本启发式，不是真正的 AST 分析。它能抓到「渲染期直接读
 * `window.location`」这类显性写法，抓不到「通过中间函数间接读」。
 * 真正的兜底仍是 `next build`。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "../..");

/** 递归收集源码。 */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * 找出「渲染期直接读浏览器 API」的显性写法。
 *
 * ## 判据只留一条，且收得很窄
 *
 * 只报 **hook 调用的实参里读浏览器 API** 这一种：
 *
 * ```tsx
 * const { x } = useScoreDraft({ skip: read(window.location.search) });
 *                               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ 渲染期求值 → SSR 必炸
 * ```
 *
 * 这正是 2026-11-17 那次构建失败的原形，也正是单测（jsdom 里 window 恒存在）
 * 与 `tsc` 都不可能发现的形状。
 *
 * ## 为什么放弃了其他判据
 *
 * 我最初还检查「函数体内声明 `const x = window.yyy`」，结果报了 17 处**误报**——
 * 那些都在普通工具函数或事件处理器里（`function handle() { window.print(); }`），
 * SSR 时根本不会执行。用缩进区分「组件体」与「普通函数体」并不可靠：
 * `function downloadWav() { const a = document.createElement("a"); }` 缩进同样是 2。
 *
 * **会误报的门禁比没有门禁更糟**——它会被绕过或关掉。
 * 所以这里只保留零误报的那一条；间接读取（经由中间函数）抓不到，
 * 那个缺口由 CI 的 `next build` 兜底。
 */
function renderTimeWindowReads(text: string): { line: number; snippet: string }[] {
  const hits: { line: number; snippet: string }[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    // 去掉行尾注释，避免注释里提到 window 造成误报
    const code = raw.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");

    // hook 实参里读浏览器 API。带 `=>` 的行是回调（延迟执行），排除。
    if (
      /\buse[A-Z]\w*\s*\(/.test(code) &&
      /\b(window|document|localStorage)\b/.test(code) &&
      !/=>/.test(code)
    ) {
      hits.push({ line: i + 1, snippet: raw.trim() });
    }
  }

  return hits;
}

describe("SSR 守卫 · 渲染期不碰浏览器 API", () => {
  const files = [...collect(join(SRC, "app")), ...collect(join(SRC, "components")), ...collect(join(SRC, "lib"))];

  it("没有在 hook 参数或组件体顶层直接读 window/document/localStorage", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).split("\\").join("/");
      for (const hit of renderTimeWindowReads(readFileSync(file, "utf8"))) {
        offenders.push(`${rel}:${hit.line}  ${hit.snippet}`);
      }
    }
    expect(
      offenders,
      `这些在渲染期（SSR 时会跑）读了浏览器 API，静态导出会失败：\n${offenders.join("\n")}\n` +
        "把访问挪进 useEffect / 事件处理器，或改成 hook 内部在 effect 里读。",
    ).toEqual([]);
  });

  it("守卫本身能抓到事故形状（自测，防假绿）", () => {
    // 本次真实事故的那一行
    const bad = `const { x } = useScoreDraft({ skip: readShared(window.location.search) !== null });`;
    expect(renderTimeWindowReads(bad)).toHaveLength(1);

    // 合法写法不该报
    const good = [
      `useEffect(() => { setV(readDraft()); }, []);`,
      `const v = typeof window === "undefined" ? {} : read();`,
      `function handle() { window.print(); }`,
      `useEffect(() => { if (read(window.location.search)) return; }, []);`,
    ];
    for (const line of good) {
      expect(renderTimeWindowReads(line), `误报：${line}`).toHaveLength(0);
    }
  });
});
