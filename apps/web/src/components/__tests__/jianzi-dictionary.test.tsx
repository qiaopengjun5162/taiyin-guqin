/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianziDictionary } from "@/components/jianzi-dictionary";
import type { JianziDictEntry, DictFilter } from "@/lib/jianzi-dictionary-types";
import type { JianziState } from "@/lib/types";
import { __resetCustomJianziForTests, listSaved } from "@/lib/custom-jianzi";

// 字典数据 / 筛选 / 搜索逻辑已在 Rust（jianzi_dictionary 模块 + wasm）测试覆盖，
// 这里只验证组件与 wasm 边界的接线：筛选条件是否正确发送给 Rust，结果是否正确渲染。

function st(p: Partial<JianziState>): JianziState {
  return {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: null,
    stringNumber: null,
    ...p,
  };
}

const FIXTURE: JianziDictEntry[] = [
  { id: "散勾三", state: st({ toneType: "散", rightAction: "勾", stringNumber: "三" }), code: "sg3", searchText: "散勾三 散音 勾 三弦 sg3" },
  { id: "散挑三", state: st({ toneType: "散", rightAction: "挑", stringNumber: "三" }), code: "st3", searchText: "散挑三 散音 挑 三弦 st3" },
  { id: "大九勾四", state: st({ toneType: "按", leftFinger: "大", hui: "九", rightAction: "勾", stringNumber: "四" }), code: "ad9g4", searchText: "大九勾四 按音 大指 九徽 勾 四弦 ad9g4" },
  { id: "名九勾四", state: st({ toneType: "按", leftFinger: "夕", hui: "九", rightAction: "勾", stringNumber: "四" }), note: "夕 = 名指", code: "am9g4", searchText: "名九勾四 按音 名指 九徽 勾 四弦 名指 am9g4" },
  { id: "泛大九勾四", state: st({ toneType: "泛", leftFinger: "大", hui: "九", rightAction: "勾", stringNumber: "四" }), code: "fd9g4", searchText: "泛 大九勾四 泛音 大指 九徽 勾 四弦 fd9g4" },
  { id: "大九抹挑四", state: st({ toneType: "按", leftFinger: "大", hui: "九", rightAction: "抹挑", stringNumber: "四" }), code: "ad9mt4", searchText: "大九抹挑四 按音 大指 九徽 抹挑 四弦 ad9mt4" },
  { id: "大七六勾二", state: st({ toneType: "按", leftFinger: "大", hui: "七", fen: "六分", rightAction: "勾", stringNumber: "二" }), code: "ad7f6g2", searchText: "大七六勾二 按音 大指 七徽六分 勾 二弦 ad7f6g2" },
];

const LEFT_MAP: Record<string, string[]> = {
  大指: ["大"],
  名指: ["名", "夕"],
  中指: ["中"],
  食指: ["食", "亻"],
  跪指: ["跪"],
};
const ACTION_MAP: Record<string, string[]> = {
  勾: ["勾"], 挑: ["挑"], 抹: ["抹"], 托: ["托"], 打: ["打"], 剔: ["剔"], 摘: ["摘"],
  劈: ["劈", "擘"], 抹挑: ["抹挑"], 勾剔: ["勾剔"], 抹勾: ["抹勾"], 打摘: ["打摘"],
};

