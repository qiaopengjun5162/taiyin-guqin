#!/usr/bin/env python3
"""太音 · 增量追加走手音（绰/注）字形到 svg-paths.ts

为什么不跑 extract-svg-paths.py：该脚本是全量产物，会覆盖 svg-paths.ts 里
已被齊伋體（明代木刻版风格）替换过的 22 个标准字形。新增字形只能增量追加。

字形来源：字体里的 `mod_*`（修饰笔画）字形——它们正是字体拼字时压进谱字块
的那两个笔画，advance width 为 0（靠 GPOS 定位），所以 SVG 侧得自己给槽位。

用法：python3 scripts/append-slide-paths.py
"""

import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

FONT_PATH = "apps/web/public/fonts/TaiYinJianZiPuKaiTi.ttf"
OUTPUT_PATH = "apps/web/src/lib/svg-paths.ts"

# svg-paths 键 → 字体字形名
TARGET_GLYPHS = {
    "mod_chuo": "mod_chuo",  # 绰（下方向上滑）
    "mod_zhu": "mod_zhu",    # 注（上方向下滑）
    "mod_ji": "mod_ji",      # 急（急弹记号，与绰/注同槽互斥）
}


def extract(font, glyph_name):
    glyph_set = font.getGlyphSet()
    if glyph_name not in glyph_set:
        return None, None
    pen = SVGPathPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    path = pen.getCommands()
    if not path:
        return None, None
    bp = BoundsPen(glyph_set)
    glyph_set[glyph_name].draw(bp)
    bbox = None
    if bp.bounds:
        x_min, y_min, x_max, y_max = bp.bounds
        bbox = {"xMin": x_min, "yMin": y_min, "xMax": x_max, "yMax": y_max}
    return path, bbox


def main():
    font = TTFont(FONT_PATH)
    src = open(OUTPUT_PATH, encoding="utf-8").read()

    lines = []
    for key, glyph_name in TARGET_GLYPHS.items():
        if f'"{key}":' in src:
            print(f"  · {key} 已存在，跳过")
            continue
        path, bbox = extract(font, glyph_name)
        if not path:
            print(f"  ✗ {key} ← {glyph_name} 提取失败")
            continue
        b = (
            f'{{"xMin": {bbox["xMin"]}, "yMin": {bbox["yMin"]}, '
            f'"xMax": {bbox["xMax"]}, "yMax": {bbox["yMax"]}}}'
            if bbox
            else "null"
        )
        lines.append(f'  "{key}": {{ d: "{path}", bbox: {b} }},')
        print(f"  ✓ {key:10s} ← {glyph_name:10s} {len(path):>5} chars")

    if not lines:
        print("没有新增字形，未改动文件")
        return 0

    anchor = "\n};\n"
    idx = src.rindex(anchor)
    header = (
        "  // ── 走手音（绰/注）──\n"
        "  // 字体里这两个字形 advance width 为 0（拼字时由 GPOS 定位），\n"
        "  // SVG 积木没有 GPOS，位置由 SvgJianziBlock 的槽位决定。\n"
    )
    src = src[:idx] + "\n" + header + "\n".join(lines) + src[idx:]
    open(OUTPUT_PATH, "w", encoding="utf-8").write(src)
    print(f"已写入 {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
