import { describe, it, expect } from "vitest";
import { SVG_PATHS, FONT_UPEM } from "../svg-paths";
import { SLIDE_MARKS } from "../jianzi";
import { SLIDE_MAP } from "../../components/svg-jianzi-block";

const EXPECTED_KEYS = [
  "top_san", "top_fan",
  "lh_da", "lh_ming", "lh_zhong", "lh_gui",
  "hui_1", "hui_2", "hui_3", "hui_4", "hui_5", "hui_6", "hui_7", "hui_8", "hui_9", "hui_10", "hui_11", "hui_12", "hui_13",
  "fen_ban", "fen_3", "fen_6", "fen_8",
  "rh_gou", "rh_tiao", "rh_mo", "rh_tuo", "rh_da", "rh_pi", "rh_zhai", "rh_ti",
  // 复合指法（双指法连字）字形
  "rh_motiao", "rh_gouti", "rh_mogou", "rh_dazhai",
  // 成块单指法（字体内折成块，GSUB 单字替换已核验真身）：轮/锁/涓/历/拂
  "rh_lun", "rh_suo", "rh_juan", "rh_li", "rh_fu",
  // 成块复合指法（GSUB 连字 lgw_* 已核验真身、有轮廓）
  "rh_banfu", "rh_changsuo", "rh_duansuo", "rh_beisuo", "rh_yuansuo",
  "rh_banjuan", "rh_fanjuan", "rh_diejuan", "rh_lianjuan",
  "str_1", "str_2", "str_3", "str_4", "str_5", "str_6", "str_7",
  // 装饰记号：内折 3 个 + 吟猱族挂尾 18 个（字形从 GSUB 连字目标增量提取）
  "mod_chuo", "mod_zhu", "mod_ji",
  "mod_yin", "mod_nao",
  "mod_chuoyin", "mod_chuonao", "mod_zhuyin", "mod_zhunao",
  "mod_xiyin", "mod_xinao", "mod_youyin", "mod_younao",
  "mod_dangyin", "mod_dangnao", "mod_feiyin", "mod_feinao",
  "mod_yuanyin", "mod_yuanniao", "mod_dingyin", "mod_dingnao",
];

describe("SVG_PATHS data integrity", () => {
  it("has 77 entries", () => {
    expect(Object.keys(SVG_PATHS).length).toBe(77);
  });

  it("contains all expected keys", () => {
    for (const key of EXPECTED_KEYS) {
      expect(SVG_PATHS).toHaveProperty(key);
    }
  });

  it("every entry has a non-empty d string", () => {
    for (const [key, entry] of Object.entries(SVG_PATHS)) {
      expect(entry.d.length, `${key}`).toBeGreaterThan(10);
    }
  });

  it("every entry has a valid bbox", () => {
    for (const [key, entry] of Object.entries(SVG_PATHS)) {
      expect(entry.bbox, `${key}`).not.toBeNull();
      if (entry.bbox) {
        expect(entry.bbox.xMin).toBeLessThan(entry.bbox.xMax);
        expect(entry.bbox.yMin).toBeLessThan(entry.bbox.yMax);
        expect(entry.bbox.xMax - entry.bbox.xMin).toBeGreaterThan(0);
        expect(entry.bbox.yMax - entry.bbox.yMin).toBeGreaterThan(0);
      }
    }
  });

  it("FONT_UPEM is 1000", () => {
    expect(FONT_UPEM).toBe(1000);
  });

  it("all d strings start with M and contain path commands", () => {
    for (const [key, entry] of Object.entries(SVG_PATHS)) {
      expect(entry.d, `${key}`).toMatch(/^M/);
      expect(entry.d, `${key}`).toMatch(/[MLQCTZmlqctz]/);
    }
  });
});

describe("装饰记号 → SVG 字形契约", () => {
  it("21 个记号在 SLIDE_MAP 里都登记了，且每个键都有字形", () => {
    // 漏登记 = 字体分支正常、SVG 降级分支静默空白，肉眼在谱面上看不出来。
    expect(Object.keys(SLIDE_MAP)).toHaveLength(21);
    for (const mark of SLIDE_MARKS) {
      const key = SLIDE_MAP[mark];
      expect(key, `记号 ${mark} 没登记 SLIDE_MAP`).toBeDefined();
      expect(SVG_PATHS[key], `${mark} → ${key} 缺字形`).toBeDefined();
    }
  });

  it("内折 3 个用旧槽位键，挂尾 18 个用新键（不共用内折槽）", () => {
    expect(SLIDE_MAP["绰"]).toBe("mod_chuo");
    expect(SLIDE_MAP["注"]).toBe("mod_zhu");
    expect(SLIDE_MAP["急"]).toBe("mod_ji");
    for (const mark of SLIDE_MARKS) {
      if (mark === "绰" || mark === "注" || mark === "急") continue;
      expect(SLIDE_MAP[mark], mark).not.toMatch(/^mod_(chuo|zhu|ji)$/);
    }
  });
});

describe("SVG_PATHS naming convention", () => {
  it("all keys use valid prefixes", () => {
    for (const key of Object.keys(SVG_PATHS)) {
      const valid = key.startsWith("top_") || key.startsWith("lh_") ||
        key.startsWith("hui_") || key.startsWith("fen_") ||
        key.startsWith("rh_") || key.startsWith("str_") ||
        key.startsWith("mod_");
      expect(valid, `${key}`).toBe(true);
    }
  });
});