function applyFilter(entries: JianziDictEntry[], f: DictFilter): JianziDictEntry[] {
  return entries.filter((e) => {
    const s = e.state;
    if (f.tone && s.toneType !== f.tone) return false;
    if (f.left && !(LEFT_MAP[f.left] ?? []).includes(s.leftFinger ?? "")) return false;
    if (f.action && !(ACTION_MAP[f.action] ?? []).includes(s.rightAction ?? "")) return false;
    if (f.string && s.stringNumber !== f.string) return false;
    if (f.query) {
      const q = f.query.trim().toLowerCase();
      if (q && !e.searchText.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

vi.mock("@/lib/taiyin-wasm", () => ({
  useWasmInit: () => ({ state: "ready" as const, error: null }),
  getJianziDictionary: vi.fn(async (filter: DictFilter) => ({
    total: FIXTURE.length,
    entries: applyFilter(FIXTURE, filter),
  })),
}));

const TOTAL = FIXTURE.length;
const SAN_COUNT = FIXTURE.filter((e) => e.state.toneType === "散").length;
const FAN_COUNT = FIXTURE.filter((e) => e.state.toneType === "泛").length;
const DA_GOU_COUNT = FIXTURE.filter(
  (e) => e.state.leftFinger === "大" && e.state.rightAction === "勾",
).length;

describe("减字字典组件（wasm 接线）", () => {
  beforeEach(() => {
    // 「我的减字」是模块级 localStorage 快照，逐个用例重置，避免互相污染。
    __resetCustomJianziForTests();
  });

  it("wasm 就绪后渲染全表全部卡片", async () => {
    render(<JianziDictionary />);
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`共 ${TOTAL} 字`))).toBeInTheDocument(),
    );
    const grid = screen.getByTestId("dict-grid");
    expect(within(grid).getAllByTestId("dict-card-play")).toHaveLength(TOTAL);
  });

  it("点音色「散音」只留下散音卡片", async () => {
    render(<JianziDictionary />);
    await screen.findByText(new RegExp(`共 ${TOTAL} 字`));
    fireEvent.click(screen.getByRole("button", { name: "散音" }));
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`全表 ${TOTAL} 字`))).toBeInTheDocument(),
    );
    const grid = screen.getByTestId("dict-grid");
    expect(within(grid).getAllByTestId("dict-card-play")).toHaveLength(SAN_COUNT);
  });

  it("右手指法下拉选「勾」后再按左手指法「大指」叠加，只剩大指勾", async () => {
    render(<JianziDictionary />);
    await screen.findByText(new RegExp(`共 ${TOTAL} 字`));
    fireEvent.change(screen.getByLabelText("右手指法"), { target: { value: "勾" } });
    fireEvent.click(screen.getByRole("button", { name: "大指" }));
    await waitFor(() => {
      const grid = screen.getByTestId("dict-grid");
      expect(within(grid).getAllByTestId("dict-card-play")).toHaveLength(DA_GOU_COUNT);
    });
    expect(DA_GOU_COUNT).toBeGreaterThan(0);
  });

  it("搜索「泛音」收敛到泛音子集", async () => {
    render(<JianziDictionary />);
    await screen.findByText(new RegExp(`共 ${TOTAL} 字`));
    fireEvent.change(screen.getByPlaceholderText(/搜索读法/), { target: { value: "泛音" } });
    await waitFor(() => {
      const grid = screen.getByTestId("dict-grid");
      expect(within(grid).getAllByTestId("dict-card-play")).toHaveLength(FAN_COUNT);
    });
  });

  it("无匹配时给出空态提示而不崩溃", async () => {
    render(<JianziDictionary />);
    await screen.findByText(new RegExp(`共 ${TOTAL} 字`));
    fireEvent.change(screen.getByPlaceholderText(/搜索读法/), { target: { value: "不存在xyz" } });
    await waitFor(() =>
      expect(screen.getByText(/没有匹配的减字/)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("dict-grid").querySelectorAll("button")).toHaveLength(0);
  });

  it("点卡片触发试听而不抛错", async () => {
    render(<JianziDictionary />);
    await screen.findByText(new RegExp(`共 ${TOTAL} 字`));
    const first = screen.getByTestId("dict-grid").querySelectorAll("button")[0];
    expect(() => fireEvent.click(first!)).not.toThrow();
  });

  it("卡片显示减字码——看一眼就知道这字怎么敲", async () => {
    render(<JianziDictionary />);
    await screen.findByText(new RegExp(`共 ${TOTAL} 字`));
    // 码由 Rust 生成（见 jianzi_code），前端只负责显示
    expect(screen.getByText("ad9g4")).toBeInTheDocument();
    expect(screen.getByText("sg3")).toBeInTheDocument();
  });

  it("卡片可「存为常用」，写入与编辑器共用的本地字库", async () => {
    render(<JianziDictionary />);
    await screen.findByText(new RegExp(`共 ${TOTAL} 字`));
    const grid = screen.getByTestId("dict-grid");

    fireEvent.click(within(grid).getAllByRole("button", { name: /^把 .* 存为常用$/ })[0]!);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/已存入/),
    );
    const stored = listSaved();
    expect(stored).toHaveLength(1);
    // 存进去的是语义数据（能直接填回编辑器），不是一张图。
    expect(stored[0].state.rightAction).toBeTruthy();
    expect(stored[0].state.stringNumber).toBeTruthy();

    // 已存过的字，按钮置灰为「已在常用」，不会重复入库。
    expect(within(grid).getAllByRole("button", { name: /已在常用$/ }).length).toBeGreaterThan(0);
    expect(listSaved()).toHaveLength(1);
  });
});
