/**
 * @vitest-environment jsdom
 *
 * 加载对话框：列表、按曲名搜索、定弦标注，以及「社区（只读）/ 本机」双 tab。
 *
 * 定弦出现在这里不是装饰——点下去会连定弦一起切，
 * 用户得先看见这首谱按哪种调式弹。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ScoreListItem } from "@/lib/api";
import { LoadDialog, type LoadDialogTab } from "../load-dialog";

afterEach(cleanup);

const LOCAL: ScoreListItem[] = [
  {
    id: "s1",
    title: "平沙落雁",
    tuning: "zhengdiao",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "s2",
    title: "潇湘水云",
    tuning: "ruibin",
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
  },
];

const COMMUNITY: ScoreListItem[] = [
  {
    id: "c1",
    title: "广陵散",
    tuning: "zhengdiao",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  },
];

const tabs: LoadDialogTab[] = [
  { key: "community", label: "社区曲谱", scores: COMMUNITY, readOnly: true },
  { key: "local", label: "本机", scores: LOCAL },
];

function renderDialog(tabs: LoadDialogTab[], overrides: Partial<Parameters<typeof LoadDialog>[0]> = {}) {
  const onLoad = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <LoadDialog open tabs={tabs} onLoad={onLoad} onDelete={onDelete} onClose={onClose} {...overrides} />,
  );
  return { ...utils, onLoad, onDelete, onClose };
}

describe("LoadDialog · 单 tab 列表与定弦", () => {
  it("单 tab 时显示标题而非 tab 条，并标注定弦", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    expect(screen.getByText("已保存的曲谱")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /社区曲谱/ })).toBeNull();
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getByText("正调")).toBeTruthy();
    expect(screen.getByText("蕤宾调")).toBeTruthy();
  });

  it("点一行把 (id, tabKey) 交给 onLoad", () => {
    const { onLoad } = renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    fireEvent.click(screen.getByText("潇湘水云"));
    expect(onLoad).toHaveBeenCalledWith("s2", "local");
  });

  it("没有曲谱时不显示搜索框，给出空态提示", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: [] }]);
    expect(screen.queryByLabelText("按曲名搜索")).toBeNull();
    expect(screen.getByText("暂无曲谱")).toBeTruthy();
  });

  it("清空搜索词后恢复完整列表", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    const input = screen.getByLabelText("按曲名搜索");
    fireEvent.change(input, { target: { value: "潇湘" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getByText("潇湘水云")).toBeTruthy();
  });
});

describe("LoadDialog · 双 tab（社区只读）", () => {
  it("显示两个 tab 及各自数量，默认激活第一个（社区）", () => {
    renderDialog(tabs);
    expect(screen.getByRole("button", { name: /社区曲谱/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /本机/ })).toBeTruthy();
    expect(screen.getByText("广陵散")).toBeTruthy();
    expect(screen.queryByText("平沙落雁")).toBeNull();
  });

  it("社区 tab 是只读，不显示删除按钮", () => {
    renderDialog(tabs);
    expect(screen.queryByTitle("删除")).toBeNull();
  });

  it("切到本机 tab 显示本地谱，并可删除", () => {
    renderDialog(tabs);
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getAllByTitle("删除").length).toBe(LOCAL.length);
  });

  it("从本机 tab 加载传 tabKey=local", () => {
    const { onLoad } = renderDialog(tabs);
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    fireEvent.click(screen.getByText("平沙落雁"));
    expect(onLoad).toHaveBeenCalledWith("s1", "local");
  });

  it("从社区 tab 加载传 tabKey=community", () => {
    const { onLoad } = renderDialog(tabs);
    fireEvent.click(screen.getByText("广陵散"));
    expect(onLoad).toHaveBeenCalledWith("c1", "community");
  });
});

describe("LoadDialog · 搜索", () => {
  it("按曲名过滤，只留匹配项", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    fireEvent.change(screen.getByLabelText("按曲名搜索"), { target: { value: "潇湘" } });
    expect(screen.getByText("潇湘水云")).toBeTruthy();
    expect(screen.queryByText("平沙落雁")).toBeNull();
  });

  it("没有匹配时给出带关键词的提示", () => {
    renderDialog([{ key: "local", label: "已保存的曲谱", scores: LOCAL }]);
    fireEvent.change(screen.getByLabelText("按曲名搜索"), { target: { value: "广陵散" } });
    expect(screen.getByText("没有匹配「广陵散」的曲谱")).toBeTruthy();
  });

  it("切换 tab 时清空搜索词，避免旧词跨分类串味", () => {
    renderDialog(tabs);
    const input = screen.getByLabelText("按曲名搜索");
    fireEvent.change(input, { target: { value: "广陵" } });
    expect(screen.getByText("广陵散")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    // 切 tab 后搜索被清空，本机谱全部恢复、社区谱消失
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.getByText("潇湘水云")).toBeTruthy();
    expect(screen.queryByText("广陵散")).toBeNull();
  });
});

describe("LoadDialog · 本机→社区迁移入口", () => {
  const tabsWithMigrate: LoadDialogTab[] = [
    { key: "community", label: "社区曲谱", scores: COMMUNITY, readOnly: true },
    { key: "local", label: "本机", scores: LOCAL, showMigrate: true },
  ];

  it("迁移按钮只属于本机 tab，社区 tab 不显示", () => {
    renderDialog(tabsWithMigrate);
    // 默认激活社区 tab：没有迁移入口
    expect(screen.queryByLabelText("一键发布本机谱到社区")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    expect(screen.getByLabelText("一键发布本机谱到社区")).toBeTruthy();
  });

  it("点击迁移按钮触发 onMigrate", () => {
    const onMigrate = vi.fn();
    renderDialog(tabsWithMigrate, { onMigrate });
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    fireEvent.click(screen.getByLabelText("一键发布本机谱到社区"));
    expect(onMigrate).toHaveBeenCalledTimes(1);
  });

  it("迁移中按钮禁用并显示「发布中…」", () => {
    renderDialog(tabsWithMigrate, { migrating: true });
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    const btn = screen.getByLabelText("一键发布本机谱到社区") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("发布中");
  });

  it("显示迁移结果提示", () => {
    renderDialog(tabsWithMigrate, { migrateMsg: "已发布 2 首到社区" });
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    expect(screen.getByText("已发布 2 首到社区")).toBeTruthy();
  });

  it("未开启 showMigrate 的本机 tab 不显示迁移按钮", () => {
    renderDialog(tabs);
    fireEvent.click(screen.getByRole("button", { name: /本机/ }));
    expect(screen.queryByLabelText("一键发布本机谱到社区")).toBeNull();
  });
});

/**
 * 署名：同一首曲在社区里可能有多个打法版本，署名是区分「谁打的谱」的唯一线索。
 * 匿名（空串）时不能留下一个空的占位块，否则列表看着像缺了块。
 */
