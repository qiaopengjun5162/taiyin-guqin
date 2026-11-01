import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NoteColumn } from "../types";
import {
  localCreateScore,
  localDeleteScore,
  localGetScore,
  localListScores,
  localUpdateScore,
} from "../local-score-store";
import { isBrowserOnlyMode, scoreStorageMode } from "../api";

const NOTES = [] as NoteColumn[];

beforeEach(() => {
  window.localStorage.clear();
});

describe("local-score-store（纯前端模式曲谱存储）", () => {
  it("创建后能列出，且带 id 与时间戳", () => {
    const created = localCreateScore(" 平沙落雁 ", NOTES);
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("平沙落雁");
    expect(created.created_at).toBe(created.updated_at);

    const list = localListScores();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
  });

  it("标题为空时回落为「未命名曲谱」", () => {
    expect(localCreateScore("   ", NOTES).title).toBe("未命名曲谱");
  });

  it("列表按 updated_at 倒序（最近改的在前）", async () => {
    const first = localCreateScore("旧曲", NOTES);
    await new Promise((r) => setTimeout(r, 5));
    const second = localCreateScore("新曲", NOTES);

    expect(localListScores().map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it("按 id 读取；不存在时抛错", () => {
    const created = localCreateScore("阳关三叠", NOTES);
    expect(localGetScore(created.id).title).toBe("阳关三叠");
    expect(() => localGetScore("no-such-id")).toThrow("曲谱不存在");
  });

  it("更新标题与音符，并刷新 updated_at", async () => {
    const created = localCreateScore("原名", NOTES);
    await new Promise((r) => setTimeout(r, 5));

    const updated = localUpdateScore(created.id, { title: "新名" });
    expect(updated.title).toBe("新名");
    expect(updated.created_at).toBe(created.created_at);
    expect(updated.updated_at >= created.updated_at).toBe(true);
    expect(localGetScore(created.id).title).toBe("新名");
  });

  it("更新时标题留空则保留旧标题；只传 notes 时不动标题", () => {
    const created = localCreateScore("保留名", NOTES);
    expect(localUpdateScore(created.id, { title: "  " }).title).toBe("保留名");
    expect(localUpdateScore(created.id, { notes: [] }).title).toBe("保留名");
  });

  it("更新不存在的曲谱抛错", () => {
    expect(() => localUpdateScore("ghost", { title: "x" })).toThrow("曲谱不存在");
  });

  it("删除后列表不再包含它", () => {
    const a = localCreateScore("A", NOTES);
    const b = localCreateScore("B", NOTES);
    localDeleteScore(a.id);
    expect(localListScores().map((s) => s.id)).toEqual([b.id]);
    expect(() => localDeleteScore("ghost")).not.toThrow();
  });

  it("本地存储不可用时报错，不静默丢数据", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(() => localCreateScore("存不下", NOTES)).toThrow("本地存储");
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  it("存储内容损坏时按空列表处理，不抛错", () => {
    window.localStorage.setItem("taiyin.scores.v1", "{not-json");
    expect(localListScores()).toEqual([]);
    window.localStorage.setItem("taiyin.scores.v1", '"string"');
    expect(localListScores()).toEqual([]);
  });
});

describe("isBrowserOnlyMode（静态站点判定）", () => {
  const originalLocation = window.location;

  function setHost(hostname: string) {
    Object.defineProperty(window, "location", {
      value: { hostname } as Location,
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    vi.unstubAllEnvs();
  });

  it("部署在 github.io 等静态站点时走纯前端模式", () => {
    setHost("qiaopengjun5162.github.io");
    expect(isBrowserOnlyMode()).toBe(true);
    expect(scoreStorageMode()).toBe("browser");
  });

  it("本机开发（localhost / 127.0.0.1）走后端", () => {
    setHost("localhost");
    expect(isBrowserOnlyMode()).toBe(false);
    setHost("127.0.0.1");
    expect(isBrowserOnlyMode()).toBe(false);
    expect(scoreStorageMode()).toBe("server");
  });

  it("显式配置了 NEXT_PUBLIC_API_URL 时始终走后端", () => {
    setHost("qiaopengjun5162.github.io");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    expect(isBrowserOnlyMode()).toBe(false);
  });
});
