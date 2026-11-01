import { describe, it, expect } from "vitest";
import {
  createEmptyState,
  isComplete,
  jianziToText,
  parseJianziText,
  getRhythmLineCount,
  durationToBeats,
} from "../jianzi";
import type { JianziState } from "../types";

function make(overrides: Partial<JianziState> = {}): JianziState {
  return { ...createEmptyState(), ...overrides };
}

describe("createEmptyState", () => {
  it("returns all-null state", () => {
    const s = createEmptyState();
    expect(s).toEqual({
      toneType: null,
      rhythmMode: null,
      leftFinger: null,
      hui: null,
      fen: null,
      rightAction: null,
      stringNumber: null,
    });
  });
});

describe("isComplete", () => {
  it("returns false for empty state", () => {
    expect(isComplete(createEmptyState())).toBe(false);
  });

  it("散音 needs rightAction + stringNumber", () => {
    expect(isComplete(make({ toneType: "散", rightAction: "勹", stringNumber: "五" }))).toBe(true);
    expect(isComplete(make({ toneType: "散", rightAction: "勹" }))).toBe(false);
    expect(isComplete(make({ toneType: "散", stringNumber: "五" }))).toBe(false);
  });

  it("泛音 needs leftFinger + hui + rightAction + stringNumber", () => {
    expect(isComplete(make({ toneType: "泛", leftFinger: "大", hui: "十", rightAction: "勹", stringNumber: "五" }))).toBe(true);
    expect(isComplete(make({ toneType: "泛", hui: "十", rightAction: "勹", stringNumber: "五" }))).toBe(false);
    expect(isComplete(make({ toneType: "泛", leftFinger: "大", rightAction: "勹", stringNumber: "五" }))).toBe(false);
    expect(isComplete(make({ toneType: "泛", leftFinger: "大", hui: "十", stringNumber: "五" }))).toBe(false);
    expect(isComplete(make({ toneType: "泛", leftFinger: "大", hui: "十", rightAction: "勹" }))).toBe(false);
  });

  it("按音 needs leftFinger + hui + rightAction + stringNumber", () => {
    expect(isComplete(make({ toneType: "按", leftFinger: "大", hui: "九", rightAction: "木", stringNumber: "四" }))).toBe(true);
  });
});

describe("jianziToText", () => {
  it("散音 prefix and GSUB-compatible glyph names", () => {
    expect(jianziToText(make({ toneType: "散", rightAction: "勹", stringNumber: "五" }))).toBe("散勾五");
  });

  it("maps all right action abbreviations to GSUB names", () => {
    const cases: [string, string][] = [
      ["勹", "勾"], ["木", "抹"], ["乚", "挑"], ["乇", "托"],
      ["丁", "打"], ["尸", "擘"], ["倽", "摘"],
    ];
    for (const [short, full] of cases) {
      expect(jianziToText(make({ toneType: "散", rightAction: short, stringNumber: "一" }))).toBe(`散${full}一`);
    }
  });

  it("泛音 with space separator", () => {
    expect(jianziToText(make({ toneType: "泛", leftFinger: "大", hui: "十", rightAction: "勹", stringNumber: "三" }))).toBe("泛 大十勾三");
  });

  it("按音 no prefix", () => {
    expect(jianziToText(make({ toneType: "按", leftFinger: "名", hui: "九", rightAction: "木", stringNumber: "四" }))).toBe("名九抹四");
  });

  it("includes fen when present", () => {
    expect(jianziToText(make({ toneType: "按", leftFinger: "大", hui: "七", fen: "半", rightAction: "勹", stringNumber: "二" }))).toBe("大七半勾二");
  });

  /*
   * 减字谱字体的一条硬规则：徽位后的分数在减字里**只写数字**。
   * 「七徽六分」的字形是「七」下压一个「六」；若写成「六分」，
   * 字体找不到部件，整块散架（线上实测「勹」被挤出格子）。
   */
  it("分位序列化为单字（去掉「分」字）", () => {
    const at = (fen: string) =>
      jianziToText(make({ toneType: "按", leftFinger: "大", hui: "七", fen, rightAction: "勹", stringNumber: "四" }));
    expect(at("三分")).toBe("大七三勾四");
    expect(at("六分")).toBe("大七六勾四");
    expect(at("八分")).toBe("大七八勾四");
    expect(at("一分")).toBe("大七一勾四");
    expect(at("九分")).toBe("大七九勾四");
    expect(at("半")).toBe("大七半勾四");
  });

  it("十三徽序列化为两字，与字体「十一」「十二」「十三」部件一致", () => {
    expect(jianziToText(make({ toneType: "按", leftFinger: "大", hui: "十一", rightAction: "勹", stringNumber: "四" }))).toBe("大十一勾四");
    expect(jianziToText(make({ toneType: "按", leftFinger: "大", hui: "十三", rightAction: "勹", stringNumber: "四" }))).toBe("大十三勾四");
  });

  /*
   * 两字徽位后面接分数时，中间要有「徽」字分隔，
   * 否则字体把后面的数字另起一块、整字被撑开（实测对比四种写法）。
   */
  it("两字徽位 + 分数时插入「徽」分隔", () => {
    expect(jianziToText(make({ toneType: "按", leftFinger: "大", hui: "十三", fen: "六分", rightAction: "勹", stringNumber: "四" }))).toBe("大十三徽六勾四");
    expect(jianziToText(make({ toneType: "按", leftFinger: "大", hui: "十", fen: "六分", rightAction: "勹", stringNumber: "四" }))).toBe("大十六勾四");
  });

  it("returns empty string for incomplete state", () => {
    expect(jianziToText(createEmptyState())).toBe("");
  });

  it("handles 剔 right action", () => {
    expect(jianziToText(make({ toneType: "散", rightAction: "剔", stringNumber: "七" }))).toBe("散剔七");
  });
});

