/**
 * `Puzi` 绑定层的真实产物黄金样例。
 *
 * 核心侧的 11 条 Rust 单测验的是 Rust 自己；这里用**提交的 .wasm 产物**跑同一组
 * 输入，确认桥接把结果原样送到了网页/小程序/App 那一侧。
 * 不走替身：替身会和 Rust 一起错，真实产物不会。
 *
 * 这一轮只验「能存、能数、能安全压回单音」——录入与渲染还没接，
 * 所以不要用这份测试去推断「撮式已经能画出来」。
 */
import { beforeAll, describe, it, expect } from "vitest";
import { loadRealWasm } from "@/lib/__tests__/load-wasm";
import { getWasmSync } from "@/lib/taiyin-wasm";

beforeAll(loadRealWasm);

const sanGouSan = {
  note_type: "散",
  left_finger: null,
  hui: null,
  right_action: "Gou",
  string_number: 3,
  compound: null,
  ornaments: [],
  rhythm_mode: "板",
  duration: 1,
  structure_mark: null,
};

const sanTiaoWu = { ...sanGouSan, right_action: "Tiao", string_number: 5 };

function score(notes: unknown[]) {
  return {
    title: "测试谱",
    author: "",
    tuning: "ZhengDiao",
    beat_numerator: 4,
    beat_denominator: 4,
    bpm: 80,
    version: 1,
    notes,
  };
}

function summary(notes: unknown[]) {
  return JSON.parse(
    getWasmSync().score_puzi_summary(JSON.stringify(score(notes))),
  ) as {
    total: number;
    simple: number;
    cuochuo: number;
    annotation: number;
    standalone: number;
    error?: string;
  };
}

describe("Puzi · 真实 WASM 的谱字计数", () => {
  it("两个新导出确实在产物里（不是只改了 Rust 源码）", () => {
    expect(typeof getWasmSync().score_puzi_summary).toBe("function");
    expect(typeof getWasmSync().puzi_to_note).toBe("function");
  });

  it("旧谱的裸音符全数落 simple，一条不多一条不少", () => {
    expect(summary([sanGouSan, sanTiaoWu])).toEqual({
      total: 2, simple: 2, cuochuo: 0, annotation: 0, standalone: 0,
    });
  });

  it("四种形式混排时逐类数对", () => {
    expect(summary([
      sanGouSan,
      { first: sanGouSan, second: sanTiaoWu },
      { note: sanTiaoWu, moves: [] },
      { mark: "少息" },
    ])).toEqual({
      total: 4, simple: 1, cuochuo: 1, annotation: 1, standalone: 1,
    });
  });

  it("坏 JSON 给 error，不把整页打崩", () => {
    const out = JSON.parse(getWasmSync().score_puzi_summary("not json")) as {
      error?: string;
    };
    expect(out.error).toContain("解析失败");
  });
});

describe("Puzi · 压回单音的降级边界", () => {
  function toNote(puzi: unknown) {
    return JSON.parse(
      getWasmSync().puzi_to_note(JSON.stringify({ puzi })),
    ) as { note?: unknown; error?: string };
  }

  it("简单形式压回原音符，逐字段一致", () => {
    expect(toNote(sanGouSan)).toEqual({ note: sanGouSan });
  });

  it("撮式拒绝压回：不悄悄只留第一个发声点", () => {
    const out = toNote({ first: sanGouSan, second: sanTiaoWu });
    expect(out.note).toBeUndefined();
    expect(out.error).toContain("两个发声点");
  });

  it("旁注与独体同样拒绝，错误说明原因", () => {
    expect(toNote({ note: sanGouSan, moves: [] }).error).toContain("走手落点");
    expect(toNote({ mark: "少息" }).error).toContain("不发声");
  });

  it("坏 JSON 给 error", () => {
    const out = JSON.parse(getWasmSync().puzi_to_note("not json")) as {
      error?: string;
    };
    expect(out.error).toContain("解析失败");
  });
});
