/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SaveLoadToolbar } from "../save-load-toolbar";

const mockExamples = [
  { id: "test-1", title: "示例一", description: "", notes: [] },
  { id: "test-2", title: "示例二", description: "", notes: [] },
];

describe("SaveLoadToolbar", () => {
  it("有音符时给出 MIDI 导出按钮，点击回调 onExportMidi", () => {
    const onExportMidi = vi.fn();
    const { getByLabelText, rerender } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        onExportMidi={onExportMidi}
        hasNotes
        saveStatus="idle"
      />,
    );
    fireEvent.click(getByLabelText("导出 MIDI"));
    expect(onExportMidi).toHaveBeenCalledTimes(1);

    // 没音符时不该出现（导空谱没有意义）
    rerender(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        onExportMidi={onExportMidi}
        hasNotes={false}
        saveStatus="idle"
      />,
    );
    expect(() => getByLabelText("导出 MIDI")).toThrow();
  });

  it("renders title input and action buttons", () => {
    const { container } = render(
      <SaveLoadToolbar
        title="测试曲谱"
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
        storageMode="browser"
      />,
    );
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    expect(input.value).toBe("测试曲谱");
    expect(container.textContent).toContain("撤销");
    expect(container.textContent).toContain("重做");
    expect(container.textContent).toContain("保存");
    expect(container.textContent).toContain("加载");
    expect(container.textContent).toContain("存本机");
  });

  it("calls onUndo and onRedo when clicked", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { getByText } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
        canUndo
        canRedo
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );
    fireEvent.click(getByText("← 撤销"));
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText("重做 →"));
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("disables undo/redo buttons when unavailable", () => {
    const { getByText } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
        canUndo={false}
        canRedo={false}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />,
    );
    expect(getByText("← 撤销")).toBeDisabled();
    expect(getByText("重做 →")).toBeDisabled();
  });

  it("calls onTitleChange when typing in title input", () => {
    const onTitleChange = vi.fn();
    const { container } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={onTitleChange}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
      />,
    );
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "新标题" } });
    expect(onTitleChange).toHaveBeenCalledWith("新标题");
  });

  it("calls onTitleBlur when title input loses focus", () => {
    const onTitleBlur = vi.fn();
    const { container } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onTitleBlur={onTitleBlur}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
      />,
    );
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.blur(input);
    expect(onTitleBlur).toHaveBeenCalledTimes(1);
  });

  it("server 模式下点击「发布到社区」触发 onSave", () => {
    const onSave = vi.fn();
    const onLoad = vi.fn();
    const { getByText } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={onSave}
        onLoad={onLoad}
        hasNotes
        saveStatus="idle"
        storageMode="server"
      />,
    );
    // server 模式保存即公开发布，按钮文字变「发布到社区」
    fireEvent.click(getByText("发布到社区"));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText("加载"));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("browser 模式下点击「保存」触发 onSave，显示「存本机」", () => {
    const onSave = vi.fn();
    const { getByText, queryByText } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={onSave}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
        storageMode="browser"
      />,
    );
    fireEvent.click(getByText("保存"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(getByText("存本机")).toBeTruthy();
    expect(queryByText(/已发布/)).toBeNull();
  });

  it("server 模式显示「已发布（公开）」标签而非「存本机」", () => {
    const { getByText, queryByText } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
        storageMode="server"
      />,
    );
    expect(getByText("已发布（公开）")).toBeTruthy();
    expect(queryByText("存本机")).toBeNull();
  });

  it("shows PNG export button when hasNotes and onExportPng provided", () => {
    const onExportPng = vi.fn();
    const { getByText } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
        onExportPng={onExportPng}
      />,
    );
    fireEvent.click(getByText("PNG"));
    expect(onExportPng).toHaveBeenCalledTimes(1);
  });

  it("shows SVG export button when onExportSvg provided and calls it", () => {
    const onExportSvg = vi.fn();
    const { getByText } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
        onExportSvg={onExportSvg}
      />,
    );
    fireEvent.click(getByText("SVG"));
    expect(onExportSvg).toHaveBeenCalledTimes(1);
  });

  it("hides export button when hasNotes is false", () => {
    const { container } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes={false}
        saveStatus="idle"
        onExportPng={vi.fn()}
        onExportText={vi.fn()}
      />,
    );
    expect(container.textContent).not.toContain("导出");
  });

  it("shows text export button and calls onExportText", () => {
    const onExportText = vi.fn();
    const { getByText } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes
        saveStatus="idle"
        onExportText={onExportText}
      />,
    );
    fireEvent.click(getByText("导出文本"));
    expect(onExportText).toHaveBeenCalledTimes(1);
  });

  it("shows example select and calls onLoadExample", () => {
    const onLoadExample = vi.fn();
    const { container } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes={false}
        saveStatus="idle"
        examples={mockExamples}
        onLoadExample={onLoadExample}
      />,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "test-2" } });
    expect(onLoadExample).toHaveBeenCalledWith("test-2");
  });

  it("hides example select when no examples provided", () => {
    const { container } = render(
      <SaveLoadToolbar
        title=""
        onTitleChange={vi.fn()}
        onSave={vi.fn()}
        onLoad={vi.fn()}
        hasNotes={false}
        saveStatus="idle"
      />,
    );
    expect(container.querySelector("select")).not.toBeInTheDocument();
  });
});