describe("parseJianziText", () => {
  it("parses 散勾五", () => {
    const r = parseJianziText("散勾五");
    expect(r).not.toBeNull();
    expect(r!.toneType).toBe("散");
    expect(r!.rightAction).toBe("勾");
    expect(r!.stringNumber).toBe("五");
  });

  it("parses 大九勾四", () => {
    const r = parseJianziText("大九勾四");
    expect(r).not.toBeNull();
    expect(r!.toneType).toBe("按");
    expect(r!.leftFinger).toBe("大");
    expect(r!.hui).toBe("九");
    expect(r!.rightAction).toBe("勾");
    expect(r!.stringNumber).toBe("四");
  });

  it("parses 泛 名十勾三", () => {
    const r = parseJianziText("泛 名十勾三");
    expect(r).not.toBeNull();
    expect(r!.toneType).toBe("泛");
    expect(r!.leftFinger).toBe("名");
    expect(r!.hui).toBe("十");
    expect(r!.rightAction).toBe("勾");
    expect(r!.stringNumber).toBe("三");
  });

  it("parses with fen: 大七半勾二", () => {
    const r = parseJianziText("大七半勾二");
    expect(r).not.toBeNull();
    expect(r!.fen).toBe("半");
    expect(r!.stringNumber).toBe("二");
  });

  it("parses 散打七", () => {
    const r = parseJianziText("散打七");
    expect(r).not.toBeNull();
    expect(r!.toneType).toBe("散");
    expect(r!.rightAction).toBe("打");
    expect(r!.stringNumber).toBe("七");
  });

  it("parses short-form actions: 散木四", () => {
    const r = parseJianziText("散木四");
    expect(r).not.toBeNull();
    expect(r!.rightAction).toBe("木");
  });

  it("returns null for empty text", () => {
    expect(parseJianziText("")).toBeNull();
    expect(parseJianziText("  ")).toBeNull();
  });

  // 传统减字偏旁写法：亻 = 食指（取"食"左半）、夕 = 名指（取"名"左半）
  it("parses archaic finger radical 亻 (index finger)", () => {
    const r = parseJianziText("亻九勾三");
    expect(r).not.toBeNull();
    expect(r!.leftFinger).toBe("亻");
    expect(r!.hui).toBe("九");
    expect(r!.rightAction).toBe("勾");
    expect(r!.stringNumber).toBe("三");
  });

  it("parses archaic finger radical 夕 (ring finger)", () => {
    const r = parseJianziText("夕十勾三");
    expect(r).not.toBeNull();
    expect(r!.leftFinger).toBe("夕");
    expect(r!.hui).toBe("十");
  });

  it("still parses full-form 食/名 alongside radicals", () => {
    expect(parseJianziText("食九勾三")!.leftFinger).toBe("食");
    expect(parseJianziText("名九勾三")!.leftFinger).toBe("名");
  });

  it("parses hui 十一 and 十二", () => {
    expect(parseJianziText("大十一勾一")!.hui).toBe("十一");
    expect(parseJianziText("中十二勾一")!.hui).toBe("十二");
  });

  it("parses 跪 finger", () => {
    expect(parseJianziText("跪九勾三")!.leftFinger).toBe("跪");
  });

  it("parses 食 finger", () => {
    expect(parseJianziText("食九勾三")!.leftFinger).toBe("食");
  });

  /*
   * 复合指法：字体 GSUB 原生支持 抹挑/勾剔/抹勾/打摘（见 lg_* 连字），
   * 解析时必须优先匹配双字，否则会被拆成单字「抹」。
   */
  it("parses compound right actions", () => {
    expect(parseJianziText("大九抹挑四")!.rightAction).toBe("抹挑");
    expect(parseJianziText("大七勾剔三")!.rightAction).toBe("勾剔");
    expect(parseJianziText("大十抹勾五")!.rightAction).toBe("抹勾");
    expect(parseJianziText("大九打摘二")!.rightAction).toBe("打摘");
  });

  it("keeps single-character action intact (not swallowed by compound)", () => {
    expect(parseJianziText("大九抹四")!.rightAction).toBe("抹");
    expect(parseJianziText("散勾五")!.rightAction).toBe("勾");
  });

  /*
   * 「徽位后一位数字」是分数，不是第二位徽数。
   * 贪心吃连续徽数字会把「大七六勾四」读成徽位「七六」。
   */
  it("分位单位数字解析为「X分」而不是并进徽位", () => {
    const r = parseJianziText("大七六勾四");
    expect(r).not.toBeNull();
    expect(r!.hui).toBe("七");
    expect(r!.fen).toBe("六分");
    expect(r!.rightAction).toBe("勾");
    expect(r!.stringNumber).toBe("四");
  });

  it("解析 一分/九分 等全部分位", () => {
    for (const [ch, fen] of [["一", "一分"], ["二", "二分"], ["四", "四分"], ["五", "五分"], ["七", "七分"], ["九", "九分"]] as const) {
      const r = parseJianziText(`大九${ch}勾四`);
      expect(r, `大九${ch}勾四`).not.toBeNull();
      expect(r!.hui).toBe("九");
      expect(r!.fen).toBe(fen);
    }
  });

  it("兼容旧写法（带「分」字）", () => {
    const r = parseJianziText("大七六分勾四");
    expect(r).not.toBeNull();
    expect(r!.hui).toBe("七");
    expect(r!.fen).toBe("六分");
  });

  it("十一～十三徽与分位可往返", () => {
    for (const hui of ["十一", "十二", "十三"]) {
      const state = make({ toneType: "按", leftFinger: "大", hui, fen: "六分", rightAction: "勹", stringNumber: "四" });
      const back = parseJianziText(jianziToText(state));
      expect(back, hui).not.toBeNull();
      expect(back!.hui).toBe(hui);
      expect(back!.fen).toBe("六分");
    }
  });
});

describe("getRhythmLineCount", () => {
  it("returns correct lines per duration", () => {
    expect(getRhythmLineCount("全")).toBe(0);
    expect(getRhythmLineCount("二分")).toBe(0);
    expect(getRhythmLineCount("四分")).toBe(1);
    expect(getRhythmLineCount("八分")).toBe(2);
    expect(getRhythmLineCount("十六分")).toBe(3);
  });
});

describe("durationToBeats", () => {
  it("converts durations to beats", () => {
    expect(durationToBeats("全")).toBe(4);
    expect(durationToBeats("二分")).toBe(2);
    expect(durationToBeats("四分")).toBe(1);
    expect(durationToBeats("八分")).toBe(0.5);
    expect(durationToBeats("十六分")).toBe(0.25);
  });

  it("applies 1.5x for dotted durations", () => {
    expect(durationToBeats("二分", true)).toBe(3);
    expect(durationToBeats("四分", true)).toBe(1.5);
    expect(durationToBeats("八分", true)).toBe(0.75);
  });
});
