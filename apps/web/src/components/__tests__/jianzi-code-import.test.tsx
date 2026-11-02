/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianziCodeImport } from "@/components/jianzi-code-import";
import type { NoteColumn } from "@/lib/types";

// 切词与解码已在 Rust（jianzi_code::decode_batch_json）+ verify-wasm 覆盖，
// 这里只验接线：粘进去的文本是否原样送给 Rust、结果是否按音高建成音符列、
// 坏码是否单独回显而不连坐。

const decodeJianziBatch = vi.fn();

vi.mock("@/lib/taiyin-wasm", () => ({
  useWasmInit: () => ({ state: "ready" as const, error: null }),
  decodeJianziBatch: (text: string) => decodeJianziBatch(text),
}));

function st(p: Record<string, unknown>) {
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

const SAN_GOU_SAN = st({ toneType: "散", rightAction: "勾", stringNumber: "三" });
const AN_DA_9_GOU_4 = st({
  toneType: "按",
  leftFinger: "大",
  hui: "九",
  rightAction: "勾",
  stringNumber: "四",
});

/** 正常两解一坏，模拟 Rust 端的返回形状（第二条带八分附点）。 */
const MIXED = {
  total: 3,
  ok: 2,
  failed: 1,
  entries: [
    {
      code: "sg3:4",
      state: SAN_GOU_SAN,
      error: null,
      duration: "四分",
      dotted: false,
      isRest: false,
    },
    {
      code: "ad9g4:8.",
      state: AN_DA_9_GOU_4,
      error: null,
      duration: "八分",
      dotted: true,
      isRest: false,
    },
    {
      code: "d9g4",
      state: null,
      error: "码要以音色前缀开头（s/f/a）：d9g4",
      duration: null,
      dotted: false,
      isRest: false,
    },
  ],
};

describe("减字码入谱", () => {
  beforeEach(() => {
    decodeJianziBatch.mockReset();
  });

  it("粘入的文本原样交给 Rust，解出的减字按顺序入谱", async () => {
    decodeJianziBatch.mockResolvedValue(MIXED);
    const onImport = vi.fn<(notes: NoteColumn[]) => void>();
    render(<JianziCodeImport onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("减字码"), {
      target: { value: "sg3 | ad9g4  d9g4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解析并加入曲谱" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(decodeJianziBatch).toHaveBeenCalledWith("sg3 | ad9g4  d9g4");

    const notes = onImport.mock.calls[0][0];
    expect(notes).toHaveLength(2);
    expect(notes[0].jianzi).toEqual(SAN_GOU_SAN);
    expect(notes[1].jianzi).toEqual(AN_DA_9_GOU_4);
    // 音高按正调反推（散勾三 = 三弦空弦 F2 = 1）
    expect(notes[0].jianpuNumber).toBe("1");
    expect(notes[0].jianpuOctave).toBe("");
    // 时值跟码走：`:8.` 就是八分附点，不是一片四分
    expect(notes[0].duration).toBe("四分");
    expect(notes[0].jianpuDot).toBe(false);
    expect(notes[1].duration).toBe("八分");
    expect(notes[1].jianpuDot).toBe(true);
    // 泛/按的音高也必须有值，不能整行留空
    expect(notes[1].jianpuNumber).not.toBeNull();
  });

  it("坏码单条报原因，好码照常入谱", async () => {
    decodeJianziBatch.mockResolvedValue(MIXED);
    const onImport = vi.fn();
    render(<JianziCodeImport onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("减字码"), { target: { value: "sg3 ad9g4 d9g4" } });
    fireEvent.click(screen.getByRole("button", { name: "解析并加入曲谱" }));

    await waitFor(() => expect(screen.getByText(/已入谱 2 个音符/)).toBeInTheDocument());
    expect(screen.getByText(/1 条码读不通/)).toBeInTheDocument();
    expect(screen.getByText(/码要以音色前缀开头/)).toBeInTheDocument();
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("休止符 r 也入谱：占拍、减字为空、不算坏码", async () => {
    decodeJianziBatch.mockResolvedValue({
      total: 2,
      ok: 2,
      failed: 0,
      entries: [
        {
          code: "sg3:4",
          state: SAN_GOU_SAN,
          error: null,
          duration: "四分",
          dotted: false,
          isRest: false,
        },
        {
          code: "r:2",
          state: null,
          error: null,
          duration: "二分",
          dotted: false,
          isRest: true,
        },
      ],
    });
    const onImport = vi.fn<(notes: NoteColumn[]) => void>();
    render(<JianziCodeImport onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("减字码"), { target: { value: "sg3:4 r:2" } });
    fireEvent.click(screen.getByRole("button", { name: "解析并加入曲谱" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const notes = onImport.mock.calls[0][0];
    expect(notes).toHaveLength(2);
    expect(notes[1].jianpuNumber).toBe("0");
    expect(notes[1].duration).toBe("二分");
    expect(notes[1].jianzi.toneType).toBeNull();
    // 休止不是「读不通」，不能出现在错误列表里
    expect(screen.getByText(/其中休止 1/)).toBeInTheDocument();
    expect(screen.queryByText(/读不通/)).not.toBeInTheDocument();
  });

  it("全部读不通时不往谱里加东西", async () => {
    decodeJianziBatch.mockResolvedValue({
      total: 1,
      ok: 0,
      failed: 1,
      entries: [{ code: "d9g4", state: null, error: "码要以音色前缀开头（s/f/a）：d9g4" }],
    });
    const onImport = vi.fn();
    render(<JianziCodeImport onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("减字码"), { target: { value: "d9g4" } });
    fireEvent.click(screen.getByRole("button", { name: "解析并加入曲谱" }));

    await waitFor(() => expect(screen.getByText(/没有可入谱的减字/)).toBeInTheDocument());
    expect(onImport).not.toHaveBeenCalled();
  });

  it("空文本不发请求，直接提示", async () => {
    const onImport = vi.fn();
    render(<JianziCodeImport onImport={onImport} />);

    fireEvent.click(screen.getByRole("button", { name: "解析并加入曲谱" }));

    expect(await screen.findByText(/先粘一段码进来/)).toBeInTheDocument();
    expect(decodeJianziBatch).not.toHaveBeenCalled();
  });

  it("Rust 侧整体报错（一个码都没切出来）时展示原因", async () => {
    decodeJianziBatch.mockRejectedValue(new Error("没找到可解析的减字码"));
    render(<JianziCodeImport onImport={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("减字码"), { target: { value: "共 12 音" } });
    fireEvent.click(screen.getByRole("button", { name: "解析并加入曲谱" }));

    expect(await screen.findByText(/没找到可解析的减字码/)).toBeInTheDocument();
  });

  it("「填入示例」给出一串可直接解析的码", () => {
    render(<JianziCodeImport onImport={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "填入示例" }));
    expect((screen.getByLabelText("减字码") as HTMLTextAreaElement).value).toContain("ad9g4");
  });
});
