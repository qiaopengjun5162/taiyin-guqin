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

const glue = vi.hoisted(() => ({
  init: vi.fn(),
  translate_jianpu_to_jianzi: vi.fn(),
  translate_jianpu_sequence_to_jianzi: vi.fn(),
}));

vi.mock("@/wasm/taiyin_core", () => ({
  default: glue.init,
  translate_jianpu_to_jianzi: glue.translate_jianpu_to_jianzi,
  translate_jianpu_sequence_to_jianzi: glue.translate_jianpu_sequence_to_jianzi,
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
    // 必须显式传 wasm 路径：打包后 import.meta.url 指向 chunk，自动解析会 404
    expect(glue.init).toHaveBeenCalledWith("wasm/taiyin_core_bg.wasm");
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
