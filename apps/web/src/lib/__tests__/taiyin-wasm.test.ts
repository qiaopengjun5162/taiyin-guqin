/**
 * @vitest-environment jsdom
 *
 * WASM 桥接层测试：初始化状态机（幂等/并发/失败重试）、翻译透传、hook 订阅。
 *
 * 真实 WASM 产物的契约验证由 CI 的 scripts/verify-wasm.mjs 守（非 mock），
 * 这里只验证 TS 侧的加载编排，因此把动态导入的 glue 换成替身。
 * 隔离方式：vi.resetModules + 动态 import —— 模块级单例状态不能跨用例共享。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { EMPTY_FILTER } from "@/lib/jianzi-dictionary-types";

const glue = vi.hoisted(() => ({
  init: vi.fn(),
  translate_jianpu_to_jianzi: vi.fn(),
  translate_jianpu_sequence_to_jianzi: vi.fn(),
  get_jianzi_dictionary: vi.fn(),
  encode_jianzi_batch: vi.fn(),
  decode_jianzi_batch: vi.fn(),
  analyze_jianzi_frequency: vi.fn(),
  get_jianzi_variant_groups: vi.fn(),
}));

vi.mock("@/wasm/taiyin_core", () => ({
  default: glue.init,
  translate_jianpu_to_jianzi: glue.translate_jianpu_to_jianzi,
  translate_jianpu_sequence_to_jianzi: glue.translate_jianpu_sequence_to_jianzi,
  get_jianzi_dictionary: glue.get_jianzi_dictionary,
  encode_jianzi_batch: glue.encode_jianzi_batch,
  decode_jianzi_batch: glue.decode_jianzi_batch,
  analyze_jianzi_frequency: glue.analyze_jianzi_frequency,
  get_jianzi_variant_groups: glue.get_jianzi_variant_groups,
}));

type Wasm = typeof import("@/lib/taiyin-wasm");

/** 重新加载被测模块，拿到一份干净的单例状态。 */
async function loadWasm(): Promise<Wasm> {
  vi.resetModules();
  return import("@/lib/taiyin-wasm");
}

beforeEach(() => {
  glue.init.mockReset();
  glue.translate_jianpu_to_jianzi.mockReset();
  glue.translate_jianpu_sequence_to_jianzi.mockReset();
  glue.get_jianzi_dictionary.mockReset();
  glue.encode_jianzi_batch.mockReset();
  glue.decode_jianzi_batch.mockReset();
  glue.analyze_jianzi_frequency.mockReset();
  glue.get_jianzi_variant_groups.mockReset();
  glue.init.mockResolvedValue(undefined);
});

