/**
 * 静态页冒烟：字全表 / 乐论 / 科普。
 *
 * 这三页没有状态机，但它们是「内容可读性」的唯一出口——
 * 排版改动把某段话挤掉、或组件接线断了，用户看到的是空白页。
 * 这里只说清楚一件事：页面能挂载、该在的段落都在。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// 字全表页里两个组件都直接吃 WASM；这里替身，只验页面骨架。
vi.mock("@/components/jianzi-dictionary", () => ({
  JianziDictionary: () => <div data-testid="dictionary">字典本体</div>,
}));
vi.mock("@/components/jianzi-frequency-panel", () => ({
  JianziFrequencyPanel: () => <div data-testid="frequency">字频统计</div>,
}));

import ZidianPage from "@/app/zidian/page";
import YuelunPage from "@/app/yuelun/page";
import JianzipuPage from "@/app/jianzipu/page";

describe("字全表页", () => {
  it("挂载两段：字典本体与量化分析，并说明减字码", () => {
    render(<ZidianPage />);

    expect(screen.getByText("字全表")).toBeInTheDocument();
    expect(screen.getByText("古琴 · 减字谱 · 字典")).toBeInTheDocument();
    expect(screen.getByTestId("dictionary")).toBeInTheDocument();
    expect(screen.getByTestId("frequency")).toBeInTheDocument();
    // 减字码是这一页的核心概念，写法必须露出来
    expect(screen.getByText("ad9g4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /回到减字谱编辑器/ })).toHaveAttribute("href", "/");
  });
});

describe("乐论页", () => {
  it("原文与白话对照都在", () => {
    render(<YuelunPage />);

    expect(screen.getByText("乐论")).toBeInTheDocument();
    expect(screen.getByText(/夫乐者，乐也，人情之所必不免也/)).toBeInTheDocument();
    expect(screen.getByText(/音乐是人的本性的自然流露/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /回到减字谱编辑器/ })).toBeInTheDocument();
  });
});

describe("减字谱科普页", () => {
  it("键盘速录与「反过来也通」都在", () => {
    render(<JianzipuPage />);

    // 编码是可以粘回编辑器的，这一句是「码不只是注释」的承诺
    expect(screen.getByText(/反过来也通/)).toBeInTheDocument();
    expect(screen.getAllByText(/ad9g4/).length).toBeGreaterThan(0);
  });
});
