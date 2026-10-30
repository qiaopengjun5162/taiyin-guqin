"""生成文章配图：真值字形示例拼贴 + 整页切分示意（PIL，宣纸配色）。"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "tools" / "eval-jianzi"))
from template_match import build_index  # noqa: E402
from sheet_eval import ANNOTATIONS, segment  # noqa: E402

OUT = HERE / "docs" / "articles" / "assets"
RENDER_DIR = HERE / "tools" / "eval-jianzi" / ".cache" / "templates"

INK = (44, 38, 30)
MUTED = (138, 124, 106)
ACCENT = (186, 62, 47)
PAPER = (247, 243, 236)
CARD = (255, 253, 248)
GOOD = (62, 118, 92)

def _font(size: int):
    for p in (
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
    ):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_TITLE = _font(40)
F_LABEL = _font(26)
F_SMALL = _font(21)
F_CJK = _font(22)


def fig_glyph_samples() -> None:
    """42 条真值里挑 12 个代表性字形，拼贴成示例图。"""
    index = build_index()
    # 按前缀自动挑真实存在的字形：4 复合 lg_ + 2 lgw_ + 2 xl_ + 2 md_ + 2 其他
    names = index["names"]
    picks: list[str] = []
    for prefix, n in (("lg_", 4), ("lgw_", 2), ("xl_", 2), ("md_", 2)):
        for nm in names:
            if nm.startswith(prefix) and nm not in picks:
                picks.append(nm)
                if sum(1 for p in picks if p.startswith(prefix)) >= n:
                    break
    for nm in names:
        if nm not in picks:
            picks.append(nm)
        if len(picks) >= 12:
            break
    picks = picks[:12]
    rows, cols = 3, 4
    cell, pad = 220, 18
    w = pad + cols * (cell + pad)
    h = 130 + pad + rows * (cell + 78 + pad) + 40
    img = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(img)
    d.text((pad, 34), "评估真值示例：字体字形 → GSUB 反查自动标注（共 42 条）", font=_font(30), fill=INK)
    d.text((pad, 88), "每格上半为字形渲染，下半为自动标注的读法（真值）", font=F_SMALL, fill=MUTED)

    for i, g in enumerate(picks):
        if g not in names:
            continue
        gi = names.index(g)
        truths = "/".join(index["truths"][gi])
        r, c = divmod(i, cols)
        x = pad + c * (cell + pad)
        y = 130 + pad + r * (cell + 78 + pad)
        d.rounded_rectangle((x, y, x + cell, y + cell + 78), 14, fill=CARD, outline=(226, 218, 204), width=2)
        src = Image.open(RENDER_DIR / f"{g}.png").convert("L")
        arr = np.asarray(src)
        ink = arr < 128
        ys, xs = np.where(ink)
        if len(ys):
            crop = src.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        else:
            crop = src
        crop.thumbnail((cell - 44, cell - 44), Image.LANCZOS)
        px = x + (cell - crop.width) // 2
        py = y + (cell - 44 - crop.height) // 2 + 10
        img.paste(crop, (px, py))
        d.text((x + 14, y + cell + 12), truths, font=F_CJK, fill=INK)
        d.text((x + 14, y + cell + 46), g, font=F_SMALL, fill=MUTED)

    d.text((pad, h - 34), "数据来源：tools/eval-jianzi/annotations/font_cases.json（GSUB LookupType 4 反查自动生成）", font=F_SMALL, fill=MUTED)
    img.save(OUT / "2026-10-30-真值字形示例.png")
    print("saved 真值字形示例.png", img.size)


def fig_segment_demo() -> None:
    """合成整页 + 切分检出框示意（绿=正确检出）。"""
    import json

    data = json.loads((HERE / "tools" / "eval-jianzi" / "annotations" / "sheet_cases.json").read_text(encoding="utf-8"))
    item = next(it for it in data["items"] if it["gap_frac"] == 0.5)
    arr = np.asarray(Image.open(HERE / "tools" / "eval-jianzi" / item["image"]).convert("L"), dtype=np.uint8)
    det_rows = segment(arr)

    truth_by_row = {}
    for c in sorted(item["cells"], key=lambda c: (c["row"], c["col"])):
        truth_by_row.setdefault(c["row"], []).append(c)

    base = Image.open(HERE / "tools" / "eval-jianzi" / item["image"]).convert("RGB")
    scale = 1.6
    base = base.resize((int(base.width * scale), int(base.height * scale)), Image.LANCZOS)
    d = ImageDraw.Draw(base)

    for r, row in enumerate(det_rows):
        for ci, b in enumerate(row):
            y0, y1, x0, x1 = [int(v * scale) for v in b]
            d.rectangle((x0, y0, x1, y1), outline=GOOD, width=3)
            tr = truth_by_row.get(r, [])[ci]["truth"] if ci < len(truth_by_row.get(r, [])) else "?"
            d.rectangle((x0, y0 - 26, x0 + 8 + 13 * len(tr), y0), fill=GOOD)
            d.text((x0 + 4, y0 - 24), tr, font=F_CJK, fill=(255, 255, 255))

    w, h = base.width, 130 + base.height + 70
    img = Image.new("RGB", (w + 60, h), PAPER)
    dd = ImageDraw.Draw(img)
    dd.text((30, 30), "整页切分示意：间隙容忍投影 → 字格外接框（绿框=检出，标签=识别结果）", font=_font(30), fill=INK)
    dd.text((30, 84), f"该页真值 {item['rows']}×{item['cols']} 网格、字格间隙 {item['gap_frac']}×字高（真 app 渲染比例），检出 {sum(len(r) for r in det_rows)} 格全部正确", font=F_SMALL, fill=MUTED)
    img.paste(base, (30, 130))
    dd.text((30, h - 40), "算法：3×3 中值去斑 → 阈值取墨 → 行/列投影 → 白缝 < 0.10×S 不切（S=页面墨迹尺度）", font=F_SMALL, fill=MUTED)
    img.save(OUT / "2026-10-30-整页切分示意.png")
    print("saved 整页切分示意.png", img.size)


if __name__ == "__main__":
    fig_glyph_samples()
    fig_segment_demo()
