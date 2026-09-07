#!/usr/bin/env python3
"""
太音 · 减字谱字形预览画廊（开发调试用）

从 apps/web/src/lib/svg-paths.ts 提取字形数据，生成一份自包含 HTML：
  1) 部件字形总览（全部 SVG_PATHS）
  2) 完整减字拼合预览 —— 严格复刻 SvgJianziBlock 的四象限百分比布局，
     用于在改字形/改布局后肉眼核对效果，无需起 dev server。

用法：
    python3 scripts/preview-jianzi-gallery.py [输出路径]
默认输出：docs/preview/jianzi-gallery.html
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_PATHS_TS = os.path.join(ROOT, "apps/web/src/lib/svg-paths.ts")
DEFAULT_OUT = os.path.join(ROOT, "docs/preview/jianzi-gallery.html")

# ── 与 svg-jianzi-block.tsx 保持一致的映射 ──────────────────
HUI_MAP = {
    "一": "hui_1", "二": "hui_2", "三": "hui_3", "四": "hui_4", "五": "hui_5",
    "六": "hui_6", "七": "hui_7", "八": "hui_8", "九": "hui_9", "十": "hui_10",
    "十一": "hui_11", "十二": "hui_12", "十三": "hui_13",
}
FEN_MAP = {"半": "fen_ban", "三分": "fen_3", "六分": "fen_6", "八分": "fen_8"}
LEFT_FINGER_MAP = {
    "大": "lh_da", "夕": "lh_ming", "名": "lh_ming",
    "中": "lh_zhong", "亻": None, "跪": "lh_gui",
}
RIGHT_ACTION_MAP = {
    "勾": "rh_gou", "勹": "rh_gou", "挑": "rh_tiao", "乚": "rh_tiao",
    "抹": "rh_mo", "木": "rh_mo", "托": "rh_tuo", "乇": "rh_tuo",
    "打": "rh_da", "丁": "rh_da", "擘": "rh_pi", "劈": "rh_pi", "尸": "rh_pi",
    "摘": "rh_zhai", "倽": "rh_zhai", "剔": "rh_ti",
}
STRING_MAP = {
    "一": "str_1", "二": "str_2", "三": "str_3", "四": "str_4",
    "五": "str_5", "六": "str_6", "七": "str_7",
}

# 展示用分组标签
GROUP_LABEL = {
    "top_": "顶帽（音色）",
    "lh_": "左手指法",
    "hui_": "徽位",
    "fen_": "分位",
    "rh_": "右手指法（半包围外壳）",
    "str_": "弦序（内核）",
}


def load_glyphs():
    src = open(SVG_PATHS_TS, encoding="utf-8").read()
    entries = {}
    pattern = re.compile(
        r'^  "([^"]+)": \{ d: (".*?"), bbox: (\{.*?\}|null) \},$', re.M
    )
    for m in pattern.finditer(src):
        key, d, bbox = m.group(1), json.loads(m.group(2)), json.loads(m.group(3))
        entries[key] = {"d": d, "bbox": bbox}
    if not entries:
        raise SystemExit(f"未能从 {SVG_PATHS_TS} 解析出字形，检查文件格式")
    return entries


def glyph_svg(entries, key, px):
    """复刻 GlyphSVG：字体坐标(y 向上) → SVG 坐标(y 向下)，y 翻转 + 平移。"""
    e = entries.get(key)
    if not e or not e.get("bbox"):
        return ""
    b = e["bbox"]
    w, h = b["xMax"] - b["xMin"], b["yMax"] - b["yMin"]
    if w <= 0 or h <= 0:
        return ""
    return (
        f'<svg viewBox="{b["xMin"]} 0 {w} {h}" preserveAspectRatio="xMidYMid meet" '
        f'style="width:100%;height:100%">'
        f'<g transform="scale(1, -1) translate(0, {-b["yMax"]})">'
        f'<path d="{e["d"]}" fill="#1c1b1a"/></g></svg>'
    )


def render_jianzi(entries, state, px=72):
    """按 SvgJianziBlock 的四象限百分比布局拼合一个完整减字。"""
    tone = state.get("toneType")
    left_finger = state.get("leftFinger")
    hui = state.get("hui")
    fen = state.get("fen")
    if tone == "散":  # 散音无左手指法/徽位/分位
        left_finger = hui = fen = None

    top_key = "top_fan" if tone == "泛" else "top_san" if tone == "散" else None
    lh_key = LEFT_FINGER_MAP.get(left_finger) if left_finger else None
    hui_key = HUI_MAP.get(hui) if hui else None
    fen_key = FEN_MAP.get(fen) if fen else None
    act_key = RIGHT_ACTION_MAP.get(state.get("rightAction")) if state.get("rightAction") else None
    str_key = STRING_MAP.get(state.get("stringNumber")) if state.get("stringNumber") else None

    # 左手指法无 SVG path → 回退系统楷体（亻 显示为「食」）
    text_finger = None
    if left_finger and not (lh_key and entries.get(lh_key)):
        text_finger = "食" if left_finger == "亻" else left_finger

    W, H = px, px * 1.4
    parts = []

    def box(style, inner):
        if inner:
            parts.append(f'<div style="position:absolute;{style}">{inner}</div>')

    box(f"top:2%;left:50%;transform:translateX(-50%);width:44%;height:16%",
        glyph_svg(entries, top_key, px))
    box(f"top:17%;left:3%;width:34%;height:24%", glyph_svg(entries, lh_key, px))
    if text_finger:
        parts.append(
            f'<div style="position:absolute;top:28%;left:18%;transform:translate(-50%,-50%);'
            f'font-size:{px*0.28:.0f}px;font-family:KaiTi,STKaiti,serif;color:#1c1b1a;line-height:1">'
            f"{text_finger}</div>"
        )
    box(f"top:17%;right:3%;width:34%;height:22%", glyph_svg(entries, hui_key, px))
    box(f"top:38%;right:3%;width:26%;height:9%", glyph_svg(entries, fen_key, px))
    box(f"bottom:1%;left:0;width:100%;height:56%", glyph_svg(entries, act_key, px))
    if str_key:
        if act_key:
            box(f"bottom:19%;left:50%;transform:translateX(-50%);width:28%;height:20%",
                glyph_svg(entries, str_key, px))
        else:
            box(f"bottom:22%;left:50%;transform:translateX(-50%);width:38%;height:28%",
                glyph_svg(entries, str_key, px))

    return f'<div style="position:relative;display:inline-block;width:{W}px;height:{H}px">{"".join(parts)}</div>'


# 典型减字样例（覆盖各音色/降级分支）
SAMPLES = [
    {"label": "散勾五", "note": "散音·无顶帽降级分支外",
     "state": {"toneType": "散", "rightAction": "勾", "stringNumber": "五"}},
    {"label": "大九勾四", "note": "按音·标准四象限",
     "state": {"toneType": "按", "leftFinger": "大", "hui": "九", "rightAction": "勾", "stringNumber": "四"}},
    {"label": "泛 名十勾三", "note": "泛音·触发 SVG 降级",
     "state": {"toneType": "泛", "leftFinger": "名", "hui": "十", "rightAction": "勾", "stringNumber": "三"}},
    {"label": "大七半勾二", "note": "带分位",
     "state": {"toneType": "按", "leftFinger": "大", "hui": "七", "fen": "半", "rightAction": "勾", "stringNumber": "二"}},
    {"label": "夕九挑七", "note": "名指偏旁·SVG 有 path",
     "state": {"toneType": "按", "leftFinger": "夕", "hui": "九", "rightAction": "挑", "stringNumber": "七"}},
    {"label": "亻九勾三", "note": "食指偏旁·字体无码位→楷体「食」",
     "state": {"toneType": "按", "leftFinger": "亻", "hui": "九", "rightAction": "勾", "stringNumber": "三"}},
    {"label": "大打七", "note": "右手指法「打」·触发 SVG 降级",
     "state": {"toneType": "按", "leftFinger": "大", "rightAction": "打", "stringNumber": "七"}},
    {"label": "中十剔六", "note": "中指 + 剔",
     "state": {"toneType": "按", "leftFinger": "中", "hui": "十", "rightAction": "剔", "stringNumber": "六"}},
]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    entries = load_glyphs()

    # 部件总览（按前缀分组）
    groups = {}
    for key in sorted(entries):
        prefix = next((p for p in GROUP_LABEL if key.startswith(p)), "其他")
        groups.setdefault(prefix, []).append(key)

    gallery = []
    for prefix, keys in groups.items():
        cells = "".join(
            f'<div class="cell"><div class="thumb">{glyph_svg(entries, k, 56)}</div>'
            f'<div class="cap">{k}</div></div>'
            for k in keys
        )
        gallery.append(
            f'<section><h2>{GROUP_LABEL.get(prefix, prefix)} '
            f'<span class="cnt">{len(keys)}</span></h2><div class="grid">{cells}</div></section>'
        )

    samples = "".join(
        f'<div class="cell"><div class="thumb" style="height:104px">'
        f'{render_jianzi(entries, s["state"], 72)}</div>'
        f'<div class="cap"><b>{s["label"]}</b><br/><span class="note">{s["note"]}</span></div></div>'
        for s in SAMPLES
    )

    html = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>太音 · 减字谱字形预览</title>
<style>
  body{{background:#faf9f7;color:#1c1b1a;font-family:-apple-system,"PingFang SC","Noto Serif SC",serif;
       margin:0;padding:32px 28px 64px}}
  h1{{font-size:19px;font-weight:700;letter-spacing:.18em;margin:0 0 4px}}
  .sub{{font-size:12px;color:#8a8578;margin-bottom:28px}}
  section{{margin-bottom:30px}}
  h2{{font-size:13px;font-weight:600;letter-spacing:.1em;color:#5c574c;
      border-bottom:1px solid #e6e2d8;padding-bottom:7px;margin-bottom:14px}}
  .cnt{{font-weight:400;color:#a8a294;font-size:11px;margin-left:6px}}
  .grid{{display:flex;flex-wrap:wrap;gap:10px}}
  .cell{{width:104px;background:#fff;border:1px solid #eae6dc;border-radius:7px;
         padding:9px 6px 8px;text-align:center}}
  .thumb{{height:64px;display:flex;align-items:center;justify-content:center}}
  .cap{{font-size:10px;color:#6b6659;margin-top:7px;line-height:1.5;word-break:break-all}}
  .note{{color:#a8a294;font-size:9px}}
</style></head><body>
<h1>太音 · 减字谱字形预览</h1>
<div class="sub">共 {len(entries)} 个 SVG 字形 · 布局严格复刻 SvgJianziBlock 四象限百分比定位 · 由 scripts/preview-jianzi-gallery.py 生成</div>
<section><h2>完整减字拼合样例 <span class="cnt">{len(SAMPLES)}</span></h2>
<div class="grid">{samples}</div></section>
{''.join(gallery)}
</body></html>"""

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✓ {len(entries)} 字形 / {len(SAMPLES)} 样例 → {out}")


if __name__ == "__main__":
    main()
