/**
 * 编排文案的跨语言黄金样例。
 *
 * 措辞在 `crates/taiyin-core/src/describe.rs`，这里用**真实 wasm 产物**跑同一组
 * 输入、断言同一组字符串——这就是迁移清单第 5 节约定的「逐字节对照」：
 * 换实现不换输出。Rust 侧改一个字这里就红；核心那 14 条 `#[test]` 守的是
 * 同一批黄金样例，两边互为镜像，谁也别想单方面改口径。
 *
 * 不用替身：替身得和 Rust 保持同步，而真实产物不会撒谎。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadRealWasm } from "@/lib/__tests__/load-wasm";
import {
  describeArrangement,
  describePhrases,
  type JianpuArrangement,
  type PathStats,
  type PhraseSpan,
} from "@/lib/taiyin-wasm";

beforeAll(loadRealWasm);

/**
 * 编排效果的文案。
 *
 * 这里钉的不是措辞好不好听，而是**不许撒谎**：没减少的项不能提，
 * 换了落点但移动次数没变时不能说「已优化」，本来就最顺时要直说。
 * 一旦这层开始邀功，用户下次就不信这个按钮了。
 */
describe("taiyin-wasm · describeArrangement 说人话", () => {
  const base: JianpuArrangement = {
    candidates_per_note: [],
    selections: [],
    total_cost: 0,
    stats: {
      string_changes: 0,
      finger_shifts: 0,
      technique_switches: 0,
      rushed_moves: 0,
      longest_open_run: 0,
    },
    greedy_stats: {
      string_changes: 3,
      finger_shifts: 1,
      technique_switches: 2,
      rushed_moves: 0,
      longest_open_run: 0,
    },
    identical_to_greedy: false,
    phrases: [],
  };

  it("只说真的减少了的项", () => {
    expect(describeArrangement(base)).toBe(
      "已编排：少 3 次换弦、少 2 次音色切换、少 1 次挪手",
    );
  });

  it("只改善音色切换时不提换弦", () => {
    const text = describeArrangement({
      ...base,
      stats: {
        string_changes: 3,
        finger_shifts: 1,
        technique_switches: 0,
        rushed_moves: 0,
        longest_open_run: 0,
      },
    });
    expect(text).toBe("已编排：少 2 次音色切换");
    expect(text).not.toContain("换弦");
  });

  it("换了落点但移动次数不变，不吹「已优化」", () => {
    expect(
      describeArrangement({
        ...base,
        stats: {
          string_changes: 3,
          finger_shifts: 1,
          technique_switches: 2,
          rushed_moves: 0,
          longest_open_run: 0,
        },
      }),
    ).toBe("已重排：落点换了，手的移动次数和逐音挑选一样");
  });

  it("本来就最顺时直说，不邀功", () => {
    expect(
      describeArrangement({ ...base, identical_to_greedy: true }),
    ).toContain("已经是最顺");
  });

  /**
   * 急处换手要排在最前面说。
   *
   * 换弦次数是个粗略代理：换三次弦落在二分音符之间叫从容，落在十六分连奏里叫弹不出来。
   * 编排真正买到的是「快句里手不用跑」，文案必须先说这一句。
   */
  it("急处换手减少时先说它，即使换弦总数没变", () => {
    const text = describeArrangement({
      ...base,
      stats: {
        string_changes: 3,
        finger_shifts: 1,
        technique_switches: 2,
        rushed_moves: 0,
        longest_open_run: 0,
      },
      greedy_stats: {
        string_changes: 3,
        finger_shifts: 1,
        technique_switches: 2,
        rushed_moves: 4,
        longest_open_run: 0,
      },
    });
    expect(text).toBe("已编排：快句里少 4 次换手");
  });

  /**
   * 有得有失时不许只报喜。
   *
   * 全局最优完全可能「总换手多一次、但都换在长音之后」——这个取舍是对的，
   * 但用户数着列表里的换弦次数会发现对不上，不说就成了另一种撒谎。
   */
  it("换手总数变多时说清楚，并指出多出来的不在急处", () => {
    const text = describeArrangement({
      ...base,
      stats: {
        string_changes: 4,
        finger_shifts: 1,
        technique_switches: 2,
        rushed_moves: 1,
        longest_open_run: 0,
      },
      greedy_stats: {
        string_changes: 3,
        finger_shifts: 1,
        technique_switches: 2,
        rushed_moves: 3,
        longest_open_run: 0,
      },
    });
    expect(text).toContain("快句里少 2 次换手");
    expect(text).toContain("换手总数多 1 次");
    expect(text).toContain("来得及");
  });

  /**
   * 散音连缀是「听起来连不连」的事，和手好不好动是两回事。
   *
   * 一串空弦弹下来音高全对，但没有走手相连，每根弦音色还都不一样——
   * 这正是「整句排成空弦」最容易被忽略的地方，所以必须单独说一句。
   */
  it("断开散音连缀时单独说明，并给出前后长度", () => {
    const text = describeArrangement({
      ...base,
      stats: {
        string_changes: 6,
        finger_shifts: 0,
        technique_switches: 2,
        rushed_moves: 0,
        longest_open_run: 4,
      },
      greedy_stats: {
        string_changes: 6,
        finger_shifts: 0,
        technique_switches: 0,
        rushed_moves: 0,
        longest_open_run: 7,
      },
    });
    expect(text).toBe("已编排：最长一串散音从 7 个缩到 4 个");
  });

  it("散音连缀没变时不提这一项", () => {
    const text = describeArrangement({
      ...base,
      stats: {
        string_changes: 2,
        finger_shifts: 0,
        technique_switches: 0,
        rushed_moves: 0,
        longest_open_run: 3,
      },
      greedy_stats: {
        string_changes: 3,
        finger_shifts: 0,
        technique_switches: 0,
        rushed_moves: 0,
        longest_open_run: 3,
      },
    });
    expect(text).toBe("已编排：少 1 次换弦");
    expect(text).not.toContain("散音");
  });
});

