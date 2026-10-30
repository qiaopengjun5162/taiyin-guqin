/**
 * @vitest-environment jsdom
 *
 * 减字键盘交互测试。
 *
 * 这块之前覆盖率只有 24%，因为它是"纯交互壳"：逻辑分散在 useState + 点击回调里，
 * 单测只能靠模拟真实点击路径。这里按用户实际成谱的顺序走：
 * 选音色 → 选指法/徽位/弦序 → 确认 → 校验吐出的 NoteColumn。
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianzipuKeyboard } from "../jianzipu-keyboard";
import type { NoteColumn } from "@/lib/types";

/** 按分区标题定位按键组（同名文案如"散"在音色/节奏里各有一个，不能全局找）。 */
function section(container: HTMLElement, label: string): HTMLElement {
  const p = Array.from(container.querySelectorAll("p")).find(
    (el) => el.textContent === label,
  );
  if (!p?.parentElement) throw new Error(`未找到分区「${label}」`);
  return p.parentElement;
}

/** 取分区内某个按钮。 */
function option(
  container: HTMLElement,
  label: string,
  name: string,
): HTMLElement {
  const btn = Array.from(
    section(container, label).querySelectorAll("button"),
  ).find((b) => b.textContent === name);
  if (!btn) throw new Error(`分区「${label}」内没有按钮「${name}」`);
  return btn;
}

/** 点选分区内的一个按键。 */
function pick(container: HTMLElement, label: string, name: string) {
  fireEvent.click(option(container, label, name));
}

const confirmBtn = () =>
  screen.getByRole("button", { name: /^(确认|更新)$/ }) as HTMLButtonElement;

