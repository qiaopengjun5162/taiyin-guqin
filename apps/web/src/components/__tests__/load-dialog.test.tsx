/**
 * @vitest-environment jsdom
 *
 * 加载对话框：列表、按曲名搜索、定弦标注，以及「社区（只读）/ 本机」双 tab。
 *
 * 定弦出现在这里不是装饰——点下去会连定弦一起切，
 * 用户得先看见这首谱按哪种调式弹。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ScoreListItem } from "@/lib/api";
import { LoadDialog, type LoadDialogTab } from "../load-dialog";

afterEach(cleanup);

const LOCAL: ScoreListItem[] = [
  {
    id: "s1",
    title: "平沙落雁",
    tuning: "zhengdiao",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "s2",
    title: "潇湘水云",
    tuning: "ruibin",
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
  },
];

const COMMUNITY: ScoreListItem[] = [
  {
    id: "c1",
    title: "广陵散",
    tuning: "zhengdiao",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  },
];

const tabs: LoadDialogTab[] = [
  { key: "community", label: "社区曲谱", scores: COMMUNITY, readOnly: true },
  { key: "local", label: "本机", scores: LOCAL },
];

function renderDialog(tabs: LoadDialogTab[], overrides: Partial<Parameters<typeof LoadDialog>[0]> = {}) {
  const onLoad = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <LoadDialog open tabs={tabs} onLoad={onLoad} onDelete={onDelete} onClose={onClose} {...overrides} />,
  );
  return { ...utils, onLoad, onDelete, onClose };
}

describe("LoadDialog · 单 tab 列表与定弦", () => {
  it("单 tab 时显示标题而非 tab 条，并标注定弦", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    expect(screen.getByText("已保存的曲谱")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /社区曲谱/ })).toBeNull();
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getByText("正调")).toBeTruthy();
    expect(screen.getByText("蕤宾调")).toBeTruthy();
  });

  it("点一行把 (id, tabKey) 交给 onLoad", () => {
    const { onLoad } = renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    fireEvent.click(screen.getByText("潇湘水云"));
    expect(onLoad).toHaveBeenCalledWith("s2", "local");
  });

  it("没有曲谱时不显示搜索框，给出空态提示", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: [] }]);
    expect(screen.queryByLabelText("按曲名搜索")).toBeNull();
    expect(screen.getByText("暂无曲谱")).toBeTruthy();
  });

  it("清空搜索词后恢复完整列表", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    const input = screen.getByLabelText("按曲名搜索");
    fireEvent.change(input, { target: { value: "潇湘" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getByText("潇湘水云")).toBeTruthy();
  });
});

describe("LoadDialog · 双 tab（社区只读）", () => {
  it("显示两个 tab 及各自数量，默认激活第一个（社区）", () => {
    renderDialog(tabs);
    expect(screen.getByRole("button", { name: /社区曲谱/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /本机/ })).toBeTruthy();
    expect(screen.getByText("广陵散")).toBeTruthy();
    expect(screen.queryByText("平沙落雁")).toBeNull();
  });

  it("社区 tab 是只读，不显示删除按钮", () => {
    renderDialog(tabs);
    expect(screen.queryByTitle("删除")).toBeNull();
  });

  it("切到本机 tab 显示本地谱，并可删除", () => {
    renderDialog(tabs);
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getAllByTitle("删除").length).toBe(LOCAL.length);
  });

  it("从本机 tab 加载传 tabKey=local", () => {
    const { onLoad } = renderDialog(tabs);
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    fireEvent.click(screen.getByText("平沙落雁"));
    expect(onLoad).toHaveBeenCalledWith("s1", "local");
  });

  it("从社区 tab 加载传 tabKey=community", () => {
    const { onLoad } = renderDialog(tabs);
    fireEvent.click(screen.getByText("广陵散"));
    expect(onLoad).toHaveBeenCalledWith("c1", "community");
  });
});

describe("LoadDialog · 搜索", () => {
  it("按曲名过滤，只留匹配项", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    fireEvent.change(screen.getByLabelText("按曲名搜索"), { target: { value: "潇湘" } });
    expect(screen.getByText("潇湘水云")).toBeTruthy();
    expect(screen.queryByText("平沙落雁")).toBeNull();
  });

  it("没有匹配时给出带关键词的提示", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    fireEvent.change(screen.getByLabelText("按曲名搜索"), { target: { value: "广陵散" } });
    expect(screen.getByText("没有匹配「广陵散」的曲谱")).toBeTruthy();
  });

  it("切换 tab 时清空搜索词，避免旧词跨分类串味", () => {
    renderDialog(tabs);
    const input = screen.getByLabelText("按曲名搜索");
    fireEvent.change(input, { target: { value: "广陵" } });
    expect(screen.getByText("广陵散")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    // 切 tab 后搜索被清空，本机谱全部恢复、社区谱消失
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getByText("潇湘水云")).toBeTruthy();
    expect(screen.queryByText("广陵散")).toBeNull();
  });
});
