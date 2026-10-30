#!/usr/bin/env python3
"""生成 docs/articles/assets/ 的文章配图（PIL 绘制，无 matplotlib 依赖）。

数据全部来自 tools/eval-jianzi/ 实跑记录（2026-10-30，见 docs/articles/material/）。
输出 PNG（1280px 宽、<500KB），命名 `YYYY-MM-DD-用途.png`。
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent.parent
ASSETS = HERE / "docs" / "articles" / "assets"

W, H = 1280, 720
BG = (250, 248, 243)  # 宣纸白，呼应项目视觉
INK = (38, 38, 38)
MUTED = (120, 116, 108)
ACCENT = (150, 45, 40)  # 印章红
GOOD = (70, 110, 90)  # 丝弦绿
GRID = (220, 215, 205)


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


F_TITLE = _font(42)
F_LABEL = _font(28)
F_SMALL = _font(24)
F_NUM = _font(36)


def _canvas(title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((80, 52), title, font=F_TITLE, fill=INK)
    d.text((80, 118), subtitle, font=F_SMALL, fill=MUTED)
    d.line((80, 162, W - 80, 162), fill=GRID, width=2)
    return img, d


def chart_vs() -> None:
    """42 条同批真字：视觉大模型 vs 模板匹配。"""
    img, d = _canvas(
        "同一批 42 个真减字：两条识别路径的对比",
        "数据来源：tools/eval-jianzi（2026-10-30）· exact_match 与 mean_cer",
    )
    # 两组横向条：exact_match（上）/ 1-CER 近似（下不画，避免造数）→ 只画 exact 双条 + 数字标注
    x0, y0 = 320, 250
    bar_h, gap = 110, 80
    max_w = 700

    for i, (name, exact, cer, color) in enumerate(
        [
            ("通用视觉大模型（deepseek-flash）", 0.0, 1.193, ACCENT),
            ("字形模板匹配（非视觉查表）", 100.0, 0.000, GOOD),
        ]
    ):
        y = y0 + i * (bar_h + gap)
        d.text((80, y + 30), name.split("（")[0], font=F_LABEL, fill=INK)
        d.text((80, y + 68), f"（{name.split('（')[1]}", font=F_SMALL, fill=MUTED)
        # 底槽
        d.rounded_rectangle((x0, y, x0 + max_w, y + bar_h), 8, fill=(238, 234, 226))
        w = int(max_w * exact / 100.0)
        if w > 0:
            d.rounded_rectangle((x0, y, x0 + w, y + bar_h), 8, fill=color)
        # 标注放在条形上方，避免右侧越界
        label = f"exact_match {exact:.0f}%    mean_cer {cer:.3f}"
        d.text((x0, y - 36), label, font=F_LABEL, fill=color)
        if exact == 0.0:
            d.text((x0 + 24, y + 34), "0%", font=F_NUM, fill=ACCENT)

    d.text(
        (80, 600),
        "同一后端、同一批图：0% 不是「差一点」，是失败模式（模板坍缩）使整个路径不可用；"
        "换问题后是 100%。",
        font=F_SMALL,
        fill=MUTED,
    )
    img.save(ASSETS / "2026-10-30-识别两路径对比.png")


def chart_size_curve() -> None:
    """字号-准确率曲线（单字 42 条池）。"""
    img, d = _canvas(
        "字号越小，认得越差：模板匹配的适用边界",
        "数据来源：sheet_eval.py curve --pool 42 · 逐格 exact_match",
    )
    pts = [(24, 59.5), (48, 97.6), (72, 100.0), (192, 100.0)]
    x0, y0, x1, y1 = 160, 240, 1120, 580
    d.line((x0, y1, x1, y1), fill=INK, width=2)
    d.line((x0, y1, x0, y0), fill=INK, width=2)

    def sx(px: float) -> float:
        # x 轴取 sqrt 刻度，让 24/48/72/192 都放得下
        import math

        lo, hi = math.sqrt(16), math.sqrt(220)
        return x0 + (x1 - x0) * (math.sqrt(px) - lo) / (hi - lo)

    # 网格与 y 刻度
    for pct in (0, 25, 50, 75, 100):
        y = y1 - (y1 - y0) * pct / 100.0
        d.line((x0, y, x1, y), fill=GRID, width=1)
        d.text((x0 - 70, y - 16), f"{pct}%", font=F_SMALL, fill=MUTED)

    prev = None
    for px, acc in pts:
        x, y = sx(px), y1 - (y1 - y0) * acc / 100.0
        if prev:
            d.line((*prev, x, y), fill=ACCENT, width=5)
        prev = (x, y)
        d.ellipse((x - 10, y - 10, x + 10, y + 10), fill=ACCENT)
        # 首点标签左移抬高，避开折线
        dx, dy = (-96, -18) if px == 24 else (-34, -52)
        d.text((x + dx, y + dy), f"{acc:.1f}%", font=F_LABEL, fill=INK)
        d.text((x - 34, y1 + 18), f"{px}px", font=F_SMALL, fill=MUTED)

    d.text(
        (160, 640),
        "结论：字高 ≥72px 时 42/42 = 100%；24px 时小标记被像素吃掉（59.5%）。识别整页请用 ≥3× 导出。",
        font=F_SMALL,
        fill=MUTED,
    )
    img.save(ASSETS / "2026-10-30-字号准确率曲线.png")


def chart_gap() -> None:
    """整页切分的间隙边界。"""
    img, d = _canvas(
        "整页切分：间隙小于 0.1×字高就切不开",
        "数据来源：sheet_eval.py eval（12 张/档）· 白缝=字格间空隙与字高之比",
    )
    pts = [
        (0.0, 0.0, 0),
        (0.05, 0.0, 0),
        (0.1, 99.5, 12),
        (0.2, 99.5, 12),
        (0.3, 99.0, 12),
        (0.5, 99.0, 12),
    ]
    x0, y0, x1, y1 = 160, 240, 1120, 580
    d.line((x0, y1, x1, y1), fill=INK, width=2)
    d.line((x0, y1, x0, y0), fill=INK, width=2)

    def sx(g: float) -> float:
        return x0 + (x1 - x0) * (g / 0.55)

    for pct in (0, 25, 50, 75, 100):
        y = y1 - (y1 - y0) * pct / 100.0
        d.line((x0, y, x1, y), fill=GRID, width=1)
        d.text((x0 - 70, y - 16), f"{pct}%", font=F_SMALL, fill=MUTED)

    prev = None
    for g, acc, struct in pts:
        x, y = sx(g), y1 - (y1 - y0) * acc / 100.0
        if prev:
            d.line((*prev, x, y), fill=GOOD, width=5)
        prev = (x, y)
        color = GOOD if struct == 12 else ACCENT
        d.ellipse((x - 10, y - 10, x + 10, y + 10), fill=color)
        # 0% 点标签抬到点上方、99% 点标签避开顶部注释
        dy = -40 if acc < 50 else -52
        dx = -20 if g == 0.5 else -40
        d.text((x + dx, y + dy), f"{acc:.1f}%", font=F_SMALL, fill=INK)
        d.text((x - 44, y1 + 18), f"{g:g}×", font=F_SMALL, fill=MUTED)

    # 真 app 参考线（注释放线下方，避免与顶部数据标签重叠）
    xa = sx(0.5)
    d.line((xa, y0 + 40, xa, y1), fill=(180, 170, 150), width=2)
    d.text((xa - 300, y0 + 48), "真 app 间隙 0.5×字高 →", font=F_SMALL, fill=MUTED)

    d.text(
        (160, 640),
        "红线点=结构切分失败（12 张里 0 张网格正确）；绿线点=12/12 结构全对，逐格 99%+。",
        font=F_SMALL,
        fill=MUTED,
    )
    img.save(ASSETS / "2026-10-30-切分间隙边界.png")


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    chart_vs()
    chart_size_curve()
    chart_gap()
    for p in sorted(ASSETS.glob("2026-10-30-*.png")):
        print(f"{p.name}  {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
