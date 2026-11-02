import { describe, it, expect } from "vitest";
import {
  buildQinFingering,
  describeQinFingering,
  HUI_LABELED,
  HUI_TICKS,
  QIN_STRING_COUNT,
} from "../qin-fingering";
import type { JianziState } from "../types";

function state(partial: Partial<JianziState> = {}): JianziState {
  return {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: null,
    stringNumber: null,
    ...partial,
  };
}

const anYin = state({
  toneType: "按",
  leftFinger: "大",
  hui: "九",
  fen: "六分",
  rightAction: "勹",
  stringNumber: "四",
});

describe("buildQinFingering · 位置", () => {
  it("按音：p 与音高推算同源，九徽六分落在 2/3 与 3/4 之间", () => {
    const m = buildQinFingering(anYin);
    expect(m.drawable).toBe(true);
    expect(m.huiNumber).toBe(9);
    // 2/3 + 0.6 × (3/4 − 2/3) = 0.71666…
    expect(m.pressRatio).toBeCloseTo(0.7167, 4);
  });

  it("七徽六分 = 七徽与八徽之间过六成", () => {
    const m = buildQinFingering(
      state({ toneType: "按", hui: "七", fen: "六分", stringNumber: "四" }),
    );
    expect(m.pressRatio).toBeCloseTo(0.56, 4);
  });

  it("无分数时取徽位本身；「半」取两徽正中", () => {
    expect(
      buildQinFingering(state({ toneType: "按", hui: "七", stringNumber: "四" })).pressRatio,
    ).toBeCloseTo(0.5, 4);
    expect(
      buildQinFingering(state({ toneType: "按", hui: "七", fen: "半", stringNumber: "四" }))
        .pressRatio,
    ).toBeCloseTo(0.55, 4);
  });

  it("十三徽在 7/8 处，不是 1", () => {
    const m = buildQinFingering(state({ toneType: "按", hui: "十三", stringNumber: "二" }));
    expect(m.huiNumber).toBe(13);
    expect(m.pressRatio).toBeCloseTo(0.875, 4);
  });

  it("散音不按弦：没有按点，但仍可画（整根弦亮着）", () => {
    const m = buildQinFingering(
      state({ toneType: "散", leftFinger: "大", rightAction: "勹", stringNumber: "五" }),
    );
    expect(m.pressRatio).toBeNull();
    expect(m.leftFinger).toBeNull();
    expect(m.drawable).toBe(true);
  });

  it("泛音有位置（虚按徽位），图上要能标出来", () => {
    const m = buildQinFingering(
      state({ toneType: "泛", leftFinger: "中", hui: "七", stringNumber: "一" }),
    );
    expect(m.pressRatio).toBeCloseTo(0.5, 4);
    expect(m.drawable).toBe(true);
  });

  it("缺弦或缺徽位时不给图，免得画半张", () => {
    expect(buildQinFingering(state({ toneType: "按", hui: "九" })).drawable).toBe(false);
    expect(buildQinFingering(state({ toneType: "按", stringNumber: "四" })).drawable).toBe(false);
    expect(buildQinFingering(state({ toneType: "散", stringNumber: "四" })).drawable).toBe(true);
  });

  it("弦序汉字转成 1–7", () => {
    expect(buildQinFingering(state({ toneType: "散", stringNumber: "七" })).stringNumber).toBe(7);
    expect(buildQinFingering(state({ toneType: "散", stringNumber: "一" })).stringNumber).toBe(1);
  });
});

describe("buildQinFingering · 手", () => {
  it("左右手都转成人话与方向", () => {
    const m = buildQinFingering(anYin);
    expect(m.leftFinger?.name).toBe("大指");
    expect(m.right).toEqual({ name: "勾", finger: "中指", toward: "身" });
  });

  it("挑是离身，指法不同方向就该反过来", () => {
    const m = buildQinFingering({ ...anYin, rightAction: "乚" });
    expect(m.right?.name).toBe("挑");
    expect(m.right?.toward).toBe("外");
  });

  it("复合指法没有单一方向，图上也别硬指一个", () => {
    const m = buildQinFingering({ ...anYin, rightAction: "抹挑" });
    expect(m.right?.name).toBe("抹挑");
    expect(m.right?.toward).toBeNull();
  });

  it("夕 是名指（无名指的偏旁写法）", () => {
    const m = buildQinFingering({ ...anYin, leftFinger: "夕" });
    expect(m.leftFinger?.name).toBe("名指");
  });

  it("走手音带进来，急不带（急弹不改音高走向）", () => {
    expect(buildQinFingering({ ...anYin, slide: "绰" }).slide).toBe("绰");
    expect(buildQinFingering({ ...anYin, slide: "注" }).slide).toBe("注");
    expect(buildQinFingering({ ...anYin, slide: "急" }).slide).toBeNull();
  });
});

describe("徽位刻度", () => {
  it("十三徽齐备，且 7 徽正好在正中", () => {
    expect(HUI_TICKS).toHaveLength(13);
    expect(HUI_TICKS.find((h) => h.number === 7)?.ratio).toBeCloseTo(0.5, 6);
    expect(HUI_TICKS.find((h) => h.number === 1)?.ratio).toBeCloseTo(0.125, 6);
    expect(HUI_TICKS.find((h) => h.number === 13)?.ratio).toBeCloseTo(0.875, 6);
  });

  it("只给五个锚点标数字——十三徽全标会糊成一片", () => {
    expect([...HUI_LABELED].sort((a, b) => a - b)).toEqual([1, 4, 7, 10, 13]);
    expect(QIN_STRING_COUNT).toBe(7);
  });
});

describe("describeQinFingering", () => {
  it("把图讲成一句话，含弦、位置、双手", () => {
    const text = describeQinFingering(buildQinFingering(anYin));
    expect(text).toContain("四弦");
    expect(text).toContain("72%");
    expect(text).toContain("大指");
    expect(text).toContain("中指");
    expect(text).toContain("向身");
  });

  it("散音说清左手不触弦", () => {
    const text = describeQinFingering(
      buildQinFingering(state({ toneType: "散", rightAction: "勹", stringNumber: "五" })),
    );
    expect(text).toContain("散音");
    expect(text).toContain("不触弦");
  });

  it("信息不足时不给假描述", () => {
    expect(describeQinFingering(buildQinFingering(state()))).toContain("信息不足");
  });
});
