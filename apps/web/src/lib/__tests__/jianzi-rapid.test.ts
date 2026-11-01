import { describe, it, expect } from "vitest";
import {
  parseRapidInput,
  normalizeRapidInput,
  RAPID_SLOT_ORDER,
} from "../jianzi-rapid";

describe("normalizeRapidInput", () => {
  it("去掉空白与标点、转小写", () => {
    expect(normalizeRapidInput(" D J, G 4 ")).toBe("djg4");
  });

  it("全角字母与数字转半角", () => {
    expect(normalizeRapidInput("ｄｊｇ４")).toBe("djg4");
  });
});

describe("parseRapidInput · 散音", () => {
  it("g4 → 勾四弦", () => {
    const r = parseRapidInput("g4", "散");
    expect(r.complete).toBe(true);
    expect(r.state.rightAction).toBe("勹");
    expect(r.state.stringNumber).toBe("四");
    expect(r.state.leftFinger).toBeNull();
    expect(r.state.hui).toBeNull();
  });

  it("散音只有两槽，顺序为右手→弦序", () => {
    expect(RAPID_SLOT_ORDER["散"]).toEqual(["rightAction", "stringNumber"]);
  });

  it("s 在三弦位 → 三，ss → 四", () => {
    expect(parseRapidInput("gs", "散").state.stringNumber).toBe("三");
    expect(parseRapidInput("gss", "散").state.stringNumber).toBe("四");
  });
});

describe("parseRapidInput · 按音", () => {
  it("djg4 → 大九勾四（完整）", () => {
    const r = parseRapidInput("djg4", "按");
    expect(r.complete).toBe(true);
    expect(r.consumed).toBe(4);
    expect(r.state.leftFinger).toBe("大");
    expect(r.state.hui).toBe("九");
    expect(r.state.rightAction).toBe("勹");
    expect(r.state.stringNumber).toBe("四");
  });

  it("火蜘蛛消歧：ss=四、sss=十", () => {
    expect(parseRapidInput("dssg4", "按").state.hui).toBe("四");
    expect(parseRapidInput("dsssg4", "按").state.hui).toBe("十");
    expect(parseRapidInput("dsg4", "按").state.hui).toBe("三");
  });

  it("「分」可省略也可插入：djg4 与 djf6g4", () => {
    expect(parseRapidInput("djg4", "按").state.fen).toBeNull();
    const withFen = parseRapidInput("djf6g4", "按");
    expect(withFen.complete).toBe(true);
    expect(withFen.state.fen).toBe("六分");
    expect(withFen.state.hui).toBe("九");
  });

  it("t=挑、tu=托、ti=剔", () => {
    expect(parseRapidInput("djt4", "按").state.rightAction).toBe("乚");
    expect(parseRapidInput("djtu4", "按").state.rightAction).toBe("乇");
    expect(parseRapidInput("djti4", "按").state.rightAction).toBe("剔");
  });

  it("复合指法 mt=抹挑", () => {
    const r = parseRapidInput("djmt4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.rightAction).toBe("抹挑");
  });

  it("同一个字母按位置区分：d 在首位是大，在右手位是打", () => {
    expect(parseRapidInput("d", "按").state.leftFinger).toBe("大");
    const r = parseRapidInput("djd4", "按");
    expect(r.state.leftFinger).toBe("大");
    expect(r.state.rightAction).toBe("丁");
  });
});

describe("parseRapidInput · 未完成与容错", () => {
  it("半截输入不判完成，并提示下一个槽位", () => {
    const r = parseRapidInput("dj", "按");
    expect(r.complete).toBe(false);
    expect(r.consumed).toBe(2);
    expect(r.nextSlot).toBe("rightAction");
  });

  it("尾部有无法解析的字符时不算完整", () => {
    const r = parseRapidInput("djg4x", "按");
    expect(r.complete).toBe(false);
  });

  it("空串不判完成", () => {
    expect(parseRapidInput("", "按").complete).toBe(false);
  });

  it("识别结果带上音色，节奏位留空", () => {
    const r = parseRapidInput("g4", "泛");
    expect(r.state.toneType).toBe("泛");
    expect(r.state.rhythmMode).toBeNull();
  });

  it("泛音需要完整四槽（含左手与徽位）", () => {
    expect(parseRapidInput("mqt3", "泛").complete).toBe(true);
    expect(parseRapidInput("gt3", "泛").complete).toBe(false);
  });
});

describe("parseRapidInput · 十三徽与全部分位", () => {
  it("十一 sssy / 十二 ssse / 十三 ssss", () => {
    expect(parseRapidInput("dsssyg4", "按").state.hui).toBe("十一");
    expect(parseRapidInput("dssseg4", "按").state.hui).toBe("十二");
    expect(parseRapidInput("dssssg4", "按").state.hui).toBe("十三");
  });

  it("十三徽整字可成字", () => {
    const r = parseRapidInput("dssssg4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.hui).toBe("十三");
    expect(r.state.rightAction).toBe("勹");
    expect(r.state.stringNumber).toBe("四");
  });

  it("十徽仍走 sss，不被 ssss 抢走", () => {
    const r = parseRapidInput("dsssg4", "按");
    expect(r.state.hui).toBe("十");
    expect(r.complete).toBe(true);
  });

  it("分位 f1–f9 与 fb", () => {
    const cases = [
      ["f1", "一分"], ["f2", "二分"], ["f3", "三分"], ["f4", "四分"], ["f5", "五分"],
      ["f6", "六分"], ["f7", "七分"], ["f8", "八分"], ["f9", "九分"], ["fb", "半"],
    ] as const;
    for (const [key, fen] of cases) {
      const r = parseRapidInput(`dq${key}g4`, "按");
      expect(r.state.hui, key).toBe("七");
      expect(r.state.fen, key).toBe(fen);
      expect(r.complete, key).toBe(true);
    }
  });
});
