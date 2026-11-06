/**
 * 联袂指法：成组 / 解组 / 归一化 / 音程判断。
 *
 * 这一层最容易出的错是"孤儿"：组首被删、或中间插了别的音之后，
 * 成员还挂着一条指向不存在组首的 link。谱面上表现为一条连不起来的
 * 连音线，不报错、也不崩，只能靠用例挡住。
 */
import { describe, it, expect } from "vitest";
import {
  LIANMEI_OPTIONS,
  clearLianmei,
  lianmeiGroups,
  lianmeiRelation,
  lianmeiRoleAt,
  linkLianmei,
  normalizeLianmei,
  relationFits,
} from "../lianmei";
import { createEmptyState } from "../jianzi";
import type { NoteColumn } from "../types";

function makeNote(id: string): NoteColumn {
  return {
    id,
    jianpuNumber: "5",
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi: {
      ...createEmptyState(),
      toneType: "散",
      rightAction: "勹",
      stringNumber: "五",
    },
  };
}

const four = () => ["a", "b", "c", "d"].map(makeNote);

describe("LIANMEI_OPTIONS", () => {
  it("四种指法齐全，且只有放合允许八度", () => {
    expect(LIANMEI_OPTIONS.map((o) => o.kind)).toEqual([
      "同声",
      "应合",
      "放合",
      "分开",
    ]);
    for (const o of LIANMEI_OPTIONS) {
      expect(o.hint.length).toBeGreaterThan(0);
      expect(o.memberCount).toBeGreaterThan(0);
      expect(o.allowOctave).toBe(o.kind === "放合");
    }
  });
});

describe("linkLianmei", () => {
  it("组首与紧随其后的音共享同一个 headId", () => {
    const notes = linkLianmei(four(), 0, "同声");
    expect(notes[0].lianmei).toEqual({ kind: "同声", headId: "a" });
    expect(notes[1].lianmei).toEqual({ kind: "同声", headId: "a" });
    expect(notes[2].lianmei).toBeUndefined();
  });

  it("越界（组首已是最后一音）时原样返回，不硬凑一组", () => {
    const notes = four();
    expect(linkLianmei(notes, 3, "同声")).toBe(notes);
  });

  it("成员数可以多于一个（应合可二声以上）", () => {
    const notes = linkLianmei(four(), 0, "应合", 2);
    expect(notes[0].lianmei?.headId).toBe("a");
    expect(notes[1].lianmei?.headId).toBe("a");
    expect(notes[2].lianmei?.headId).toBe("a");
    expect(notes[3].lianmei).toBeUndefined();
  });

  it("把音从旧组里摘出来，不会一音属两组", () => {
    // 先 a+b 成组，再让 b+c 成组 → a 的组应当只剩自己，归一化后解掉
    const first = linkLianmei(four(), 0, "同声");
    const second = linkLianmei(first, 1, "分开");
    expect(second[1].lianmei?.headId).toBe("b");
    expect(second[2].lianmei?.headId).toBe("b");
    expect(second[0].lianmei?.headId).toBe("a");

    // a 已经没有成员了，归一化必须把它的孤立标记清掉
    const normalized = normalizeLianmei(second);
    expect(normalized[0].lianmei).toBeUndefined();
    expect(normalized[1].lianmei?.kind).toBe("分开");
  });
});

describe("clearLianmei", () => {
  it("从组首或成员任一处解除，整组都解开", () => {
    const notes = linkLianmei(four(), 0, "放合");
    const fromMember = clearLianmei(notes, 1);
    expect(fromMember[0].lianmei).toBeUndefined();
    expect(fromMember[1].lianmei).toBeUndefined();
  });

  it("不在组里时原样返回", () => {
    const notes = four();
    expect(clearLianmei(notes, 0)).toBe(notes);
  });
});

