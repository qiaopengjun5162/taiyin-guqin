/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TunerPanel } from "../tuner-panel";
import { resetTuningCache } from "@/lib/tuning";
import { resetConcertPitchCache } from "@/lib/concert-pitch";

beforeEach(() => {
  window.localStorage.clear();
  resetTuningCache();
  resetConcertPitchCache();
});

describe("TunerPanel", () => {
  it("列出三种定弦，默认正调，七弦标注 C2…D3", () => {
    render(<TunerPanel />);
    const select = screen.getByLabelText("定弦（调式）") as HTMLSelectElement;
    expect(select.value).toBe("zhengdiao");
    expect(select.options).toHaveLength(3);

    const strings = screen.getByTestId("tuner-strings");
    expect(strings.textContent).toContain("C2");
    expect(strings.textContent).toContain("F2");
    expect(strings.textContent).toContain("A2");
    expect(strings.textContent).toContain("D3");
  });

  it("切到慢角调后三弦由 F2 变 E2，说明同步更新", () => {
    render(<TunerPanel />);
    const select = screen.getByLabelText("定弦（调式）") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "manjiao" } });

    const strings = screen.getByTestId("tuner-strings");
    expect(strings.textContent).toContain("E2");
    expect(strings.textContent).not.toContain("F2");
    expect(screen.getByText(/只把三弦慢半音/)).toBeInTheDocument();
    expect(window.localStorage.getItem("taiyin.tuning.v1")).toBe("manjiao");
  });

  it("蕤宾调五弦显示 B♭2", () => {
    render(<TunerPanel />);
    fireEvent.change(screen.getByLabelText("定弦（调式）"), { target: { value: "ruibin" } });
    expect(screen.getByTestId("tuner-strings").textContent).toContain("B♭2");
  });

  it("没有麦克风 API 时给出明确提示，而不是静默失败", async () => {
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });

    render(<TunerPanel />);
    fireEvent.click(screen.getByLabelText("开始调音"));

    expect(await screen.findByText(/不支持麦克风采集/)).toBeInTheDocument();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: original });
  });

  it("授权被拒时提示去开权限", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<TunerPanel />);
    fireEvent.click(screen.getByLabelText("开始调音"));

    expect(await screen.findByText(/麦克风权限被拒绝/)).toBeInTheDocument();
  });
});
