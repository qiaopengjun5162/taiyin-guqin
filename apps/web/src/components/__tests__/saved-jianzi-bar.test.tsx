/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SavedJianziBar } from "@/components/saved-jianzi-bar";
import { __resetCustomJianziForTests, listSaved, saveJianzi } from "@/lib/custom-jianzi";
import type { JianziState } from "@/lib/types";

const anYin: JianziState = {
  toneType: "按",
  rhythmMode: null,
  leftFinger: "大",
  hui: "九",
  fen: null,
  slide: null,
  rightAction: "勾",
  stringNumber: "四",
};

const empty: JianziState = {
  toneType: "按",
  rhythmMode: null,
  leftFinger: null,
  hui: null,
  fen: null,
  slide: null,
  rightAction: null,
  stringNumber: null,
};

beforeEach(() => {
  window.localStorage.clear();
  __resetCustomJianziForTests();
});

describe("我的减字工具栏", () => {
  it("空库时说清怎么用", () => {
    render(<SavedJianziBar current={anYin} onPick={vi.fn()} />);
    expect(screen.getByText(/还没有存过/)).toBeInTheDocument();
  });

  it("减字没填完时不让存", () => {
    render(<SavedJianziBar current={empty} onPick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "存为常用" })).toBeDisabled();
  });

  it("存下当前减字后出现一张可点的卡片", () => {
    render(<SavedJianziBar current={anYin} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "存为常用" }));

    expect(listSaved()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "填入 大九勾四" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已存入");
  });

  it("点卡片把整组指法填回去，并记一次使用", () => {
    saveJianzi(anYin);
    const onPick = vi.fn();
    render(<SavedJianziBar current={empty} onPick={onPick} />);

    fireEvent.click(screen.getByRole("button", { name: "填入 大九勾四" }));
    expect(onPick).toHaveBeenCalledWith(anYin);
    expect(listSaved()[0].uses).toBe(2);
  });

  it("删除后回到空态", () => {
    saveJianzi(anYin);
    render(<SavedJianziBar current={empty} onPick={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "删除 大九勾四" }));
    expect(listSaved()).toHaveLength(0);
    expect(screen.getByText(/还没有存过/)).toBeInTheDocument();
  });

  it("空库时导出按钮不可用", () => {
    render(<SavedJianziBar current={anYin} onPick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "导出" })).toBeDisabled();
  });

  it("导入坏文件时把原因说出来，而不是静默", async () => {
    render(<SavedJianziBar current={anYin} onPick={vi.fn()} />);
    const input = screen.getByLabelText("导入我的减字（JSON）") as HTMLInputElement;
    const file = new File(["不是 json"], "bad.json", { type: "application/json" });

    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole("status")).toHaveTextContent(/JSON/);
  });
});
