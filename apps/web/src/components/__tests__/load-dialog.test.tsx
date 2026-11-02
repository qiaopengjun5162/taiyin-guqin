/**
 * @vitest-environment jsdom
 *
 * 加载对话框：列表、按曲名搜索、定弦标注。
 *
 * 定弦出现在这里不是装饰——点下去会连定弦一起切，
 * 用户得先看见这首谱按哪种调式弹。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ScoreListItem } from "@/lib/api";
import { LoadDialog } from "../load-dialog";

afterEach(cleanup);

const SCORES: ScoreListItem[] = [
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

function renderDialog(overrides: Partial<Parameters<typeof LoadDialog>[0]> = {}) {
  const onLoad = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <LoadDialog
      open
      scores={SCORES}
      onLoad={onLoad}
      onDelete={onDelete}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onLoad, onDelete, onClose };
}

describe("LoadDialog · 列表与定弦", () => {
  it("列出全部曲谱，并标注各自的定弦", () => {
    renderDialog();

    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getByText("潇湘水云")).toBeTruthy();
    expect(screen.getByText("正调")).toBeTruthy();
    expect(screen.getByText("蕤宾调")).toBeTruthy();
  });

  it("点一行把 id 交给 onLoad", () => {
    const { onLoad } = renderDialog();

    fireEvent.click(screen.getByText("潇湘水云"));

    expect(onLoad).toHaveBeenCalledWith("s2");
  });

  it("没有曲谱时不显示搜索框，给出空态提示", () => {
    renderDialog({ scores: [] });

    expect(screen.queryByLabelText("按曲名搜索")).toBeNull();
    expect(screen.getByText("暂无保存的曲谱")).toBeTruthy();
  });
});

describe("LoadDialog · 搜索", () => {
  it("按曲名过滤，只留匹配项", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("按曲名搜索"), { target: { value: "潇湘" } });

    expect(screen.getByText("潇湘水云")).toBeTruthy();
    expect(screen.queryByText("平沙落雁")).toBeNull();
  });

  it("没有匹配时给出带关键词的提示，而不是空白一片", () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("按曲名搜索"), { target: { value: "广陵散" } });

    expect(screen.getByText("没有匹配「广陵散」的曲谱")).toBeTruthy();
    expect(screen.queryByText("平沙落雁")).toBeNull();
  });

  it("清空搜索词后恢复完整列表", () => {
    renderDialog();
    const input = screen.getByLabelText("按曲名搜索");

    fireEvent.change(input, { target: { value: "潇湘" } });
    fireEvent.change(input, { target: { value: "" } });

    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getByText("潇湘水云")).toBeTruthy();
  });
});
