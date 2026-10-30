#!/usr/bin/env python3
"""从项目自带减字字体渲染「真减字」测试图，并生成真值标注。

为什么需要它
------------
`sample_single.json` 里的 `images/*.png` 是**手工摆放**的示例，靠人眼看图写
`ground_truth_glyph`，一次只能做几张、且无法复现。而字体里的连字字形本身就是
**真实的减字谱写法**（GSUB 把「仰」+「托」合成一个 `lg_yangtuo` 字形），于是可以
按字形名取轮廓直接出图，真值由 **GSUB 连字表反查**自动得出（构件字符序列即文本）
—— 数据集可无限扩大、零人工标注，且真值不会写错。

用法
----
    python3 gen_font_cases.py                  # 渲染全部复合字形用例（lg/lgw/xl/md）
    python3 gen_font_cases.py --limit 4        # 只渲前 4 个（快速冒烟）
    python3 gen_font_cases.py --prefix lg,md   # 只渲指定前缀
    python3 gen_font_cases.py --out annotations/font_cases.json

产出
----
- `images/<id>.png`：白底黑字减字图（供后端识别）
- `annotations/font_cases.json`：`mode: single` 的标注文件，**不含** `predicted`
  字段 —— 即「在线跑」，由后端真实识别后再计分。
  一个连字字形可能有多个等价写法（如「半涓/半蠲」），此时
  `ground_truth_glyph` 取第一个、其余放 `ground_truth_alts`，计分时任一命中都算对。

依赖：Pillow（可选，仅用于无 ImageMagick 时兜底）、fontTools、ImageMagick
（`magick`，用于 SVG→PNG 栅格化）。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
FONT = REPO / "apps" / "web" / "public" / "fonts" / "TaiYinJianZiPuKaiTi.ttf"

# 完整谱字（复合字形）的命名前缀；sm_* 是部件（如「十一徽一分」），不进主数据集。
COMPOUND_PREFIXES = ("lg", "lgw", "xl", "md")

# 人工说明（可选）：字形名 → 语义备注。真值不再手工写，这里只写给人看的注解。
CASE_NOTES: dict[str, str] = {
    "md_1": "弦序一",
    "md_2": "弦序二",
    "md_3": "弦序三",
    "md_4": "弦序四",
    "md_5": "弦序五",
    "md_6": "弦序六",
    "md_7": "弦序七",
    "md_shi": "左手食指",
    "lg_yangtuo": "左手仰势 + 右手指法托",
    "lgw_quanfu": "右手指法全扶",
    "xl_santan": "右手指法三弹",
    "xl_dacuo": "右手大撮",
    "xl_bola": "右手拨剌",
}


def _ligature_truths(font_path: Path) -> dict[str, list[str]]:
    """GSUB LookupType 4 连字反查：目标字形 → [等价真值文本, ...]。

    连字把「构件字符序列」合成一个字形（仰+托 → lg_yangtuo），反过来读这张表
    就得到该字形的文本真值。一个字形可能有多个等价构件写法（如「半涓/半蠲」），
    按出现顺序全部返回。
    """
    from fontTools.ttLib import TTFont

    font = TTFont(str(font_path))
    cmap = font.getBestCmap()
    glyph_to_char: dict[str, str] = {}
    for cp, g in cmap.items():
        glyph_to_char.setdefault(g, chr(cp))

    def decode(comps: list[str]) -> str | None:
        chars = [glyph_to_char.get(c) for c in comps]
        return "".join(chars) if all(chars) else None

    truths: dict[str, list[str]] = {}
    gsub = font["GSUB"]
    for lookup in gsub.table.LookupList.Lookup:
        if lookup.LookupType != 4:
            continue
        for st in lookup.SubTable:
            for first, ligas in st.ligatures.items():
                for lig in ligas:
                    comps = [first] + list(lig.Component)
                    text = decode(comps)
                    if text:
                        variants = truths.setdefault(lig.LigGlyph, [])
                        if text not in variants:
                            variants.append(text)
    return truths


def _svg_for_glyph(font_path: Path, glyph_name: str, pad: int = 40) -> str:
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.ttLib import TTFont

    font = TTFont(str(font_path))
    glyphset = font.getGlyphSet()
    if glyph_name not in glyphset:
        raise KeyError(f"字体里没有字形 {glyph_name!r}")

    bounds = BoundsPen(glyphset)
    glyphset[glyph_name].draw(bounds)
    if bounds.bounds is None:
        raise ValueError(f"字形 {glyph_name!r} 无轮廓")
    xmin, ymin, xmax, ymax = bounds.bounds

    pen = SVGPathPen(glyphset)
    glyphset[glyph_name].draw(pen)

    w, h = xmax - xmin, ymax - ymin
    vb = f"{xmin - pad} {-(ymax + pad)} {w + 2 * pad} {h + 2 * pad}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(w) + 2 * pad}" '
        f'height="{int(h) + 2 * pad}" viewBox="{vb}">'
        f'<rect x="{xmin - pad}" y="{-(ymax + pad)}" width="{w + 2 * pad}" '
        f'height="{h + 2 * pad}" fill="white"/>'
        f'<g transform="scale(1,-1)"><path d="{pen.getCommands()}" fill="black"/></g>'
        "</svg>"
    )


def _rasterize(svg: str, png: Path) -> None:
    magick = shutil.which("magick") or shutil.which("convert")
    if not magick:
        raise RuntimeError(
            "需要 ImageMagick 栅格化 SVG（macOS: brew install imagemagick）；"
            "或用 --keep-svg 只产出 svg 自行转换"
        )
    svg_path = png.with_suffix(".svg")
    svg_path.write_text(svg, encoding="utf-8")
    subprocess.run(
        [magick, "-background", "white", "-density", "150", str(svg_path), "-flatten", str(png)],
        check=True,
        capture_output=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="从减字字体渲染真减字测试图 + 真值标注")
    ap.add_argument("--out", default=str(HERE / "annotations" / "font_cases.json"))
    ap.add_argument("--images-dir", default=str(HERE / "images"))
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个用例（0=全部）")
    ap.add_argument(
        "--prefix",
        default=",".join(COMPOUND_PREFIXES),
        help=f"只渲这些字形前缀（默认 {','.join(COMPOUND_PREFIXES)}）",
    )
    ap.add_argument("--keep-svg", action="store_true", help="保留中间 SVG")
    args = ap.parse_args()

    if not FONT.exists():
        print(f"[gen] 找不到字体：{FONT}", file=sys.stderr)
        return 1

    prefixes = tuple(p.strip() for p in args.prefix.split(",") if p.strip())
    truths = _ligature_truths(FONT)
    items = [
        (glyph, variants)
        for glyph, variants in sorted(truths.items())
        if glyph.split("_")[0] in prefixes
    ]
    if args.limit:
        items = items[: args.limit]
    if not items:
        print(f"[gen] 前缀 {prefixes} 下没有可反查真值的连字字形", file=sys.stderr)
        return 1

    images_dir = Path(args.images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    built = []
    for glyph_name, variants in items:
        png = images_dir / f"{glyph_name}.png"
        try:
            _rasterize(_svg_for_glyph(FONT, glyph_name), png)
        except Exception as exc:  # 单个字形失败不影响其余
            print(f"[gen] 跳过 {glyph_name}: {exc}", file=sys.stderr)
            continue
        if not args.keep_svg:
            png.with_suffix(".svg").unlink(missing_ok=True)
        record = {
            "id": glyph_name,
            "image": f"images/{glyph_name}.png",
            "media_type": "image/png",
            "ground_truth_glyph": variants[0],
            "note": CASE_NOTES.get(glyph_name, ""),
        }
        if len(variants) > 1:
            record["ground_truth_alts"] = variants[1:]
        built.append(record)
        alts = f" (+{'/'.join(variants[1:])})" if len(variants) > 1 else ""
        print(f"[gen] {glyph_name:14s} -> {variants[0]}{alts}  ({png.stat().st_size // 1024} KB)")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "mode": "single",
        "source": (
            "font: TaiYinJianZiPuKaiTi.ttf，真值由 GSUB 连字表反查"
            "（gen_font_cases.py 生成）"
        ),
        "items": built,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[gen] 写了 {len(built)} 条标注 -> {out}")
    if not built:
        print("[gen] 没有任何用例成功，检查字体/ImageMagick", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
