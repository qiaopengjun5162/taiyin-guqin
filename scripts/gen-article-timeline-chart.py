"""生成《五个月》一文的提交时间线图：每月提交数柱状 + 累计线。"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path("/Users/qiaopengjun/Code/Rust/taiyin-guqin/docs/articles/assets/2026-10-31-提交时间线.png")

W, H = 1200, 620
BG = (250, 247, 241)
INK = (32, 28, 24)
MUTE = (118, 110, 100)
BAR = (46, 62, 74)
ACC = (176, 58, 46)
LINE = (205, 196, 182)

FONTS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
]
def load(size):
    for p in FONTS:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()

months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
vals = [32, 9, 22, 4, 41, 22]
cum = list(np.cumsum(vals))

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
f_title = load(30)
f_axis = load(19)
f_val = load(18)

d.text((56, 34), "2026-05-24 → 2026-10-30：130 次提交，按月分布", font=f_title, fill=INK)
d.text((56, 78), "数据来源：git log --format=%ad --date=format:%Y-%m | sort | uniq -c",
       font=load(15), fill=MUTE)

L, R, TOP, BOT = 96, W - 60, 150, 500
plot_h = BOT - TOP
maxv = 45
# 横向网格
for i in range(6):
    y = BOT - plot_h * i / 5
    d.line([(L, y), (R, y)], fill=LINE, width=1)
    d.text((L - 46, y - 9), str(int(maxv * i / 5)), font=f_axis, fill=MUTE)

bw = (R - L) / len(months)
bar_w = bw * 0.5
for i, (m, v) in enumerate(zip(months, vals)):
    cx = L + bw * (i + 0.5)
    h = plot_h * v / maxv
    x0, x1 = cx - bar_w / 2, cx + bar_w / 2
    d.rectangle([x0, BOT - h, x1, BOT], fill=BAR)
    d.text((cx - 26, BOT - h - 28), str(v), font=f_val, fill=INK)
    d.text((cx - 34, BOT + 12), m.replace("2026-", ""), font=f_axis, fill=MUTE)

# 累计折线（右轴）
pts = []
for i, c in enumerate(cum):
    cx = L + bw * (i + 0.5)
    y = BOT - plot_h * c / 140
    pts.append((cx, y))
d.line(pts, fill=ACC, width=3, joint="curve")
for (x, y), c in zip(pts, cum):
    d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=ACC)
d.text((pts[-1][0] - 30, pts[-1][1] - 30), f"累计 {cum[-1]}", font=f_val, fill=ACC)

d.text((56, 556), "柱：当月提交数（左轴）   线：累计提交数（右轴）",
       font=load(16), fill=MUTE)

img.save(str(OUT))
print("saved", OUT, img.size)