describe("taiyin-wasm · 初始化状态机", () => {
  it("初始 idle，initWasm 成功后 ready 并缓存实例", async () => {
    const w = await loadWasm();
    expect(w.getWasmLoadState()).toBe("idle");
    expect(w.getWasmLoadError()).toBeNull();

    await w.initWasm();

    expect(w.getWasmLoadState()).toBe("ready");
    expect(glue.init).toHaveBeenCalledTimes(1);
    // 必须显式传 wasm 路径：打包后 import.meta.url 指向 chunk，自动解析会 404。
    // 而且要是绝对路径——相对路径在无尾斜杠的地址下会丢 basePath。
    expect(glue.init).toHaveBeenCalledWith(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/wasm/taiyin_core_bg.wasm`,
    );
  });

  it("已 ready 后再 initWasm 不重复加载", async () => {
    const w = await loadWasm();
    await w.initWasm();
    await w.initWasm();
    expect(glue.init).toHaveBeenCalledTimes(1);
  });

  it("并发 initWasm 只加载一次", async () => {
    const w = await loadWasm();
    await Promise.all([w.initWasm(), w.initWasm(), w.initWasm()]);
    expect(glue.init).toHaveBeenCalledTimes(1);
    expect(w.getWasmLoadState()).toBe("ready");
  });

  it("加载失败置为 error 并抛出原错误，可再次重试", async () => {
    const w = await loadWasm();
    glue.init.mockRejectedValueOnce(new Error("wasm 404"));

    await expect(w.initWasm()).rejects.toThrow("wasm 404");
    expect(w.getWasmLoadState()).toBe("error");
    expect(w.getWasmLoadError()?.message).toBe("wasm 404");

    // 失败后 loadPromise 已清空，重试能走通
    await w.initWasm();
    expect(w.getWasmLoadState()).toBe("ready");
    expect(w.getWasmLoadError()).toBeNull();
  });

  it("非 Error 抛出物会被包装成 Error", async () => {
    const w = await loadWasm();
    glue.init.mockRejectedValueOnce("boom");

    await expect(w.initWasm()).rejects.toThrow("boom");
    expect(w.getWasmLoadError()).toBeInstanceOf(Error);
    expect(w.getWasmLoadError()?.message).toBe("boom");
  });
});

describe("taiyin-wasm · 翻译透传", () => {
  it("translateJianpuToJianzi 惰性初始化后透传结果", async () => {
    const w = await loadWasm();
    glue.translate_jianpu_to_jianzi.mockReturnValue('{"candidates":[]}');

    const out = await w.translateJianpuToJianzi('{"number":5}');

    expect(out).toBe('{"candidates":[]}');
    expect(glue.translate_jianpu_to_jianzi).toHaveBeenCalledWith('{"number":5}');
    expect(glue.init).toHaveBeenCalledTimes(1); // 顺带初始化
    expect(w.getWasmLoadState()).toBe("ready");
  });

  it("translateJianpuSequenceToJianzi 同样透传", async () => {
    const w = await loadWasm();
    glue.translate_jianpu_sequence_to_jianzi.mockReturnValue("SEQ");

    expect(await w.translateJianpuSequenceToJianzi("1 2 3")).toBe("SEQ");
    expect(glue.translate_jianpu_sequence_to_jianzi).toHaveBeenCalledWith("1 2 3");
  });

  it("初始化失败时翻译调用一并抛错", async () => {
    const w = await loadWasm();
    glue.init.mockRejectedValue(new Error("wasm 缺失"));

    await expect(w.translateJianpuToJianzi("{}")).rejects.toThrow("wasm 缺失");
    expect(glue.translate_jianpu_to_jianzi).not.toHaveBeenCalled();
  });
});

describe("taiyin-wasm · useWasmInit", () => {
  it("挂载时自动初始化，状态随加载流转，卸载后退订", async () => {
    const w = await loadWasm();
    let resolveInit: () => void = () => {};
    glue.init.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInit = resolve;
        }),
    );

    const { result, unmount } = renderHook(() => w.useWasmInit());
    // effect 已触发 initWasm，状态进入 loading
    await waitFor(() => expect(result.current.state).toBe("loading"));

    await act(async () => {
      resolveInit();
    });
    await waitFor(() => expect(result.current.state).toBe("ready"));

    unmount();
    // 卸载后 listener 已移除，后续 setState 不应报错或泄漏
    await act(async () => {
      await w.initWasm(); // 幂等，无实际变化
    });
    expect(w.getWasmLoadState()).toBe("ready");
  });

  it("加载失败时 hook 暴露 error 状态", async () => {
    const w = await loadWasm();
    glue.init.mockRejectedValue(new Error("wasm 404"));

    const { result } = renderHook(() => w.useWasmInit());

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error?.message).toBe("wasm 404");
  });
});

/**
 * 字典 / 编码 / 解码 / 字频 / 变体这五条通道全是「Rust 算、前端接线」，
 * 前端唯一要保证的是：把 JSON 原样送过去、把回来的状态补成前端形状。
 * 这里逐条钉住字段映射与错误分支——少一个 `rhythmMode` 或把 `null` 吞掉，
 * UI 侧就是空白或静默少录一个字。
 */
describe("taiyin-wasm · 字典与减字码", () => {
  const entry = {
    id: "san-gou-san",
    state: {
      toneType: "散",
      leftFinger: null,
      hui: null,
      fen: null,
      slide: null,
      rightAction: "勾",
      stringNumber: "三",
    },
    note: "散音勾三弦",
    common: true,
    code: "sg3",
    searchText: "散 勾 三 sg3",
  };

  it("getJianziDictionary 把筛选条件原样送 Rust，并补上 rhythmMode", async () => {
    const w = await loadWasm();
    glue.get_jianzi_dictionary.mockReturnValue(JSON.stringify({ total: 1, entries: [entry] }));

    const out = await w.getJianziDictionary({ ...EMPTY_FILTER, tone: "散" });

    expect(glue.get_jianzi_dictionary).toHaveBeenCalledWith(
      JSON.stringify({ ...EMPTY_FILTER, tone: "散" }),
    );
    expect(out.total).toBe(1);
    expect(out.entries[0].code).toBe("sg3");
    expect(out.entries[0].state.rhythmMode).toBeNull();
    expect(out.entries[0].state.rightAction).toBe("勾");
  });

  it("encodeJianziBatch 只送码表需要的字段，未填音色按散音", async () => {
    const w = await loadWasm();
    glue.encode_jianzi_batch.mockReturnValue(JSON.stringify({ codes: ["sg3", null] }));

    const codes = await w.encodeJianziBatch([
      { ...entry.state, rhythmMode: null } as never,
    ]);

    expect(codes).toEqual(["sg3", null]);
    const payload = JSON.parse(glue.encode_jianzi_batch.mock.calls[0][0]);
    expect(payload.notes[0].toneType).toBe("散");
    expect(payload.notes[0]).not.toHaveProperty("rhythmMode");
  });

  it("encodeJianziBatch 遇到整体报错抛异常，缺 codes 时返回空数组", async () => {
    const w = await loadWasm();
    glue.encode_jianzi_batch.mockReturnValue(JSON.stringify({ error: "输入不是数组" }));
    await expect(w.encodeJianziBatch([])).rejects.toThrow("输入不是数组");

    glue.encode_jianzi_batch.mockReturnValue("{}");
    expect(await w.encodeJianziBatch([])).toEqual([]);
  });

  it("decodeJianziBatch 透传时值/附点/休止，坏码保留原因", async () => {
    const w = await loadWasm();
    glue.decode_jianzi_batch.mockReturnValue(
      JSON.stringify({
        total: 2,
        ok: 1,
        failed: 1,
        entries: [
          { code: "sg3:8.", state: entry.state, error: null, duration: "八分", dotted: true, isRest: false },
          { code: "d9g4", state: null, error: "码要以音色前缀开头（s/f/a）：d9g4" },
        ],
      }),
    );

    const out = await w.decodeJianziBatch("sg3:8. d9g4");

    expect(out).toMatchObject({ total: 2, ok: 1, failed: 1 });
    expect(out.entries[0].state?.rhythmMode).toBeNull();
    expect(out.entries[0].duration).toBe("八分");
    expect(out.entries[0].dotted).toBe(true);
    // 缺字段的那条按「不是休止、没有时值」补齐，而不是抛错
    expect(out.entries[1]).toMatchObject({ state: null, error: expect.stringContaining("音色前缀") });
    expect(out.entries[1].duration).toBeNull();
    expect(out.entries[1].isRest).toBe(false);
  });

  it("decodeJianziBatch 整体报错（比如没找到码）抛异常", async () => {
    const w = await loadWasm();
    glue.decode_jianzi_batch.mockReturnValue(JSON.stringify({ error: "没找到可解析的减字码" }));
    await expect(w.decodeJianziBatch("随便写点中文")).rejects.toThrow("没找到可解析的减字码");
  });

  it("analyzeJianziFrequency 过滤掉没有音色的空列，再送回 Rust 统计", async () => {
    const w = await loadWasm();
    glue.analyze_jianzi_frequency.mockReturnValue(
      JSON.stringify({ total: 3, rows: [{ id: "勾", label: "散勾", count: 2, ratio: 0.667 }] }),
    );

    const out = await w.analyzeJianziFrequency([
      { ...entry.state, rhythmMode: null } as never,
      { toneType: null, leftFinger: null, hui: null, fen: null, slide: null, rightAction: null, stringNumber: null, rhythmMode: null } as never,
    ]);

    const payload = JSON.parse(glue.analyze_jianzi_frequency.mock.calls[0][0]);
    expect(payload.notes).toHaveLength(1);
    expect(out.total).toBe(3);
    expect(out.rows[0].id).toBe("勾");
  });

  it("analyzeJianziFrequency 报错时抛异常", async () => {
    const w = await loadWasm();
    glue.analyze_jianzi_frequency.mockReturnValue(JSON.stringify({ error: "格式错" }));
    await expect(w.analyzeJianziFrequency([])).rejects.toThrow("格式错");
  });

  it("getJianziVariantGroups 直接解析变体表", async () => {
    const w = await loadWasm();
    glue.get_jianzi_variant_groups.mockReturnValue(
      JSON.stringify([{ canonical: "勾", variants: ["勾", "勹"] }]),
    );
    expect(await w.getJianziVariantGroups()).toEqual([{ canonical: "勾", variants: ["勾", "勹"] }]);
  });
});
