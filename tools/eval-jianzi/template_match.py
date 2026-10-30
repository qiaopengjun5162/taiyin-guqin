#!/usr/bin/env python3
"""电子谱面减字「模板匹配」识别 —— 不走视觉大模型的第二条路。

为什么需要它
------------
视觉大模型（deepseek-flash 等）在 42 条字体真字上 exact_match = 0%（模板坍缩，
在背提示词示例）。而**电子谱面**（本项目字体渲染出来的干净减字图）的分布是封闭、
确定的：字体里一共就 268 个可读字形（213 个复合减字 + 55 个部件）。那么把每个
字形渲染成模板，识别就退化成「最近邻匹配」——确定性、瞬时、零成本，闭集上可
以打到 100%。

诚实边界（重要）
----------------
本工具只对「该字体渲染的干净图」有效（训练=测试分布）。拍照/扫描件有噪声、
笔画粘连、光照差异，不在其适用范围内 —— 那类输入仍需专用模型（42 条自动真值
数据集就是为微调准备的）。`robust` 子命令用扰动实验给出这条边界的量化结果。

用法
----
    python3 template_match.py build                     # 渲染 268 字形建索引（缓存到 .cache/）
    python3 template_match.py match --image images/lg_yangtuo.png
    python3 template_match.py predict \\
        --annotations annotations/font_cases.json \\
        --out annotations/font_cases_tpl.json           # 填 predicted，供 score.py --offline
    python3 template_match.py robust                    # 扰动鲁棒性实验

依赖：Pillow、numpy、fontTools、ImageMagick（magick）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from gen_font_cases import FONT, _ligature_truths, _rasterize, _svg_for_glyph  # noqa: E402

CACHE = HERE / ".cache"
INDEX_NPZ = CACHE / "template_index.npz"
SIZE = 64  # 归一化后的模板边长

# 进索引的字形：复合减字（lg/lgw/xl/md/mod…，GSUB 可反查真值）+ sm_* 部件（干扰项）。
# 字体里其余是拉丁触发字符（a/J/…），不是减字字形，不进索引。
def _index_glyphs(font_path: Path) -> list[tuple[str, list[str]]]:
    from fontTools.ttLib import TTFont

    truths = _ligature_truths(font_path)  # {glyph: [文本, 异体…]}
    order = TTFont(str(font_path)).getGlyphOrder()
    out: list[tuple[str, list[str]]] = []
    for g in order:
        if g == ".notdef":
            continue
        if g in truths:
            out.append((g, truths[g]))
        elif g.startswith("sm_"):
            out.append((g, [g]))  # 部件：以字形名当伪真值，仅作匹配干扰项
    return out


def _bilinear_resize(canvas: np.ndarray, size: int) -> np.ndarray:
    """半像素中心双线性缩放。Rust 端 `template_match.rs` 用同一公式，保证两端一致。"""
    h, w = canvas.shape
    out = np.zeros((size, size), dtype=np.float32)
    sy, sx = h / size, w / size
    for oy in range(size):
        fy = min(max((oy + 0.5) * sy - 0.5, 0.0), h - 1.0)
        y0, y1, wy = int(fy), min(int(fy) + 1, h - 1), fy - int(fy)
        for ox in range(size):
            fx = min(max((ox + 0.5) * sx - 0.5, 0.0), w - 1.0)
            x0, x1, wx = int(fx), min(int(fx) + 1, w - 1), fx - int(fx)
            top = canvas[y0, x0] * (1 - wx) + canvas[y0, x1] * wx
            bot = canvas[y1, x0] * (1 - wx) + canvas[y1, x1] * wx
            out[oy, ox] = top * (1 - wy) + bot * wy
    return out


def normalize(img, size: int = SIZE) -> np.ndarray:
    """白底黑字图 → 归一化 64x64 墨迹图（float32，0=空白 1=墨）。

    先 3x3 中值滤波去孤立噪点（扫描件常见椒盐噪声；干净图上近乎恒等），
    再裁剪到墨迹外接框、补成正方形再缩放 —— 对平移/缩放/留白天然不敏感。
    """
    from PIL import Image, ImageFilter

    if not isinstance(img, Image.Image):
        img = Image.open(img)
    gray = img.convert("L").filter(ImageFilter.MedianFilter(3))
    arr = np.asarray(gray, dtype=np.float32)
    ink = arr < 128
    if not ink.any():
        return np.zeros((size, size), dtype=np.float32)
    ys, xs = np.where(ink)
    crop = ink[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].astype(np.float32)
    h, w = crop.shape
    side = max(h, w)
    canvas = np.zeros((side, side), dtype=np.float32)
    oy, ox = (side - h) // 2, (side - w) // 2
    canvas[oy : oy + h, ox : ox + w] = crop
    return _bilinear_resize(canvas, size)


def build_index(rebuild: bool = False) -> dict:
    """渲染字体里全部减字字形为模板并归一化；结果缓存到 .cache/template_index.npz。"""
    if INDEX_NPZ.exists() and not rebuild:
        data = np.load(INDEX_NPZ, allow_pickle=False)
        return {
            "names": [str(x) for x in data["names"]],
            "truths": [[t for t in str(x).split("\x1f") if t] for x in data["truths"]],
            "vecs": data["vecs"].reshape(len(data["names"]), -1),
        }

    if not FONT.exists():
        raise SystemExit(f"找不到字体：{FONT}")
    glyphs = _index_glyphs(FONT)
    # 沙箱 shim 的 mkdir 会忽略 exist_ok=True，故用 try/except 兜底
    for d in (CACHE, CACHE / "templates"):
        try:
            d.mkdir(parents=True, exist_ok=True)
        except FileExistsError:
            pass
    render_dir = CACHE / "templates"

    names, truths, vecs = [], [], []
    for i, (g, texts) in enumerate(glyphs, 1):
        png = render_dir / f"{g}.png"
        if not png.exists():
            try:
                _rasterize(_svg_for_glyph(FONT, g), png)
            except Exception as exc:  # 空轮廓等单个字形问题不影响其余
                print(f"[build] 跳过 {g}: {exc}", file=sys.stderr)
                continue
        vecs.append(normalize(png))
        names.append(g)
        truths.append("\x1f".join(texts))
        if i % 50 == 0:
            print(f"[build] {i}/{len(glyphs)}")

    arr = np.stack(vecs).astype(np.float32)
    np.savez_compressed(
        INDEX_NPZ,
        names=np.array(names),
        truths=np.array(truths),
        vecs=arr,
    )
    print(f"[build] 索引 {len(names)} 个模板 -> {INDEX_NPZ}")
    return {
        "names": names,
        "truths": [[t for t in t.split("\x1f") if t] for t in truths],
        "vecs": arr.reshape(len(names), -1),
    }


def match_image(index: dict, img_path: Path, topk: int = 3) -> dict:
    """最近邻匹配：L2 距离 + 与第二名的 margin 作为诚实置信度。"""
    q = normalize(img_path).reshape(-1)
    d = np.sqrt(((index["vecs"] - q) ** 2).sum(axis=1))
    order = np.argsort(d)[:topk]
    best = int(order[0])
    second = float(d[order[1]]) if len(order) > 1 else float("inf")
    return {
        "glyph": index["names"][best],
        "truth": index["truths"][best][0],
        "distance": float(d[best]),
        "margin": second - float(d[best]),
        "topk": [
            {"glyph": index["names"][k], "truth": index["truths"][k][0], "distance": float(d[k])}
            for k in order
        ],
    }


def _resolve_image(image_field: str, ann_path: Path) -> Path | None:
    """标注里的 image 字段可能是相对 tools/eval-jianzi 或标注文件所在目录。"""
    for cand in (HERE / image_field, ann_path.parent / image_field, Path(image_field)):
        if cand.exists():
            return cand
    return None


def cmd_predict(args) -> int:
    index = build_index()
    ann_path = Path(args.annotations)
    data = json.loads(ann_path.read_text(encoding="utf-8"))
    items = data.get("items", [])
    n_miss = 0
    for item in items:
        img = _resolve_image(item.get("image", ""), ann_path)
        if img is None:
            print(f"[predict] 找不到图片 {item.get('image')!r}，跳过", file=sys.stderr)
            item["predicted"] = None
            n_miss += 1
            continue
        r = match_image(index, img)
        item["predicted"] = r["truth"]
        item["predicted_glyph_name"] = r["glyph"]
        item["predicted_distance"] = round(r["distance"], 4)
        item["predicted_margin"] = round(r["margin"], 4)
    out = Path(args.out)
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
    except FileExistsError:
        pass
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[predict] {len(items) - n_miss}/{len(items)} 条已填 predicted -> {out}")
    print("[predict] 离线计分：python3 score.py --offline --annotations", out)
    return 0


def cmd_robust(args) -> int:
    """扰动实验：量化「这条非视觉路径从哪开始失效」。"""
    from PIL import Image, ImageFilter

    np.random.seed(args.seed)  # 扰动可复现
    index = build_index()
    ann_path = Path(args.annotations)
    data = json.loads(ann_path.read_text(encoding="utf-8"))
    items = [it for it in data.get("items", []) if _resolve_image(it.get("image", ""), ann_path)]

    def perturb(img, kind: str):
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
            mask = np.random.rand(*arr.shape) < pct
            arr[mask] = 255 - arr[mask]
            return Image.fromarray(arr)
        if kind.startswith("blur-"):
            return img.filter(ImageFilter.GaussianBlur(float(kind.split("-")[1])))
        if kind.startswith("scale-"):
            f = float(kind.split("-")[1])
            return img.resize((max(1, int(w * f)), max(1, int(h * f))), Image.BILINEAR)
        raise ValueError(kind)

    conditions = ["none", "shift", "noise-0.5", "noise-1", "noise-2", "blur-1", "blur-2", "scale-0.7", "scale-1.4"]
    print(f"条件            命中 / {len(items)}   命中率   平均margin")
    for cond in conditions:
        ok, margins = 0, []
        for it in items:
            img = perturb(Image.open(_resolve_image(it["image"], ann_path)), cond)
            r = match_image(index, img)
            truth = it.get("ground_truth_glyph", "")
            if r["truth"] == truth or r["truth"] in (it.get("ground_truth_alts") or []):
                ok += 1
            margins.append(r["margin"])
        print(f"{cond:14s} {ok:3d}        {ok / len(items) * 100:5.1f}%   {np.mean(margins):.4f}")
    return 0


def cmd_export_rust(args) -> int:
    """导出 Rust 后端 `template_match.rs` 用的模板索引 JSON。

    像素与本脚本 `normalize()` 完全同源（u8 = round(float*255)），
    Rust 端按同一套公式做归一化与最近邻，保证两边结果一致。
    """
    import base64

    index = build_index()
    entries = []
    for name, texts, vec in zip(index["names"], index["truths"], index["vecs"]):
        pixels = np.clip(np.round(vec.reshape(SIZE, SIZE) * 255.0), 0, 255).astype(np.uint8)
        entries.append(
            {
                "name": name,
                "truths": texts,
                "pixels": base64.b64encode(pixels.tobytes()).decode("ascii"),
            }
        )
    payload = {"size": SIZE, "entries": entries}
    out = Path(args.out)
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
    except FileExistsError:
        pass
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"[export-rust] {len(entries)} 个模板 -> {out}（{out.stat().st_size // 1024} KB）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="电子谱面减字模板匹配（非视觉识别路径）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build", help="渲染字体字形并建模板索引")
    p_match = sub.add_parser("match", help="识别单张图片")
    p_match.add_argument("--image", required=True)
    p_pred = sub.add_parser("predict", help="给标注文件填 predicted")
    p_pred.add_argument("--annotations", required=True)
    p_pred.add_argument("--out", required=True)
    p_rob = sub.add_parser("robust", help="扰动鲁棒性实验")
    p_rob.add_argument("--annotations", default=str(HERE / "annotations" / "font_cases.json"))
    p_rob.add_argument("--seed", type=int, default=42, help="扰动随机种子（默认可复现）")
    p_exp = sub.add_parser("export-rust", help="导出 Rust 后端模板索引 JSON")
    p_exp.add_argument(
        "--out",
        default=str(HERE.parent.parent / "crates" / "taiyin-server" / "data" / "template_index.json"),
    )
    args = ap.parse_args()

    if args.cmd == "build":
        build_index(rebuild=True)
        return 0
    if args.cmd == "match":
        index = build_index()
        r = match_image(index, Path(args.image))
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "predict":
        return cmd_predict(args)
    if args.cmd == "robust":
        return cmd_robust(args)
    if args.cmd == "export-rust":
        return cmd_export_rust(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
