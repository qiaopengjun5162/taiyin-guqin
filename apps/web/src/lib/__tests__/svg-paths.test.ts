import { describe, it, expect } from "vitest";
import { SVG_PATHS, FONT_UPEM } from "../svg-paths";

const EXPECTED_KEYS = [
  "top_san", "top_fan",
  "lh_da", "lh_ming", "lh_zhong", "lh_gui",
  "hui_1", "hui_2", "hui_3", "hui_4", "hui_5", "hui_6", "hui_7", "hui_8", "hui_9", "hui_10", "hui_11", "hui_12", "hui_13",
  "fen_ban", "fen_3", "fen_6", "fen_8",
  "rh_gou", "rh_tiao", "rh_mo", "rh_tuo", "rh_da", "rh_pi", "rh_zhai", "rh_ti",
  "str_1", "str_2", "str_3", "str_4", "str_5", "str_6", "str_7",
];

describe("SVG_PATHS data integrity", () => {
  it("has 38 entries", () => {
    expect(Object.keys(SVG_PATHS).length).toBe(38);
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

describe("SVG_PATHS naming convention", () => {
  it("all keys use valid prefixes", () => {
    for (const key of Object.keys(SVG_PATHS)) {
      const valid = key.startsWith("top_") || key.startsWith("lh_") ||
        key.startsWith("hui_") || key.startsWith("fen_") ||
        key.startsWith("rh_") || key.startsWith("str_");
      expect(valid, `${key}`).toBe(true);
    }
  });
});