describe("LoadDialog · 打谱人署名", () => {
  const withAuthors: ScoreListItem[] = [
    {
      id: "c1",
      title: "平沙落雁",
      tuning: "zhengdiao",
      author: "张百忍",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
    {
      id: "c2",
      title: "潇湘水云",
      tuning: "zhengdiao",
      author: "",
      created_at: "2026-09-02T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    },
    {
      id: "c3",
      title: "流水",
      tuning: "zhengdiao",
      author: "李四",
      created_at: "2026-09-03T00:00:00Z",
      updated_at: "2026-09-03T00:00:00Z",
    },
  ];

  it("有署名的谱显示署名，匿名的谱不显示", () => {
    renderDialog([{ key: "community", label: "社区曲谱", scores: withAuthors }]);
    expect(screen.getByText("张百忍")).toBeTruthy();
    expect(screen.getByText("李四")).toBeTruthy();
    // 匿名谱只有曲名，没有第二个文本块
    expect(screen.queryByText("匿名")).toBeNull();
  });

  it("可以按署名搜索（找某位打谱人的谱）", () => {
    renderDialog([{ key: "community", label: "社区曲谱", scores: withAuthors }]);
    fireEvent.change(screen.getByLabelText("按曲名搜索"), {
      target: { value: "张百忍" },
    });
    expect(screen.getByText("平沙落雁")).toBeTruthy();
    expect(screen.queryByText("流水")).toBeNull();
    expect(screen.queryByText("潇湘水云")).toBeNull();
  });
});

/**
 * 只读 tab 的例外：自己发布的谱要能删。
 * 否则「发布到社区」就变成不可撤回的操作。
 */
describe("LoadDialog · 只读 tab 里自己的谱", () => {
  const items: ScoreListItem[] = [
    {
      id: "mine",
      title: "我的平沙",
      tuning: "zhengdiao",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
    {
      id: "other",
      title: "别人的流水",
      tuning: "zhengdiao",
      created_at: "2026-09-02T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    },
  ];

  it("只给自己的谱显示删除按钮，别人的谱仍然只读", () => {
    const { container, onDelete } = renderDialog([
      {
        key: "community",
        label: "社区曲谱",
        scores: items,
        readOnly: true,
        myScoreIds: ["mine"],
      },
    ]);

    const buttons = container.querySelectorAll('[title="删除"]');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onDelete).toHaveBeenCalledWith("mine", "我的平沙");
  });

  it("没有 myScoreIds 时只读 tab 一个删除按钮都没有", () => {
    const { container } = renderDialog([
      { key: "community", label: "社区曲谱", scores: items, readOnly: true },
    ]);
    expect(container.querySelectorAll('[title="删除"]')).toHaveLength(0);
  });
});

/**
 * 账号归属：换设备登录后，靠 `owner_user_id` 认出「这是我的谱」。
 *
 * 这是账号体系要兑现的核心承诺——不靠本机那把钥匙也能认出自己的谱。
 * 认领入口则只对「本机发的、还没有账号归属」的谱开放：服务端要求出示原凭证，
 * 别人的谱点了也只会 403，所以界面不该给那个按钮。
 */
describe("LoadDialog · 账号归属与认领", () => {
  const items: ScoreListItem[] = [
    {
      id: "by-account",
      title: "账号发的谱",
      tuning: "zhengdiao",
      owner_user_id: "u-1",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
    {
      id: "by-device",
      title: "本机凭证发的谱",
      tuning: "zhengdiao",
      owner_user_id: null,
      created_at: "2026-09-02T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    },
    {
      id: "by-others",
      title: "别人的谱",
      tuning: "zhengdiao",
      owner_user_id: "u-2",
      created_at: "2026-09-03T00:00:00Z",
      updated_at: "2026-09-03T00:00:00Z",
    },
  ];

  it("登录后凭 owner_user_id 认出自己的谱（换了设备也认得）", () => {
    const { container } = renderDialog([
      { key: "community", label: "社区曲谱", scores: items, readOnly: true, myUserId: "u-1" },
    ]);
    // 只标「我的」，别人的不标
    expect(container.querySelectorAll('[title="这首谱是你的，可以改删"]')).toHaveLength(1);
    // 只读 tab 里自己的谱照样能删
    expect(container.querySelectorAll('[title="删除"]')).toHaveLength(1);
  });

  it("未登录时只看本机凭证：账号发的那首不算我的", () => {
    const { container } = renderDialog([
      { key: "community", label: "社区曲谱", scores: items, readOnly: true },
    ]);
    expect(container.querySelectorAll('[title="这首谱是你的，可以改删"]')).toHaveLength(0);
    expect(container.querySelectorAll('[title="删除"]')).toHaveLength(0);
  });

  it("认领入口只给本机发的、还没有账号归属的谱", () => {
    const onClaim = vi.fn();
    renderDialog(
      [
        {
          key: "community",
          label: "社区曲谱",
          scores: items,
          readOnly: true,
          myUserId: "u-1",
          myScoreIds: ["by-device", "by-others"],
        },
      ],
      { onClaim },
    );

    // 只有「本机凭证发的谱」可认领：别人的谱给了 myScoreIds 也不给按钮
    // （本地记录可以伪造，服务端仍要求出示原凭证，界面不该误导）
    const claimButtons = screen.getAllByText("认领");
    expect(claimButtons).toHaveLength(1);
    fireEvent.click(claimButtons[0]);
    expect(onClaim).toHaveBeenCalledWith("by-device", "本机凭证发的谱");
  });

  it("已有账号归属的谱不再显示认领入口", () => {
    const onClaim = vi.fn();
    renderDialog(
      [
        {
          key: "community",
          label: "社区曲谱",
          scores: items,
          readOnly: true,
          myUserId: "u-1",
          myScoreIds: ["by-account"],
        },
      ],
      { onClaim },
    );
    expect(screen.queryByText("认领")).toBeNull();
  });

  it("未登录时不显示认领入口（服务端要求先登录）", () => {
    const onClaim = vi.fn();
    renderDialog(
      [{ key: "community", label: "社区曲谱", scores: items, readOnly: true, myScoreIds: ["by-device"] }],
      { onClaim },
    );
    expect(screen.queryByText("认领")).toBeNull();
  });
});

/**
 * 分页：列表只显示前 N 首时必须说清楚，并且能继续取。
 *
 * 这几条测的不是「按钮好不好看」，而是**界面有没有骗人**：
 * 少一个「还有更多」的提示，用户翻到底就会以为社区只有这几首；
 * 少一句「搜索范围有限」，搜不到会被理解成「社区没有这首谱」。
 */
describe("LoadDialog · 分页", () => {
  it("总数多于已加载时显示「已显示 N / 总数」和加载更多", () => {
    const onLoadMore = vi.fn();
    renderDialog([
      { key: "community", label: "社区曲谱", scores: COMMUNITY, readOnly: true, total: 123, onLoadMore },
    ]);

    expect(screen.getByText("已显示 1 / 123 首")).toBeTruthy();
    fireEvent.click(screen.getByText("加载更多"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("已加载完（总数等于条数）时不显示加载更多", () => {
    renderDialog([
      { key: "community", label: "社区曲谱", scores: COMMUNITY, readOnly: true, total: 1, onLoadMore: vi.fn() },
    ]);
    expect(screen.queryByText("加载更多")).toBeNull();
    expect(screen.queryByText(/已显示/)).toBeNull();
  });

  it("加载中时按钮禁用，避免重复请求", () => {
    renderDialog([
      {
        key: "community",
        label: "社区曲谱",
        scores: COMMUNITY,
        readOnly: true,
        total: 123,
        onLoadMore: vi.fn(),
        loadingMore: true,
      },
    ]);
    const btn = screen.getByText("加载中…") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("tab 徽标显示总数而不是已加载数（写 1 会让人以为社区就一首）", () => {
    renderDialog([
      { key: "community", label: "社区曲谱", scores: COMMUNITY, readOnly: true, total: 123 },
      { key: "local", label: "本机", scores: LOCAL },
    ]);
    expect(screen.getByRole("button", { name: /社区曲谱/ }).textContent).toContain("123");
  });

  it("搜索时提示范围只覆盖已加载部分", () => {
    renderDialog([
      { key: "community", label: "社区曲谱", scores: COMMUNITY, readOnly: true, total: 123, onLoadMore: vi.fn() },
    ]);
    fireEvent.change(screen.getByLabelText("按曲名搜索"), { target: { value: "广陵" } });
    expect(screen.getByText(/搜索只在已加载的 1 首里查/)).toBeTruthy();
  });

  it("没有总数（老服务端）时不显示分页条，也不假装知道还有多少", () => {
    renderDialog([
      { key: "community", label: "社区曲谱", scores: COMMUNITY, readOnly: true, onLoadMore: vi.fn() },
    ]);
    expect(screen.queryByText(/已显示/)).toBeNull();
    expect(screen.queryByText("加载更多")).toBeNull();
  });
});

describe("LoadDialog · 收藏星标", () => {
  /**
   * 未登录时不画星标。
   *
   * 这不是洁癖：收藏接口要求登录态，未登录点星星必然 401。
   * 画一个「点了就报错」的按钮，比不画更让人怀疑功能坏了。
   */
  it("没给 onToggleFavorite 时不渲染星标", () => {
    renderDialog(tabs);
    expect(screen.queryByRole("button", { name: /收藏「/ })).toBeNull();
  });

  it("已收藏显示实心星，点击回调收到「取消收藏」后的状态，且不触发加载", () => {
    const onToggleFavorite = vi.fn();
    const { onLoad } = renderDialog(tabs, { favoriteIds: ["c1"], onToggleFavorite });

    const star = screen.getByRole("button", { name: "取消收藏「广陵散」" });
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(star.textContent).toBe("★");

    fireEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledWith("c1", false);
    // 点星是「收藏这个动作」，不是「打开这首谱」——冒泡没拦住会顺带载入并覆盖编辑区
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("未收藏显示空心星，点击回调收到 true", () => {
    const onToggleFavorite = vi.fn();
    renderDialog(tabs, { favoriteIds: [], onToggleFavorite });

    const star = screen.getByRole("button", { name: "收藏「广陵散」" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(star.textContent).toBe("☆");

    fireEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledWith("c1", true);
  });
});