/**
 * 分句的文案。
 *
 * 长曲一句一句练，是琴人真实的工作方式；整首的总数再漂亮，
 * 回到琴上仍要知道从哪一句开始。所以这段文案只有两个要求：
 * 短曲别硬分句（一句时闭嘴），长曲要把「哪一句最赶」说成可执行的一句话。
 */
describe("taiyin-wasm · describePhrases 逐句报账", () => {
  const stats = (over: Partial<PathStats> = {}): PathStats => ({
    string_changes: 0,
    finger_shifts: 0,
    technique_switches: 0,
    rushed_moves: 0,
    longest_open_run: 0,
    ...over,
  });
  const phrase = (
    index: number,
    start: number,
    statsOver: Partial<PathStats> = {},
  ): PhraseSpan => ({
    index,
    start,
    end: start + 3,
    note_count: 4,
    stats: stats(statsOver),
  });

  it("只有一句时闭嘴：不标「第 1 句」", () => {
    expect(describePhrases([])).toBe("");
    expect(describePhrases([phrase(0, 0, { rushed_moves: 3 })])).toBe("");
  });

  it("指出最赶的一句，按快句换手次数比", () => {
    const text = describePhrases([
      phrase(0, 0, { rushed_moves: 1, string_changes: 9 }),
      phrase(1, 4, { rushed_moves: 3 }),
      phrase(2, 8, { string_changes: 5 }),
    ]);
    expect(text).toBe("全曲 3 句，第 2 句最赶（快句里换手 3 次），先慢练这句");
  });

  it("每句都赶得上手时，不挑一句来冤枉它", () => {
    expect(
      describePhrases([
        phrase(0, 0, { string_changes: 6 }),
        phrase(1, 4, { string_changes: 2 }),
      ]),
    ).toBe("全曲 2 句，没有哪一句赶不上手");
  });

  it("编排文案后面接上分句那句，用句号隔开", () => {
    const text = describeArrangement({
      candidates_per_note: [],
      selections: [],
      total_cost: 0,
      stats: stats(),
      greedy_stats: stats({ string_changes: 2 }),
      identical_to_greedy: false,
      phrases: [phrase(0, 0), phrase(1, 4, { rushed_moves: 2 })],
    });
    expect(text).toBe(
      "已编排：少 2 次换弦。全曲 2 句，第 2 句最赶（快句里换手 2 次），先慢练这句",
    );
  });
});
