import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 纯前端模式（无后端）下的 api 行为。
 *
 * 线上 GitHub Pages 没有 Rust 后端，`isBrowserOnlyMode()` 会为 true，
 * 此时列表过滤 / 排序 / CRUD 全部落到 localStorage。这条分支此前没有测试，
 * 一旦改坏，线上「拼—听—存—取」会整条断掉，而服务器模式测试全绿、完全看不出来。
 */

const STORAGE_KEY = "taiyin.scores.v1";

/** 预置本地曲谱。时间刻意错开，用来验证排序而不是碰巧。 */
function seed() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      {
        id: "g",
        title: "广陵散",
        notes: [],
        tuning: "zhengdiao",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        favorites_count: 2,
      },
      {
        id: "p",
        title: "平沙落雁",
        notes: [],
        tuning: "ruibin",
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        favorites_count: 5,
      },
      {
        id: "l",
        title: "流水",
        notes: [],
        tuning: "zhengdiao",
        created_at: "2026-01-03T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
        favorites_count: 0,
      },
    ]),
  );
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  // 非 localhost 域名 + 未配置后端 = 纯前端模式。
  // 只替换 hostname，其余字段代码并不读取。
  vi.stubGlobal("location", { hostname: "taiyin.example.github.io" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("api: 纯前端模式判定", () => {
  it("非 localhost 且无后端时走浏览器存储", async () => {
    const { isBrowserOnlyMode, scoreStorageMode } = await import("@/lib/api");
    expect(isBrowserOnlyMode()).toBe(true);
    expect(scoreStorageMode()).toBe("browser");
  });
});

describe("api: 纯前端模式列表过滤", () => {
  it("关键词按曲名子串匹配，且会去掉首尾空白", async () => {
    seed();
    const { listScoresPage } = await import("@/lib/api");

    const page = await listScoresPage({ query: "  广陵  " });

    expect(page.items.map((s) => s.id)).toEqual(["g"]);
    expect(page.total).toBe(1);
  });

  it("关键词无匹配时返回空列表，而不是把全部返回", async () => {
    seed();
    const { listScoresPage } = await import("@/lib/api");

    const page = await listScoresPage({ query: "不存在的曲子" });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("空关键词不过滤（等价于不传）", async () => {
    seed();
    const { listScoresPage } = await import("@/lib/api");

    const page = await listScoresPage({ query: "   " });

    expect(page.items).toHaveLength(3);
  });

  it("定弦过滤只留该定弦", async () => {
    seed();
    const { listScoresPage } = await import("@/lib/api");

    const page = await listScoresPage({ tuning: "ruibin" });

    expect(page.items.map((s) => s.id)).toEqual(["p"]);
  });

  it("非法定弦被忽略，不会把列表误筛成空", async () => {
    seed();
    const { listScoresPage } = await import("@/lib/api");

    const page = await listScoresPage({ tuning: "youma" as never });

    expect(page.items).toHaveLength(3);
  });

  it("热度排序按收藏数降序，收藏数相同再按更新时间", async () => {
    seed();
    const { listScoresPage } = await import("@/lib/api");

    const page = await listScoresPage({ sort: "popular" });

    expect(page.items.map((s) => s.id)).toEqual(["p", "g", "l"]);
  });

  it("收藏数相同或缺失时退回更新时间倒序，且不因 undefined 崩", async () => {
    // 收藏数打平时必须再给一个稳定的次序，否则同一份数据每次刷新顺序都可能变；
    // 旧存档没有 favorites_count，缺失值按 0 处理。
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "old",
          title: "旧存档",
          notes: [],
          tuning: "zhengdiao",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "tie-new",
          title: "同分较新",
          notes: [],
          tuning: "zhengdiao",
          created_at: "2026-01-03T00:00:00.000Z",
          updated_at: "2026-01-03T00:00:00.000Z",
          favorites_count: 3,
        },
        {
          id: "tie-old",
          title: "同分较旧",
          notes: [],
          tuning: "zhengdiao",
          created_at: "2026-01-02T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          favorites_count: 3,
        },
      ]),
    );
    const { listScoresPage } = await import("@/lib/api");

    const page = await listScoresPage({ sort: "popular" });

    expect(page.items.map((s) => s.id)).toEqual(["tie-new", "tie-old", "old"]);
  });

  it("默认排序按更新时间倒序", async () => {
    seed();
    const { listScoresPage } = await import("@/lib/api");

    const page = await listScoresPage();

    expect(page.items.map((s) => s.id)).toEqual(["l", "p", "g"]);
  });

  it("本地列表取全量后立即停止循环（不会空转 50 页）", async () => {
    seed();
    const { listScores } = await import("@/lib/api");

    const all = await listScores();

    expect(all).toHaveLength(3);
  });
});

describe("api: 纯前端模式 CRUD 落本地", () => {
  it("create → get → update → delete 全程不碰网络", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { createScore, getScore, updateScore, deleteScore, listScores } =
      await import("@/lib/api");

    const created = await createScore("流水", []);
    expect(created.title).toBe("流水");
    expect(created.tuning).toBe("zhengdiao");

    const fetched = await getScore(created.id);
    expect(fetched.title).toBe("流水");

    const updated = await updateScore(created.id, { title: "流水（改）" });
    expect(updated.title).toBe("流水（改）");

    await deleteScore(created.id);
    expect(await listScores()).toEqual([]);
    // 纯前端模式下任何 CRUD 都不应该发请求
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
