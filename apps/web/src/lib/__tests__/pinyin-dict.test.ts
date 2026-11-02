import { describe, it, expect } from "vitest";
import { lookupPinyin, isPinyin, pinyinToJianpu } from "../pinyin-dict";

describe("拼音减字字典", () => {
  it("空输入不返回候选", () => {
    expect(lookupPinyin("")).toEqual([]);
  });

  it("前缀匹配：打 d 就能出「大」", () => {
    expect(lookupPinyin("d")).toContain("大");
  });

  it("大小写不敏感", () => {
    expect(lookupPinyin("DA")).toEqual(lookupPinyin("da"));
  });

  it("同音字合并去重：zhai 同时给「倽」和「摘」", () => {
    const hits = lookupPinyin("zhai");
    expect(hits).toContain("倽");
    expect(hits).toContain("摘");
    // Set 去重：带声调的 zhai1/zhai2 不会让结果重复
    expect(new Set(hits).size).toBe(hits.length);
  });

  it("xian 能一次列出七根弦的序号", () => {
    const hits = lookupPinyin("xian");
    for (const n of ["一", "二", "三", "四", "五", "六", "七"]) {
      expect(hits).toContain(n);
    }
  });

  it("没有任何键匹配时返回空数组", () => {
    expect(lookupPinyin("zzz")).toEqual([]);
  });

  it("isPinyin 只认字母", () => {
    expect(isPinyin("da")).toBe(true);
    expect(isPinyin("Da4")).toBe(true);
    expect(isPinyin("大")).toBe(false);
    expect(isPinyin("7")).toBe(false);
    expect(isPinyin("")).toBe(false);
  });

  it("拼音转简谱数字", () => {
    expect(pinyinToJianpu("san")).toBe("3");
    expect(pinyinToJianpu("WU")).toBe("5");
    expect(pinyinToJianpu("qi")).toBe("7");
  });

  it("不是数字读法的拼音给 null", () => {
    expect(pinyinToJianpu("da")).toBeNull();
    expect(pinyinToJianpu("")).toBeNull();
  });
});
