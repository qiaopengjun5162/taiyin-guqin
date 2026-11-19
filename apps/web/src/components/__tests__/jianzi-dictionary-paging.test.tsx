/**
 * @vitest-environment jsdom
 *
 * 字典「渐进显示」的专项测试。
 * 主测试文件 jianzi-dictionary.test.tsx 的 fixture 只有 7 条，天然不会触发分页，
 * 所以这里单独造一批 30 条，守住四件事：
 *   1. 默认只画一批，别把全表一次铺完（手机端会滚近 10 屏）；
 *   2. 计数行说清「共多少 / 已显示多少」，别让人以为只有 20 个字；
 *   3. 「显示更多」能追加到全量；
 *   4. 换筛选 / 搜索条件后收回到第一批，不许把上一批的展开量带进新结果。
 * 筛选与搜索本身仍在 Rust 端对全表执行（这里只 mock 边界），不改变检索范围。
 */
import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { loadRealWasm } from "../../lib/__tests__/load-wasm";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianziDictionary } from "@/components/jianzi-dictionary";
import { __resetCustomJianziForTests } from "@/lib/custom-jianzi";

const { ALL } = vi.hoisted(() => {
  const base = {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: null,
    stringNumber: null,
  };
  return {
    ALL: Array.from({ length: 30 }, (_, i) => ({
      id: `字${i}`,
      state: { ...base, toneType: "散", rightAction: "勾", stringNumber: "三" },
      code: `c${i}`,
      searchText: `字${i} 散音 勾 三弦 c${i}`,
    })),
  };
});

/*
 * 用 `importOriginal` 保留真实模块：`loadRealWasm` 要调 `initWasmSync`，
 * 整个替身掉会让它变成 undefined（音高推算一迁进 Rust，这条链就断了）。
 * 只覆盖本文件真正需要替身的那几个导出。
 */
vi.mock("@/lib/taiyin-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/taiyin-wasm")>();
  return {
    ...actual,
  useWasmInit: () => ({ state: "ready" as const, error: null }),
  getJianziDictionary: vi.fn(async (filter: { query?: string }) => {
    const q = filter.query?.trim() ?? "";
    const entries = q
      ? ALL.filter((e: { searchText: string }) => e.searchText.includes(q))
      : ALL;
    return { total: ALL.length, entries };
  }),
  };
});

const PAGE_SIZE = 20;

function cardCount() {
  return within(screen.getByTestId("dict-grid")).queryAllByTestId("dict-card-play").length;
}

/** 音高推算已迁进 Rust，薄壳在引擎未就绪时返回 null——必须装载真实产物。 */
beforeAll(loadRealWasm);

describe("减字字典 · 渐进显示", () => {
  beforeEach(() => {
    __resetCustomJianziForTests();
  });

  it("默认只渲染第一批，计数行说清总量与已显示量", async () => {
    render(<JianziDictionary />);
    await screen.findByText(/共 30 字/);
    expect(cardCount()).toBe(PAGE_SIZE);
    expect(screen.getByText(/共 30 字 · 已显示 20/)).toBeInTheDocument();
    expect(screen.getByTestId("dict-show-more")).toHaveTextContent(/还有 10 字/);
  });

  it("点「显示更多」追加到全量，追加完按钮消失", async () => {
    render(<JianziDictionary />);
    await screen.findByText(/共 30 字/);
    fireEvent.click(screen.getByTestId("dict-show-more"));
    await waitFor(() => expect(cardCount()).toBe(30));
    expect(screen.queryByTestId("dict-show-more")).not.toBeInTheDocument();
    // 全量出现后不再显示「已显示 20」这种会误导的提示
    expect(screen.queryByText(/已显示 20/)).not.toBeInTheDocument();
  });

  it("展开之后换筛选条件，收回第一批而不是沿用旧的展开量", async () => {
    render(<JianziDictionary />);
    await screen.findByText(/共 30 字/);
    fireEvent.click(screen.getByTestId("dict-show-more"));
    await waitFor(() => expect(cardCount()).toBe(30));

    // 搜索「字1」→ Rust 端返回 11 条（字1、字10~字19），换条件后应回到第一批内
    fireEvent.change(screen.getByPlaceholderText(/搜索读法/), { target: { value: "字1" } });
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`共 11 字`))).toBeInTheDocument(),
    );
    expect(cardCount()).toBe(11);
    expect(screen.queryByTestId("dict-show-more")).not.toBeInTheDocument();
  });

  it("结果不足一批时不出现「显示更多」", async () => {
    render(<JianziDictionary />);
    await screen.findByText(/共 30 字/);
    fireEvent.change(screen.getByPlaceholderText(/搜索读法/), { target: { value: "字29" } });
    await waitFor(() =>
      expect(screen.getByText(/共 1 字/)).toBeInTheDocument(),
    );
    expect(cardCount()).toBe(1);
    expect(screen.queryByTestId("dict-show-more")).not.toBeInTheDocument();
  });
});
