import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NoteColumn } from "../types";
import {
  __resetLocalScoresForTests,
  getScoresSnapshot,
  getServerScoresSnapshot,
  localCreateScore,
  localDeleteScore,
  localGetScore,
  localListScores,
  localUpdateScore,
  subscribeScores,
} from "../local-score-store";
import { isBrowserOnlyMode, scoreStorageMode } from "../api";

const NOTES = [] as NoteColumn[];

beforeEach(() => {
  window.localStorage.clear();
  __resetLocalScoresForTests();
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

  it("创建时记录定弦，未指定落正调", () => {
    expect(localCreateScore("默认", NOTES).tuning).toBe("zhengdiao");
    expect(localCreateScore("紧五弦", NOTES, "ruibin").tuning).toBe("ruibin");
    expect(localGetScore(localCreateScore("慢三弦", NOTES, "manjiao").id).tuning).toBe("manjiao");
  });

  it("更新定弦；不传 tuning 时保留原值", () => {
    const created = localCreateScore("原调", NOTES, "zhengdiao");
    expect(localUpdateScore(created.id, { tuning: "ruibin" }).tuning).toBe("ruibin");
    expect(localUpdateScore(created.id, { title: "改名" }).tuning).toBe("ruibin");
  });

  it("旧存档没有 tuning 字段时补成正调，不丢整条记录", () => {
    // 早期版本曲谱没有定弦字段（那时只有正调可用）。
    // 这里直接绕过 API 写原始 JSON，模拟真实的旧数据。
    window.localStorage.setItem(
      "taiyin.scores.v1",
      JSON.stringify([
        { id: "legacy-1", title: "旧谱", notes: [], created_at: "t", updated_at: "t" },
      ]),
    );
    const list = localListScores();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("旧谱");
    expect(list[0].tuning).toBe("zhengdiao");
  });

  it("存档里的定弦是坏值时也补成正调", () => {
    window.localStorage.setItem(
      "taiyin.scores.v1",
      JSON.stringify([{ id: "x", title: "坏调", notes: [], tuning: "youma" }]),
    );
    expect(localListScores()[0].tuning).toBe("zhengdiao");
  });
});

describe("订阅（useSyncExternalStore 用）", () => {
  it("服务端快照恒为空，避免水合不一致", () => {
    localCreateScore("有谱", NOTES);
    expect(getScoresSnapshot()).toHaveLength(1);
    expect(getServerScoresSnapshot()).toEqual([]);
  });

  it("写入后通知订阅者，退订后不再收到", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeScores(() => seen.push(getScoresSnapshot().length));

    expect(getScoresSnapshot()).toEqual([]);

    const created = localCreateScore("新谱", NOTES);
    expect(seen).toEqual([1]);

    localUpdateScore(created.id, { title: "改名" });
    expect(seen).toEqual([1, 1]);

    localDeleteScore(created.id);
    expect(seen).toEqual([1, 1, 0]);

    unsubscribe();
    localCreateScore("退订后", NOTES);
    expect(seen).toEqual([1, 1, 0]);
  });

  it("快照引用稳定：未写入时反复读取是同一个数组", () => {
    localCreateScore("稳定", NOTES);
    const first = getScoresSnapshot();
    expect(getScoresSnapshot()).toBe(first);

    localCreateScore("再写一首", NOTES);
    expect(getScoresSnapshot()).not.toBe(first);
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