describe("lianmeiGroups", () => {
  it("找出连续的一组", () => {
    const groups = lianmeiGroups(linkLianmei(four(), 1, "同声"));
    expect(groups).toEqual([{ kind: "同声", headIndex: 1, memberIndexes: [2] }]);
  });

  it("只挂着一个孤零零的组首时不算组", () => {
    const notes = four();
    notes[0] = { ...notes[0], lianmei: { kind: "同声", headId: "a" } };
    expect(lianmeiGroups(notes)).toEqual([]);
  });
});

describe("normalizeLianmei", () => {
  it("组首被删后，成员的孤儿标记被清掉", () => {
    const notes = linkLianmei(four(), 0, "同声");
    const afterDelete = [notes[1], notes[2], notes[3]];
    const fixed = normalizeLianmei(afterDelete);
    expect(fixed[0].lianmei).toBeUndefined();
  });

  it("中间插进别的音后，原本的组被解开", () => {
    const notes = linkLianmei(four(), 0, "同声"); // a + b
    const inserted = [notes[0], makeNote("x"), notes[1], notes[2], notes[3]];
    const fixed = normalizeLianmei(inserted);
    expect(fixed[0].lianmei).toBeUndefined();
    expect(fixed[2].lianmei).toBeUndefined();
  });

  it("组内 kind 不一致时解组（只可能来自手改存档）", () => {
    const notes = linkLianmei(four(), 0, "同声");
    const tampered = notes.map((n, i) =>
      i === 1 && n.lianmei
        ? { ...n, lianmei: { ...n.lianmei, kind: "分开" as const } }
        : n,
    );
    const fixed = normalizeLianmei(tampered);
    expect(fixed.every((n) => n.lianmei === undefined)).toBe(true);
  });

  it("没有要清的东西时返回同一引用（渲染路径每帧都会跑它）", () => {
    const notes = linkLianmei(four(), 0, "同声");
    expect(normalizeLianmei(notes)).toBe(notes);
    const plain = four();
    expect(normalizeLianmei(plain)).toBe(plain);
  });
});

describe("lianmeiRoleAt", () => {
  it("区分组首与成员", () => {
    const notes = linkLianmei(four(), 0, "同声");
    expect(lianmeiRoleAt(notes, 0)).toEqual({ kind: "同声", isHead: true });
    expect(lianmeiRoleAt(notes, 1)).toEqual({ kind: "同声", isHead: false });
    expect(lianmeiRoleAt(notes, 2)).toBeNull();
  });
});

describe("lianmeiRelation", () => {
  it("同频判同度", () => {
    expect(lianmeiRelation(440, 440)).toBe("同度");
    // 1% 容差吃掉浮点与徽位换算误差
    expect(lianmeiRelation(440, 442)).toBe("同度");
  });

  it("倍频判八度", () => {
    expect(lianmeiRelation(220, 440)).toBe("八度");
    expect(lianmeiRelation(440, 220)).toBe("八度");
  });

  it("半音（约 6%）判不合，不会被容差吃成同度", () => {
    expect(lianmeiRelation(440, 466)).toBe("不合");
  });

  it("推算不出音高时判不合", () => {
    expect(lianmeiRelation(null, 440)).toBe("不合");
    expect(lianmeiRelation(0, 440)).toBe("不合");
  });
});

describe("relationFits", () => {
  it("同度对四种都成立", () => {
    for (const o of LIANMEI_OPTIONS) {
      expect(relationFits(o.kind, "同度")).toBe(true);
    }
  });

  it("八度只对放合成立", () => {
    expect(relationFits("放合", "八度")).toBe(true);
    expect(relationFits("同声", "八度")).toBe(false);
    expect(relationFits("应合", "八度")).toBe(false);
    expect(relationFits("分开", "八度")).toBe(false);
  });

  it("不合对谁都不成立", () => {
    for (const o of LIANMEI_OPTIONS) {
      expect(relationFits(o.kind, "不合")).toBe(false);
    }
  });
});
