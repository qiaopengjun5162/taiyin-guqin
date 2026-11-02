import { describe, it, expect } from "vitest";
import {
  explainJianzi,
  describeHuiPosition,
  describeRightAction,
  shortCaption,
} from "../jianzi-explain";
import type { JianziState } from "../types";

function state(partial: Partial<JianziState>): JianziState {
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

const anYin: JianziState = state({
  toneType: "按",
  leftFinger: "大",
  hui: "七",
  fen: "六分",
  rightAction: "勹",
  stringNumber: "四",
});

describe("describeRightAction", () => {
  it("译出偏旁对应的手指、指法与拨弦方向", () => {
    expect(describeRightAction("勹")).toBe("中指勾（朝自己一侧拨弦）");
    expect(describeRightAction("乚")).toBe("食指挑（离身一侧拨弦）");
    expect(describeRightAction("乇")).toBe("大指托（离身一侧拨弦）");
    expect(describeRightAction("尸")).toBe("大指擘（朝自己一侧拨弦）");
  });

  it("全字写法与偏旁写法释义一致", () => {
    expect(describeRightAction("勾")).toBe(describeRightAction("勹"));
    expect(describeRightAction("抹")).toBe(describeRightAction("木"));
    expect(describeRightAction("摘")).toBe(describeRightAction("倽"));
  });

  it("复合指法给出连弹说明而不是单一方向", () => {
    expect(describeRightAction("抹挑")).toContain("先抹后挑");
    expect(describeRightAction("勾剔")).toContain("先勾后剔");
    expect(describeRightAction("抹勾")).toContain("两指相接");
    expect(describeRightAction("打摘")).toContain("先打后摘");
  });

  it("空值与未知指法：返回 null / 原样", () => {
    expect(describeRightAction(null)).toBeNull();
    expect(describeRightAction("某")).toBe("某");
  });
});

describe("describeHuiPosition", () => {
  it("无分位时给徽位与弦长比例说明", () => {
    expect(describeHuiPosition("七", null)).toBe("七徽 · 弦的正中（1/2 处）");
    expect(describeHuiPosition("四", null)).toBe("四徽 · 弦长 1/4 处");
    expect(describeHuiPosition("十", null)).toBe("十徽 · 弦长 3/4 处");
  });

  it("有分位时说明落在哪两徽之间、过几成", () => {
    expect(describeHuiPosition("七", "六分")).toBe(
      "七徽六分 · 七徽与八徽之间，过七徽 6 成",
    );
    expect(describeHuiPosition("九", "三分")).toBe(
      "九徽三分 · 九徽与十徽之间，过九徽 3 成",
    );
  });

  it("两字徽位（十一～十三）的分位不再借用「十四徽」", () => {
    expect(describeHuiPosition("十二", null)).toBe("十二徽");
    expect(describeHuiPosition("十三", "六分")).toBe("十三徽六分 · 再往龙龈方向 6 成");
    expect(describeHuiPosition("十三", "六分")).not.toContain("十四");
  });

  it("半位落在两徽正中", () => {
    expect(describeHuiPosition("七", "半")).toBe("七徽半 · 七徽与八徽的正中");
    expect(describeHuiPosition("十三", "半")).toContain("往龙龈方向");
  });

  it("无徽位返回 null", () => {
    expect(describeHuiPosition(null, "六分")).toBeNull();
  });
});

describe("explainJianzi", () => {
  it("按音：一句话读出指法、位置与弦序", () => {
    const exp = explainJianzi(anYin);
    expect(exp.complete).toBe(true);
    expect(exp.missing).toEqual([]);
    expect(exp.summary).toBe("按音 · 左手大指按于四弦七徽六分，右手中指勾");
  });

  it("散音：说明左手不按弦，且不要求徽位", () => {
    const sanYin = state({ toneType: "散", rightAction: "勹", stringNumber: "四" });
    const exp = explainJianzi(sanYin);
    expect(exp.complete).toBe(true);
    expect(exp.summary).toBe("散音 · 右手中指勾四弦，左手不按弦");
    expect(exp.parts.map((p) => p.label)).toEqual(["音色", "右手", "弦序"]);
  });

  it("泛音：提示轻触徽位、虚按不实", () => {
    const fanYin = state({
      toneType: "泛",
      leftFinger: "中",
      hui: "七",
      rightAction: "勹",
      stringNumber: "四",
    });
    const exp = explainJianzi(fanYin);
    expect(exp.complete).toBe(true);
    expect(exp.summary).toBe("泛音 · 左手中指轻触四弦七徽，右手中指勾");
    expect(exp.parts.find((p) => p.label === "音色")?.text).toContain("虚按不实");
  });

  it("未完成时列出缺的槽位，并给不出 summary", () => {
    const draft = state({ toneType: "按", leftFinger: "大", hui: "七" });
    const exp = explainJianzi(draft);
    expect(exp.complete).toBe(false);
    expect(exp.summary).toBe("");
    expect(exp.missing).toEqual(["右手指法", "弦序"]);
    expect(exp.parts.map((p) => p.label)).toEqual(["音色", "左手", "徽位"]);
  });

  it("空状态：什么部件都没有，也不报缺弦序以外的噪声", () => {
    const exp = explainJianzi(state({}));
    expect(exp.complete).toBe(false);
    expect(exp.parts).toEqual([]);
    expect(exp.missing).toEqual(["音色", "左手指法", "徽位", "右手指法", "弦序"]);
  });

  it("给出正调推定音高", () => {
    const exp = explainJianzi(anYin);
    expect(exp.pitchHint).toMatch(/^简谱 [1-7]/);
  });

  it("走手音单独成一项，说清往上滑还是往下滑", () => {
    const chuo = explainJianzi(
      state({ toneType: "按", leftFinger: "大", hui: "九", rightAction: "勹", stringNumber: "四", slide: "绰" }),
    );
    expect(chuo.parts.find((p) => p.label === "走手音")?.text).toContain("从本位下方滑上来");
    // 一句话读法里也要能读出来
    expect(chuo.summary).toContain("（绰）");

    const zhu = explainJianzi(
      state({ toneType: "按", leftFinger: "大", hui: "九", rightAction: "勹", stringNumber: "四", slide: "注" }),
    );
    expect(zhu.parts.find((p) => p.label === "走手音")?.text).toContain("从本位上方滑下来");
  });

  it("泛音/散音不显示走手音", () => {
    const fan = explainJianzi(
      state({ toneType: "泛", leftFinger: "大", hui: "九", rightAction: "勹", stringNumber: "四", slide: "绰" }),
    );
    expect(fan.parts.find((p) => p.label === "走手音")).toBeUndefined();
  });

  // 急 是弹法记号不是滑音：标签单列成「弹法」，
  // 并明确说音高不变，否则用户会以为它和绰/注一样会滑上去。
  it("急 单列为「弹法」，说明急弹不改音高", () => {
    const ji = explainJianzi(
      state({ toneType: "按", leftFinger: "大", hui: "九", rightAction: "勹", stringNumber: "四", slide: "急" }),
    );
    const part = ji.parts.find((p) => p.label === "弹法");
    expect(part?.text).toContain("急弹");
    expect(part?.text).toContain("音高不变");
    expect(ji.parts.find((p) => p.label === "走手音")).toBeUndefined();
    expect(ji.summary).toContain("（急）");
  });

  it("弦序首尾点明粗细高低，并给出该定弦下的空弦音", () => {
    const exp = explainJianzi(state({ toneType: "散", rightAction: "勹", stringNumber: "一" }));
    expect(exp.parts.find((p) => p.label === "弦序")?.text).toBe("一弦（C2 · 正调，最粗、最低）");

    const qi = explainJianzi(state({ toneType: "散", rightAction: "勹", stringNumber: "七" }));
    expect(qi.parts.find((p) => p.label === "弦序")?.text).toBe("七弦（D3 · 正调，最细、最高）");
  });

  it("换定弦后弦名与音高一起变（慢角调三弦是 E2）", () => {
    const s = state({ toneType: "散", rightAction: "勹", stringNumber: "三" });
    const zheng = explainJianzi(s, { tuning: "zhengdiao" });
    const man = explainJianzi(s, { tuning: "manjiao" });
    expect(zheng.parts.find((p) => p.label === "弦序")?.text).toContain("F2 · 正调");
    expect(man.parts.find((p) => p.label === "弦序")?.text).toContain("E2 · 慢角调");
    expect(zheng.pitchHint).toContain("正调推定");
    expect(man.pitchHint).toContain("慢角调推定");
  });

  it("徽位补充距岳山的弦长百分比（七徽六分 ≈ 56%）", () => {
    const exp = explainJianzi(anYin);
    expect(exp.parts.find((p) => p.label === "徽位")?.text).toContain("56.0%");
  });
});

describe("shortCaption —— 候选音位的两行小字", () => {
  it("按音：第一行「几弦 · 几徽几分」，第二行「谁按 · 谁弹」", () => {
    expect(shortCaption(anYin)).toEqual({
      primary: "四弦 · 七徽六",
      secondary: "大指按 · 中指勾",
      full: "按音，大指按四弦七徽六，右手中指勾",
    });
  });

  it("散音没有徽位，第一行只写弦 + 散", () => {
    const san = state({ toneType: "散", rightAction: "乚", stringNumber: "一" });
    expect(shortCaption(san).primary).toBe("一弦 · 散");
    expect(shortCaption(san).secondary).toBe("食指挑");
  });

  it("泛音短标签用「泛」，完整读法才写「轻触」", () => {
    const fan = state({ toneType: "泛", leftFinger: "大", hui: "九", rightAction: "乚", stringNumber: "三" });
    expect(shortCaption(fan).primary).toBe("三弦 · 九徽");
    expect(shortCaption(fan).secondary).toBe("大指泛 · 食指挑");
    expect(shortCaption(fan).full).toContain("轻触");
  });

  it("十三徽带分位时保留「半」", () => {
    const s = state({ toneType: "按", leftFinger: "名", hui: "十三", fen: "半", rightAction: "剔", stringNumber: "二" });
    expect(shortCaption(s).primary).toBe("二弦 · 十三徽半");
  });

  it("缺字段不崩：没弦序、没指法也给得出标签", () => {
    const s = state({ toneType: "散" });
    expect(shortCaption(s).primary).toBe("散");
    expect(shortCaption(s).full).toContain("未定弦");
  });
});
