/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SvgJianziBlock, RIGHT_ACTION_MAP } from "../svg-jianzi-block";
import type { JianziState } from "@/lib/types";
import { createEmptyState } from "@/lib/jianzi";
import { DEFAULT_KEYBOARD } from "@/lib/types";
import { SVG_PATHS } from "@/lib/svg-paths";

function make(overrides: Partial<JianziState> = {}): JianziState {
  return { ...createEmptyState(), ...overrides };
}

describe("SvgJianziBlock", () => {
  it("renders null for empty state", () => {
    const { container } = render(<SvgJianziBlock state={make()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders top hat for 散音", () => {
    const s = make({ toneType: "散", rightAction: "勹", stringNumber: "五" });
    const { container } = render(<SvgJianziBlock state={s} />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });

  it("renders top_fan for 泛音", () => {
    const s = make({ toneType: "泛", leftFinger: "大", hui: "十", rightAction: "勹", stringNumber: "三" });
    const { container } = render(<SvgJianziBlock state={s} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders left finger glyph for 大", () => {
    const s = make({ toneType: "按", leftFinger: "大", hui: "九", rightAction: "勹", stringNumber: "四" });
    const { container } = render(<SvgJianziBlock state={s} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders text fallback for 亻 (食)", () => {
    const s = make({ toneType: "按", leftFinger: "亻", hui: "九", rightAction: "勹", stringNumber: "四" });
    const { container } = render(<SvgJianziBlock state={s} />);
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBeGreaterThanOrEqual(1);
    expect(spans[0].textContent).toBe("食");
  });

  it("renders fen_ban when fen is 半", () => {
    const s = make({ toneType: "按", leftFinger: "大", hui: "七", fen: "半", rightAction: "勹", stringNumber: "二" });
    const { container } = render(<SvgJianziBlock state={s} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders fen_3 for 三分", () => {
    const s = make({ toneType: "按", leftFinger: "大", hui: "七", fen: "三分", rightAction: "勹", stringNumber: "二" });
    const { container } = render(<SvgJianziBlock state={s} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders rh_mo for 木 (抹)", () => {
    const s = make({ toneType: "散", rightAction: "木", stringNumber: "一" });
    const { container } = render(<SvgJianziBlock state={s} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("compact mode removes top hat (no toneType)", () => {
    const s = make({ toneType: "散", rightAction: "勹", stringNumber: "五" });
    const { container } = render(<SvgJianziBlock state={s} compact />);
    expect(container.firstChild).not.toBeNull();
  });

  it("applies fontSize prop to container dimensions", () => {
    const s = make({ toneType: "散", rightAction: "勹", stringNumber: "五" });
    const { container } = render(<SvgJianziBlock state={s} fontSize="48px" />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.width).toBe("48px");
    expect(parseFloat(div.style.height)).toBeCloseTo(67.2, 1);
  });

  it("renders all 7 string numbers", () => {
    for (const str of ["一", "二", "三", "四", "五", "六", "七"]) {
      const s = make({ toneType: "散", rightAction: "勹", stringNumber: str });
      const { container } = render(<SvgJianziBlock state={s} />);
      expect(container.firstChild, `str ${str}`).not.toBeNull();
    }
  });

  it("renders all 8 right actions", () => {
    for (const action of ["勹", "木", "乚", "乇", "丁", "尸", "倽", "剔"]) {
      const s = make({ toneType: "散", rightAction: action, stringNumber: "一" });
      const { container } = render(<SvgJianziBlock state={s} />);
      expect(container.firstChild, `action ${action}`).not.toBeNull();
    }
  });

  it("renders all 4 compound right actions (抹挑/勾剔/抹勾/打摘)", () => {
    for (const action of ["抹挑", "勾剔", "抹勾", "打摘"]) {
      const s = make({ toneType: "散", rightAction: action, stringNumber: "一" });
      const { container } = render(<SvgJianziBlock state={s} />);
      expect(container.firstChild, `action ${action}`).not.toBeNull();
    }
  });

  /*
   * 契约测试：键盘每个可选指法都必须有 SVG 映射且字形真实存在。
   *
   * 这是真实踩过的坑——复合指法早期只登记在解析器里，
   * 字体 GSUB 分支（80% 场景）能渲染所以看不出问题，
   * 但 SVG 降级分支（泛音 / 打摘）会静默渲染空白。
   */
  it("every keyboard right action has an existing SVG glyph", () => {
    for (const action of DEFAULT_KEYBOARD.rightActions) {
      const key = RIGHT_ACTION_MAP[action];
      expect(key, `键盘指法「${action}」缺少 SVG 映射`).toBeTruthy();
      expect(
        SVG_PATHS[key as string],
        `键盘指法「${action}」映射的 SVG 字形 ${key} 不存在`,
      ).toBeTruthy();
    }
  });
});
