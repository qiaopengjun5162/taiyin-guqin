#!/usr/bin/env python3
"""从项目自带减字字体渲染「真减字」测试图，并生成真值标注。

为什么需要它
------------
`sample_single.json` 里的 `images/*.png` 是**手工摆放**的示例，靠人眼看图写
`ground_truth_glyph`，一次只能做几张、且无法复现。而字体里的连字字形本身就是
**真实的减字谱写法**（GSUB 把「仰」+「托」合成一个 `lg_yangtuo` 字形），于是可以
按字形名取轮廓直接出图，真值就是该字形对应的文本 —— 数据集可无限扩大、零人工。

用法
----
    python3 gen_font_cases.py                  # 渲染全部内置用例
    python3 gen_font_cases.py --limit 4        # 只渲前 4 个（快速冒烟）
    python3 gen_font_cases.py --out annotations/font_cases.json

产出
----
- `images/<id>.png`：白底黑字减字图（供后端识别）
- `annotations/font_cases.json`：`mode: single` 的标注文件，**不含** `predicted`
  字段 —— 即「在线跑」，由后端真实识别后再计分。

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

# 内置用例：字形名 → (真值文本, 说明)
# 只挑语义明确的字形，避免把「组合触发字符」误当谱字文本。
CASES: dict[str, tuple[str, str]] = {
    "md_1": ("一弦", "弦序一"),
    "md_2": ("二弦", "弦序二"),
    "md_3": ("三弦", "弦序三"),
    "md_4": ("四弦", "弦序四"),
    "md_5": ("五弦", "弦序五"),
    "md_6": ("六弦", "弦序六"),
    "md_7": ("七弦", "弦序七"),
    "lg_yangtuo": ("仰托", "左手仰势 + 右手指法托"),
    "lgw_quanfu": ("全扶", "右手指法全扶"),
    "xl_santan": ("散弹", "散音重弹（三弹）"),
}


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
    ap.add_argument("--keep-svg", action="store_true", help="保留中间 SVG")
    args = ap.parse_args()

    if not FONT.exists():
        print(f"[gen] 找不到字体：{FONT}", file=sys.stderr)
        return 1

    images_dir = Path(args.images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    items = list(CASES.items())
    if args.limit:
        items = items[: args.limit]

    built = []
    for glyph_name, (truth, note) in items:
        png = images_dir / f"{glyph_name}.png"
        try:
            _rasterize(_svg_for_glyph(FONT, glyph_name), png)
        except Exception as exc:  # 单个字形失败不影响其余
            print(f"[gen] 跳过 {glyph_name}: {exc}", file=sys.stderr)
            continue
        if not args.keep_svg:
            png.with_suffix(".svg").unlink(missing_ok=True)
        built.append(
            {
                "id": glyph_name,
                "image": f"images/{glyph_name}.png",
                "media_type": "image/png",
                "ground_truth_glyph": truth,
                "note": note,
            }
        )
        print(f"[gen] {glyph_name:14s} -> {truth:6s} ({png.stat().st_size // 1024} KB)")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "mode": "single",
        "source": "font: TaiYinJianZiPuKaiTi.ttf（由 gen_font_cases.py 生成）",
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