describe("JianzipuKeyboard", () => {
  it("初始为散音，只要求右手指法与弦序", () => {
    const { container } = render(<JianzipuKeyboard />);

    expect(container.textContent).toContain("还缺：右手指法、弦序");
    expect(confirmBtn().disabled).toBe(true);

    // 散音（空弦）不存在左手/徽分，这三组不该出现
    expect(() => section(container, "左手")).toThrow();
    expect(() => section(container, "徽位")).toThrow();
    expect(() => section(container, "分")).toThrow();

    // 默认进入「琴艺 · 指法」页签
    const fingerTab = screen.getByRole("button", { name: "琴艺 · 指法" });
    expect(fingerTab.className).toContain("bg-stone-800");
  });

  it("选齐右手与弦序后可以确认，并吐出完整 NoteColumn", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);

    pick(container, "右手", "勹");
    pick(container, "弦序", "五");

    expect(container.textContent).not.toContain("还缺：");
    const confirm = confirmBtn();
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);

    expect(onAppend).toHaveBeenCalledTimes(1);
    const note = onAppend.mock.calls[0][0] as NoteColumn;
    expect(note.jianzi).toEqual({
      toneType: "散",
      rhythmMode: null,
      leftFinger: null,
      hui: null,
      fen: null,
      rightAction: "勹",
      stringNumber: "五",
    });
    expect(note.duration).toBe("四分");
    expect(note.jianpuNumber).toBeNull();
    expect(note.jianpuOctave).toBe("");
    expect(note.jianpuDot).toBe(false);
    expect(typeof note.id).toBe("string");
    expect(note.id.length).toBeGreaterThan(0);
  });

  it("确认后清空左右手与徽分，但保留音色语境", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);

    pick(container, "右手", "勹");
    pick(container, "弦序", "五");
    fireEvent.click(confirmBtn());

    expect(container.textContent).toContain("还缺：右手指法、弦序");
    expect(confirmBtn().disabled).toBe(true);
    // 音色仍是散，选中态保留
    expect(option(container, "音色", "散").className).toContain("bg-amber-700");
  });

  it("再次点击已选按键等于取消选择", () => {
    const { container } = render(<JianzipuKeyboard />);

    pick(container, "右手", "勹");
    pick(container, "弦序", "五");
    expect(confirmBtn().disabled).toBe(false);

    pick(container, "右手", "勹");
    expect(confirmBtn().disabled).toBe(true);
    expect(container.textContent).toContain("还缺：右手指法");
  });

  it("切到按音后补齐左手/徽位/分四项要求", () => {
    const { container } = render(<JianzipuKeyboard />);

    pick(container, "音色", "按");

    expect(section(container, "左手")).toBeTruthy();
    expect(section(container, "徽位")).toBeTruthy();
    expect(section(container, "分")).toBeTruthy();
    expect(container.textContent).toContain(
      "还缺：左手指法、徽位、右手指法、弦序",
    );
  });

  it("从按音切回散音会清掉左手指法与徽分", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);

    pick(container, "音色", "按");
    pick(container, "左手", "大");
    pick(container, "徽位", "九");
    pick(container, "分", "三分");
    pick(container, "右手", "勹");
    pick(container, "弦序", "五");
    expect(confirmBtn().disabled).toBe(false);

    // 切回散音：右手指法和弦序还在，所以仍可确认，但左手三项必须清空
    pick(container, "音色", "散");
    fireEvent.click(confirmBtn());

    const note = onAppend.mock.calls[0][0] as NoteColumn;
    expect(note.jianzi.toneType).toBe("散");
    expect(note.jianzi.leftFinger).toBeNull();
    expect(note.jianzi.hui).toBeNull();
    expect(note.jianzi.fen).toBeNull();
    expect(note.jianzi.rightAction).toBe("勹");
  });

  it("按音可以录入完整四要素", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);

    pick(container, "音色", "按");
    pick(container, "左手", "大");
    pick(container, "徽位", "九");
    pick(container, "分", "三分");
    pick(container, "右手", "勹");
    pick(container, "弦序", "五");
    fireEvent.click(confirmBtn());

    const note = onAppend.mock.calls[0][0] as NoteColumn;
    expect(note.jianzi).toEqual({
      toneType: "按",
      rhythmMode: null,
      leftFinger: "大",
      hui: "九",
      fen: "三分",
      rightAction: "勹",
      stringNumber: "五",
    });
  });

  it("乐理页签可以设置简谱、八度、附点与时值", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);

    fireEvent.click(screen.getByRole("button", { name: "乐理 · 时值" }));
    // 指法区被替换掉
    expect(() => section(container, "音色")).toThrow();

    pick(container, "简谱", "3");
    pick(container, "八度", "高");
    fireEvent.click(screen.getByRole("button", { name: "— 关闭" }));
    pick(container, "时值", "八分");

    fireEvent.click(screen.getByRole("button", { name: "琴艺 · 指法" }));
    pick(container, "右手", "勹");
    pick(container, "弦序", "五");
    fireEvent.click(confirmBtn());

    const note = onAppend.mock.calls[0][0] as NoteColumn;
    expect(note.jianpuNumber).toBe("3");
    expect(note.jianpuOctave).toBe("·");
    expect(note.jianpuDot).toBe(true);
    expect(note.duration).toBe("八分");
  });

  it("八度再点一次回到中音", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);

    fireEvent.click(screen.getByRole("button", { name: "乐理 · 时值" }));
    pick(container, "八度", "高");
    pick(container, "八度", "高");

    fireEvent.click(screen.getByRole("button", { name: "琴艺 · 指法" }));
    pick(container, "右手", "勹");
    pick(container, "弦序", "五");
    fireEvent.click(confirmBtn());

    expect((onAppend.mock.calls[0][0] as NoteColumn).jianpuOctave).toBe("");
  });

  it("编辑模式：按钮为「更新」、保留原 id、重置回到原值", () => {
    const onAppend = vi.fn();
    const original: NoteColumn = {
      id: "fixed-id",
      jianpuNumber: "5",
      jianpuOctave: ",",
      jianpuDot: true,
      duration: "八分",
      jianzi: {
        toneType: "散",
        rhythmMode: "板",
        leftFinger: null,
        hui: null,
        fen: null,
        rightAction: "勹",
        stringNumber: "五",
      },
    };
    const { container } = render(
      <JianzipuKeyboard onAppend={onAppend} defaultNote={original} />,
    );

    const update = screen.getByRole("button", { name: "更新" }) as HTMLButtonElement;
    expect(update.disabled).toBe(false);

    // 改一处再重置，应恢复原值
    pick(container, "弦序", "一");
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    fireEvent.click(update);

    const note = onAppend.mock.calls[0][0] as NoteColumn;
    expect(note.id).toBe("fixed-id");
    expect(note.jianzi.stringNumber).toBe("五");
    expect(note.jianzi.rhythmMode).toBe("板");
    expect(note.jianpuNumber).toBe("5");
    expect(note.jianpuOctave).toBe(",");
    expect(note.jianpuDot).toBe(true);
    expect(note.duration).toBe("八分");
  });

  it("拼音模式预填当前减字文本", () => {
    const original: NoteColumn = {
      id: "x",
      jianpuNumber: null,
      jianpuOctave: "",
      jianpuDot: false,
      duration: "四分",
      jianzi: {
        toneType: "散",
        rhythmMode: null,
        leftFinger: null,
        hui: null,
        fen: null,
        rightAction: "勹",
        stringNumber: "五",
      },
    };
    const { container } = render(<JianzipuKeyboard defaultNote={original} />);

    fireEvent.click(screen.getByRole("button", { name: "拼音" }));
    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    expect(input.value).toBe("散勾五");
  });

  it("拼音候选词点击后替换当前 token", () => {
    const { container } = render(<JianzipuKeyboard />);
    fireEvent.click(screen.getByRole("button", { name: "拼音" }));

    const input = container.querySelector("input[type='text']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "da" } });

    // da → 大 / 丁
    expect(screen.getByRole("button", { name: "大" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "丁" }));

    expect(input.value).toBe("丁 ");
  });

  it("空格选择首个候选，方向键 + 回车选择指定候选且不提交", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);
    fireEvent.click(screen.getByRole("button", { name: "拼音" }));
    const input = container.querySelector("input[type='text']") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "da" } });
    fireEvent.keyDown(input, { key: " " });
    expect(input.value).toBe("大 ");

    fireEvent.change(input, { target: { value: "da" } });
    // 初始 -1 → 下移一次到第 0 项（大）→ 再下移到第 1 项（丁）
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("丁 ");

    // 候选词选择走的是替换 token，不是成谱提交
    expect(onAppend).not.toHaveBeenCalled();
  });

  it("回车提交汉字解析结果，并清空输入", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);
    fireEvent.click(screen.getByRole("button", { name: "拼音" }));
    const input = container.querySelector("input[type='text']") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "散勾五" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAppend).toHaveBeenCalledTimes(1);
    const note = onAppend.mock.calls[0][0] as NoteColumn;
    expect(note.jianzi.toneType).toBe("散");
    expect(note.jianzi.rightAction).toBe("勾");
    expect(note.jianzi.stringNumber).toBe("五");
    expect(input.value).toBe("");
  });

  it("纯拼音解析不出减字时不追加空谱字，输入保留", () => {
    const onAppend = vi.fn();
    const { container } = render(<JianzipuKeyboard onAppend={onAppend} />);
    fireEvent.click(screen.getByRole("button", { name: "拼音" }));
    const input = container.querySelector("input[type='text']") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "da gou" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAppend).not.toHaveBeenCalled();
    expect(input.value).toBe("da gou");
  });

  it("拼音为空时提交按钮禁用", () => {
    render(<JianzipuKeyboard />);
    fireEvent.click(screen.getByRole("button", { name: "拼音" }));

    const submit = screen.getByRole("button", { name: "提交" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
