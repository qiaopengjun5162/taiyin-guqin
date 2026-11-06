/**
 * @vitest-environment jsdom
 *
 * 谱面排版偏好：持久化与"快照引用稳定"两件事最容易出错。
 *
 * 引用不稳定（每次调用返回新对象）会让 `useSyncExternalStore` 无限重渲染，
 * 症状是页面直接卡死而不是报错——所以专门钉住。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getLayoutPref,
  setLayoutPref,
  subscribeLayoutPref,
  resetLayoutPrefCache,
  getLayoutPrefServerSnapshot,
  DEFAULT_LAYOUT_PREF,
  DENSITY_GAP,
  DENSITY_PADDING,
  WIDTH_MAX_REM,
  LAYOUT_OPTIONS,
  DENSITY_OPTIONS,
  WIDTH_OPTIONS,
} from "../score-layout";

const KEY = "taiyin.scoreLayout.v1";

beforeEach(() => {
  window.localStorage.clear();
  resetLayoutPrefCache();
});

describe("默认值", () => {
  it("没存过时给默认排版", () => {
    expect(getLayoutPref()).toEqual(DEFAULT_LAYOUT_PREF);
  });

  it("服务端快照恒为默认值（避免 hydration mismatch）", () => {
    setLayoutPref({ layout: "equal" });
    expect(getLayoutPrefServerSnapshot()).toEqual(DEFAULT_LAYOUT_PREF);
    expect(getLayoutPrefServerSnapshot()).toBe(DEFAULT_LAYOUT_PREF);
  });

  it("三个布局选项都有 id / label / hint，供界面直接渲染", () => {
    expect(LAYOUT_OPTIONS.map((o) => o.id)).toEqual(["flow", "barline", "equal"]);
    for (const o of LAYOUT_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.hint.length).toBeGreaterThan(0);
    }
  });

  it("疏密与行宽档位齐全，且每个档位都有几何参数", () => {
    expect(DENSITY_OPTIONS.map((o) => o.id)).toEqual([
      "compact",
      "normal",
      "loose",
    ]);
    expect(WIDTH_OPTIONS.map((o) => o.id)).toEqual(["narrow", "normal", "wide"]);
    for (const o of DENSITY_OPTIONS) {
      expect(DENSITY_GAP[o.id]).toBeGreaterThan(0);
      expect(DENSITY_PADDING[o.id]).toBeGreaterThan(0);
    }
    for (const o of WIDTH_OPTIONS) {
      expect(WIDTH_MAX_REM[o.id]).toBeGreaterThan(0);
    }
    // 越疏朗间距越大，否则"疏朗"名不副实
    expect(DENSITY_GAP.compact).toBeLessThan(DENSITY_GAP.normal);
    expect(DENSITY_GAP.normal).toBeLessThan(DENSITY_GAP.loose);
    expect(WIDTH_MAX_REM.narrow).toBeLessThan(WIDTH_MAX_REM.normal);
    expect(WIDTH_MAX_REM.normal).toBeLessThan(WIDTH_MAX_REM.wide);
  });
});

describe("读写与持久化", () => {
  it("局部更新只改传入的字段", () => {
    setLayoutPref({ layout: "barline" });
    expect(getLayoutPref()).toEqual({ ...DEFAULT_LAYOUT_PREF, layout: "barline" });
    setLayoutPref({ density: "loose" });
    expect(getLayoutPref()).toEqual({
      layout: "barline",
      density: "loose",
      width: DEFAULT_LAYOUT_PREF.width,
    });
  });

  it("写盘后重建缓存仍能读回", () => {
    setLayoutPref({ layout: "equal", width: "wide" });
    resetLayoutPrefCache();
    expect(getLayoutPref()).toEqual({
      layout: "equal",
      density: DEFAULT_LAYOUT_PREF.density,
      width: "wide",
    });
  });

  it("同一状态两次读取返回同一引用（useSyncExternalStore 的硬要求）", () => {
    const a = getLayoutPref();
    const b = getLayoutPref();
    expect(a).toBe(b);
    setLayoutPref({ layout: "equal" });
    const c = getLayoutPref();
    expect(c).toBe(getLayoutPref());
    expect(c).not.toBe(a);
  });

  it("订阅者在写入时被通知，退订后不再收到", () => {
    const fn = vi.fn();
    const off = subscribeLayoutPref(fn);
    setLayoutPref({ layout: "equal" });
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setLayoutPref({ layout: "flow" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("脏数据防御", () => {
  it("半截 JSON 当作没设置过", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(getLayoutPref()).toEqual(DEFAULT_LAYOUT_PREF);
  });

  it("非法枚举值逐字段回退，不牵连其它字段", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ layout: "diagonal", density: "loose", width: "wide" }),
    );
    const pref = getLayoutPref();
    expect(pref.layout).toBe(DEFAULT_LAYOUT_PREF.layout);
    // 合法的字段必须保住——整体回退会让用户已选的密度也丢
    expect(pref.density).toBe("loose");
    expect(pref.width).toBe("wide");
  });

  it("老版本存的对象缺新字段时，缺的那个走默认", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ layout: "barline" }));
    expect(getLayoutPref()).toEqual({
      layout: "barline",
      density: DEFAULT_LAYOUT_PREF.density,
      width: DEFAULT_LAYOUT_PREF.width,
    });
  });
});
