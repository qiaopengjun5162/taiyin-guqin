import { describe, it, expect } from "vitest";
import {
  createEmptyState,
  isComplete,
  jianziToText,
  parseJianziText,
  getRhythmLineCount,
} from "../types";
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
