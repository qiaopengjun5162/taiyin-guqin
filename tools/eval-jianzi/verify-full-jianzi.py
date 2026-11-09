#!/usr/bin/env python3
"""方向 A 可行性验证：若模板索引装的是「完整减字」，识别能走到哪一步。

背景
----
`docs/articles/material/2026-11-09-真谱适用性判定-识别结构性失效.md` 判定：
生产模板索引（257 模板 / 385 文本）里 **0 条标准完整减字**，全是字体 GSUB
预烘焙的复合指法符号，与编辑器产出的「大九勾四」不是同一套字符串空间。
本脚本量化「把索引重建为完整减字」这条修复路能走多远。

与 `template_match.py` 的关系
----------------------------
只复用它的 `normalize` / `match_image`（同一套归一化 + 最近邻）；**不写、
不改任何生产索引**。`template_match.py` 的 `_svg_for_glyph` 只能按单字形名
出图，渲染不了「大九勾四」这种由构件经 GSUB 动态叠压的合成减字，所以这里
改用 `hb-view`（HarfBuzz，原生 GSUB 整字合成）按 `jianziToText` 的输出串渲染
—— 与浏览器编辑器同源字体、同源整字合成。

诚实边界（重要）
---------------
1. 自检索是**同分布闭集自匹配**（训练=测试），命中率只证明「给对内容，算法
   就能检索」，**不构成任何准确率或能力结论**，不得当卖点引用。
2. 全部输入是干净合成图，不声称拍照/扫描件鲁棒性；噪声实验恰恰是在量化
   这条边界从哪开始失效。
3. 本脚本只做可行性判定，不产出可上线索引。

依赖：harfbuzz 的 `hb-view`、Pillow、numpy、fontTools（后三者同 template_match）。

用法
----
    python3 verify-full-jianzi.py                 # 跑全部三组
    python3 verify-full-jianzi.py --mode algo    # 只跑算法层（自检索 + 干扰项）
    python3 verify-full-jianzi.py --mode scale   # 只跑规模层
    python3 verify-full-jianzi.py --mode noise   # 只跑扰动/拒识
    python3 verify-full-jianzi.py --self-test    # 闸门自身校验（渲染 + 归一化）
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import template_match as tm  # noqa: E402

REPO = HERE.parent.parent
FONT = REPO / "apps" / "web" / "public" / "fonts" / "WangJiJianZiPuKaiTi.ttf"
CACHE = HERE / ".cache" / "full_jianzi"
SIZE = 64  # 与 template_match.SIZE 一致

# 代表性完整减字：覆盖 散 / 按 / 泛 三类，不同指法、徽位、弦序
REPRESENTATIVE = [
    "散勾四", "散挑七", "散抹三", "散打二",
    "大九勾四", "名七挑三", "大七剔二", "食九抹六",
    "大六勾一", "名十挑五", "大八勾二", "名九抹四",
    "泛七勾四", "泛九挑三", "泛六抹二",
]
# 复合指法符号：当前生产索引里那类「假减字」单元，用作干扰项
DISTRACTORS = ["仰托", "勾剔", "抹勾", "间勾"]

# 只差一位数字的近似减字组（检验可分性）
NEAR_GROUPS = {
    "只差弦序": ["大九勾一", "大九勾二", "大九勾三", "大九勾四", "大九勾五", "大九勾六", "大九勾七"],
    "只差徽位": ["大七勾四", "大八勾四", "大九勾四", "大十勾四"],
    "只差右指": ["大九勾四", "大九挑四", "大九抹四", "大九剔四"],
}
NOISE_CONDITIONS = [
    "none", "noise-0.5", "noise-1", "noise-2", "noise-5",
    "blur-1", "blur-2", "scale-0.8", "scale-0.9", "scale-1.1", "shift",
]
# 扰动实验的对照组：刻意跨音色、跨指法，与「近似组」形成可分性对照。
# 必须显式列出——用 REPRESENTATIVE[:8] 切片会换一组样本，数字对不上文档。
NOISE_WIDE = [
    "散勾四", "散挑七", "散抹三", "大九勾四",
    "名七挑三", "大七剔二", "泛七勾四", "泛九挑三",
]


def _require_env() -> None:
    if not FONT.exists():
        raise SystemExit(f"找不到字体：{FONT}")
    if not shutil.which("hb-view"):
        raise SystemExit(
            "需要 harfbuzz 的 hb-view 来渲染 GSUB 合成减字"
            "（macOS: brew install harfbuzz）"
        )
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
    except FileExistsError:
        pass


def render(text: str) -> Path:
    """按 jianziToText 的输出串渲染合成减字图（hb-view，原生 GSUB）。"""
    h = hashlib.md5(text.encode("utf-8")).hexdigest()[:10]
    p = CACHE / f"{h}.png"
    if not p.exists():
        subprocess.run(
            ["hb-view", str(FONT), text,
             "--background=#FFFFFF", "--foreground=#000000",
             "--margin=16", "-o", str(p)],
            check=True, capture_output=True,
        )
    return p


def build_index(items: list[str]) -> dict:
    """用给定减字串建临时索引（只在内存，不落生产文件）。"""
    names, truths, vecs = [], [], []
    for s in items:
        names.append(s)
        truths.append([s])
        vecs.append(tm.normalize(render(s)).reshape(-1))
    return {"names": names, "truths": truths, "vecs": np.stack(vecs)}


def match_pil(index: dict, img: Image.Image, topk: int = 3) -> dict:
    """对内存里的 PIL 图做最近邻（match_image 只吃路径，这里复用其公式）。"""
    q = tm.normalize(img).reshape(-1)
    d = np.sqrt(((index["vecs"] - q) ** 2).sum(axis=1))
    order = np.argsort(d)[:topk]
    best = int(order[0])
    return {
        "truth": index["truths"][best][0],
        "distance": float(d[best]),
        "margin": float(d[order[1]]) - float(d[best]) if len(order) > 1 else float("inf"),
        "topk": [index["truths"][int(k)][0] for k in order],
    }


def perturb(img: Image.Image, kind: str, rng) -> Image.Image:
    """与 template_match.cmd_robust 同一套扰动条件，保证口径一致。"""
    img = img.convert("L")
    w, h = img.size
    if kind == "none":
        return img
    if kind == "shift":
        canvas = Image.new("L", (w + 30, h + 30), 255)
        canvas.paste(img, (22, 8))
        return canvas
    if kind.startswith("noise-"):
        pct = float(kind.split("-")[1]) / 100.0
        arr = np.asarray(img).copy()
        mask = rng.random(arr.shape) < pct
        arr[mask] = 255 - arr[mask]
        return Image.fromarray(arr)
    if kind.startswith("blur-"):
        return img.filter(ImageFilter.GaussianBlur(float(kind.split("-")[1])))
    if kind.startswith("scale-"):
        f = float(kind.split("-")[1])
        return img.resize((max(1, int(w * f)), max(1, int(h * f))), Image.BILINEAR)
    raise ValueError(kind)


def mode_algo() -> None:
    """算法层：给对内容，最近邻能否正确检索 + 复合符号是否印证单元错配。"""
    idx = build_index(REPRESENTATIVE)
    print(f"索引含 {len(REPRESENTATIVE)} 个完整减字模板（散/按/泛三类）\n")

    print("--- 自检索（同分布闭集，只证明算法检索正确性）---")
    ok = 0
    margins = []
    for s in REPRESENTATIVE:
        r = match_pil(idx, Image.open(render(s)))
        ok += (r["truth"] == s)
        margins.append(r["margin"])
        if s in REPRESENTATIVE[:3]:
            print(f"  {s}: 预测={r['truth']} 距离={r['distance']:.2f} margin={r['margin']:.2f}")
    print(f"  命中 {ok}/{len(REPRESENTATIVE)}，margin 最小={min(margins):.2f} "
          f"平均={np.mean(margins):.2f} 最大={max(margins):.2f}")

    print("\n--- 干扰项：复合指法符号喂进完整减字索引 ---")
    for s in DISTRACTORS:
        r = match_pil(idx, Image.open(render(s)))
        print(f"  {s}: 最像={r['truth']} 距离={r['distance']:.2f} "
              f"margin={r['margin']:.2f} top3={r['topk']}")
    print("  → margin 普遍 <2（谁都不像、硬挑一个），印证当前生产索引『单元错配』")


def mode_scale() -> None:
    """规模层：完整减字空间笛卡尔积 + 线上全量索引体积。"""
    # 取自 apps/web/src/lib/types.ts DEFAULT_KEYBOARD（真实取值集）
    left, hui, fen, slide, right, string = 5, 13, 11, 4, 12, 7
    san = right * string
    fan = left * hui * fen * right * string          # 泛音无 slide
    an = left * hui * fen * slide * right * string   # 按音全字段
    total = san + fan + an
    raw = SIZE * SIZE
    b64 = raw * 4 // 3

    print(f"字段集：左指{left} × 徽位{hui} × 分位{fen} × 走手音{slide} × 右指{right} × 弦序{string}")
    print(f"  散音 = {right}×{string} = {san:,}")
    print(f"  泛音 = {left}×{hui}×{fen}×{right}×{string} = {fan:,}")
    print(f"  按音 = {left}×{hui}×{fen}×{slide}×{right}×{string} = {an:,}")
    print(f"  合计 ≈ {total:,} 个完整减字（理论笛卡尔积；实际合法组合略少，量级不变）")
    print(f"\n单模板 {raw}B(raw) / {b64}B(base64)")
    print(f"  索引(raw)          ≈ {total * raw / 1024 / 1024:,.0f} MB")
    print(f"  索引(base64 JSON)  ≈ {total * b64 / 1024 / 1024:,.0f} MB")
    print(f"  现状：257 模板 ≈ 1.4 MB，`loadTemplateIndex` 一次性 fetch 全量进内存")
    print(f"  → 放大 {total / 257:,.0f}×，线上全量索引不可行")


def mode_noise() -> None:
    """质量层：近似减字可分性 + 扰动下 margin 衰减 + 无拒识。"""
    print("--- 干净合成图上的近似减字可分性 ---")
    for gname, items in NEAR_GROUPS.items():
        idx = build_index(items)
        ok, margins = 0, []
        for s in items:
            r = match_pil(idx, Image.open(render(s)))
            ok += (r["truth"] == s)
            margins.append(r["margin"])
        print(f"  {gname}({len(items)}个): 命中 {ok}/{len(items)}  "
              f"margin 最小={min(margins):.2f} 平均={np.mean(margins):.2f} 最大={max(margins):.2f}")
    print("  → 无噪条件下近似减字仍可分（曾预设会坍缩，实测证否）\n")

    print("--- 扰动下：命中率 与 margin（真谱适用性的量化边界）---")
    near = NEAR_GROUPS["只差弦序"]
    wide = NOISE_WIDE
    for label, items in (("近似减字·只差弦序(7)", near), ("差异大·跨音色跨指法(8)", wide)):
        idx = build_index(items)
        print(f"\n  [{label}]")
        print(f"  {'扰动':14s} {'命中':>7s} {'命中率':>8s} {'平均margin':>11s} {'最小margin':>11s}")
        for cond in NOISE_CONDITIONS:
            rng = np.random.default_rng(42)
            ok, margins = 0, []
            for s in items:
                img = perturb(Image.open(render(s)), cond, rng)
                r = match_pil(idx, img)
                ok += (r["truth"] == s)
                margins.append(r["margin"])
            print(f"  {cond:14s} {ok:3d}/{len(items):<3d} {ok / len(items) * 100:6.1f}% "
                  f"{np.mean(margins):11.2f} {min(margins):11.2f}")

    print("\n--- 无拒识：根本不是减字的输入，会不会照样被『认』 ---")
    idx = build_index(["散勾四", "大九勾四", "名七挑三", "泛七勾四", "大七剔二"])
    rng = np.random.default_rng(42)
    grid = np.indices((300, 300))
    cases = {
        "全白纸": np.full((300, 300), 255, dtype=np.uint8),
        "随机椒盐噪点": np.where(rng.random((300, 300)) < 0.15, 0, 255).astype(np.uint8),
        "纯黑方块": np.where((grid[0] > 80) & (grid[0] < 220) &
                             (grid[1] > 80) & (grid[1] < 220), 0, 255).astype(np.uint8),
    }
    for cname, arr in cases.items():
        r = match_pil(idx, Image.fromarray(arr, "L"))
        print(f"  {cname}: 仍返回「{r['truth']}」 距离={r['distance']:.2f} "
              f"margin={r['margin']:.2f}  ← 无任何拒绝门槛")
    print("\n  → 噪声下 margin 比命中率更早归零；且匹配器无门槛，"
          "非减字输入也会硬返回一个减字：不是『识别不准』，是『不知道自己不准』")


def self_test() -> int:
    """闸门自身校验：hb-view 能渲染出合成减字、归一化非全白、自检索闭环。"""
    try:
        _require_env()
        p = render("大九勾四")
        arr = np.asarray(Image.open(p).convert("L"))
        if not (arr < 128).any():
            print("FAIL: 渲染结果全白")
            return 1
        ys, xs = np.where(arr < 128)
        aspect = (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)
        if aspect > 0.95:
            print(f"FAIL: 宽高比 {aspect:.2f}，GSUB 未把 4 字叠压成竖排减字")
            return 1
        vec = tm.normalize(p)
        if vec.shape != (SIZE, SIZE) or not (vec > 0).any():
            print("FAIL: 归一化结果异常")
            return 1
        idx = build_index(["大九勾四", "散勾四"])
        r = match_pil(idx, Image.open(render("大九勾四")))
        if r["truth"] != "大九勾四":
            print(f"FAIL: 自检索应为 大九勾四，实际 {r['truth']}")
            return 1
        print(f"PASS: hb-view 合成减字宽高比 {aspect:.2f}（竖叠），归一化与自检索闭环")
        return 0
    except Exception as exc:
        print(f"FAIL: {exc}")
        return 1


def main() -> int:
    ap = argparse.ArgumentParser(description="方向 A 可行性验证（完整减字模板索引）")
    ap.add_argument("--mode", choices=["all", "algo", "scale", "noise"], default="all")
    ap.add_argument("--self-test", action="store_true", help="闸门自身校验")
    args = ap.parse_args()
    if args.self_test:
        return self_test()

    _require_env()
    if args.mode in ("all", "algo"):
        print("=== 算法层：给对内容，最近邻能否正确检索 ===")
        mode_algo()
    if args.mode in ("all", "scale"):
        print("\n=== 规模层：完整减字空间与线上索引体积 ===")
        mode_scale()
    if args.mode in ("all", "noise"):
        print("\n=== 质量层：近似减字可分性 / 扰动 / 拒识 ===")
        mode_noise()
    print("\n=== 口径提醒 ===")
    print("自检索命中率是同分布闭集自匹配，不构成准确率或能力结论；"
          "全部实验基于干净合成图，不覆盖拍照/扫描件。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
