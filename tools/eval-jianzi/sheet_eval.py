#!/usr/bin/env python3
"""整页电子谱面：格子切分 + 逐格模板匹配的评估 harness。

单字模板匹配已经打到 exact 100%（见 template_match.py），但整页识别此前只有
LLM 一条路（42 条真字上 exact 0%，不可用）。整页要走模板路径，前提是先把
一整页切成一个个字格 —— 本工具回答两个问题：

1. **投影切分在什么样的排版下能把格子切对？**（gap 多小开始粘连）
2. **切对之后逐格匹配的准确率是多少？**（预期与单字同分布 → 100%）

合成数据不是随手画的方块：字形图来自 `gen_font_cases.py` 用真字体渲染的
`.cache/templates/*.png`（与模板索引同源），按随机网格拼成整页，再扰动
字号/间距 —— 训练=测试分布下的诚实测量。真实 app 渲染是 24px 字 + 12px
间距（约 0.5× 字宽），扫描 `--gaps` 时重点看那个区间稳不稳。

切分算法（与 Rust `sheet_segment.rs` 逐行等价）：
    3x3 中值（边缘钳位）去斑 → 阈值 128 取墨 → 行投影找「行带」→
    每带内列投影找「字格」→ **间隙容忍**：白缝小于阈值不切开。

为什么必须间隙容忍：复合减字内部有白色通道（实测 213 个真减字：列向通道
p99≈2px、max 4px；行向通道可到 0.36×字高 —— 上下部件之间的横通道）。无脑按
「一列白就切」会把一个字劈成两三个框。阈值按页面墨迹尺度 S 比例定：
列 0.10×S（覆盖列向通道 2 倍余量）、行 0.40×S（覆盖行向通道）。
真 app 渲染字格间隙 ≈ 0.5×S（24px 字 + 12px 间距），在边界之上。
`--gap-fracs` 用相对值扫描，直接读出「间隙要多大才不粘连」。

用法
----
    python3 sheet_eval.py synth --sheets-per-gap 12      # 合成整页 + 真值
    python3 sheet_eval.py eval                            # 切分+匹配，按 gap 报告
    python3 sheet_eval.py eval --dump /tmp/sheet_failures.json

依赖：Pillow、numpy（复用 template_match 的索引与归一化）。
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from template_match import (  # noqa: E402
    CACHE,
    INDEX_NPZ,
    build_index,
    median3_clamp,
    normalize,
)

SHEETS_DIR = CACHE / "sheets"
RENDER_DIR = CACHE / "templates"
ANNOTATIONS = HERE / "annotations" / "sheet_cases.json"

MIN_RUN = 3  # 连续墨段最短长度（像素）：短于此当噪声丢弃
THRESH = 128  # 墨迹阈值，与 normalize/template_match.rs 一致
# 间隙容忍：白缝 < K 不切开。列向内部通道 max 0.05×S（213 真字实测）。
# 行向单字内部通道可达 0.36×S，但行投影横跨整行 —— 需要整行所有字的通道
# 对齐才会误切，实测极少；故行列都取 0.10×S（2 倍列向通道余量）。
# 真 app 渲染字格间隙 ≈ 0.5×S（24px 字 + 12px 间距），在边界之上 5 倍。
COL_GAP_FRAC = 0.10
ROW_GAP_FRAC = 0.10


def _mkdirs(*dirs: Path) -> None:
    # 沙箱 shim 的 mkdir 会忽略 exist_ok=True，故 try/except 兜底
    for d in dirs:
        try:
            d.mkdir(parents=True, exist_ok=True)
        except FileExistsError:
            pass


def _runs(
    flags: np.ndarray, min_run: int = MIN_RUN, gap_tol: int = 0
) -> list[tuple[int, int]]:
    """布尔序列里的连续 True 段 [(start, end_exclusive), ...]。

    `gap_tol`：段间白缝 < gap_tol 时桥接合并（间隙容忍）。
    `min_run`：合并后仍短于此的墨段当噪声丢弃。
    """
    raw: list[tuple[int, int]] = []
    start = None
    for i, f in enumerate(flags):
        if f and start is None:
            start = i
        elif not f and start is not None:
            raw.append((start, i))
            start = None
    if start is not None:
        raw.append((start, len(flags)))

    merged: list[tuple[int, int]] = []
    for s, e in raw:
        if merged and s - merged[-1][1] < gap_tol:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return [(s, e) for s, e in merged if e - s >= min_run]


def segment(
    arr: np.ndarray,
) -> list[list[tuple[int, int, int, int]]]:
    """整页灰度（白底黑字）→ 按行分组的字格外接框。

    先找行带（行投影），再在每带内找字格（列投影），全程间隙容忍。
    返回 `rows[y_band][x] = (y0, y1, x0, x1)`，行从上到下、格从左到右 ——
    直接对应 API 的 (row, col) 坐标。
    """
    smooth = median3_clamp(arr)
    ink = smooth < THRESH

    # 页面墨迹尺度 S：原始墨段里「最大带高 ∪ 最大带宽」，对过切/漏切都稳
    # （每个字形最长边 = 渲染字号，页面里总有一个字顶到这个尺度）。
    raw_rows = _runs(ink.any(axis=1), min_run=1)
    s_est = 0
    for y0, y1 in raw_rows:
        s_est = max(s_est, y1 - y0)
        for x0, x1 in _runs(ink[y0:y1, :].any(axis=0), min_run=1):
            s_est = max(s_est, x1 - x0)
    # half-up 取整（int(x+0.5)），与 Rust `(x + 0.5) as usize` 一致，
    # 不用 Python round() 的银行家舍入（8.5→8 vs Rust 9，会分叉）。
    k_row = max(3, int(ROW_GAP_FRAC * s_est + 0.5))
    k_col = max(3, int(COL_GAP_FRAC * s_est + 0.5))

    rows: list[list[tuple[int, int, int, int]]] = []
    for y0, y1 in _runs(ink.any(axis=1), MIN_RUN, gap_tol=k_row):
        band = ink[y0:y1, :]
        boxes = [
            (y0, y1, x0, x1)
            for x0, x1 in _runs(band.any(axis=0), MIN_RUN, gap_tol=k_col)
        ]
        rows.append(boxes)
    return rows


# ---------------------------------------------------------------------------
# 合成整页
# ---------------------------------------------------------------------------


def _crop_ink(png: Path) -> np.ndarray:
    """渲染图裁到墨迹外接框（去掉 pad），返回灰度数组。"""
    from PIL import Image

    arr = np.asarray(Image.open(png).convert("L"))
    ink = arr < THRESH
    ys, xs = np.where(ink)
    return arr[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def _scale_to_ink(arr: np.ndarray, ink_size: int) -> np.ndarray:
    """最长边缩放到 ink_size（LANCZOS，模拟不同字号重渲染的抗锯齿）。"""
    from PIL import Image

    h, w = arr.shape
    f = ink_size / max(h, w)
    nw, nh = max(1, round(w * f)), max(1, round(h * f))
    return np.asarray(
        Image.fromarray(arr).resize((nw, nh), Image.LANCZOS), dtype=np.uint8
    )


def cmd_synth(args) -> int:
    np.random.seed(args.seed)
    rng = random.Random(args.seed)
    if not INDEX_NPZ.exists():
        print("[synth] 先建模板索引：python3 template_match.py build", file=sys.stderr)
        return 1
    data = np.load(INDEX_NPZ, allow_pickle=False)
    names = [str(x) for x in data["names"]]
    truths = [[t for t in str(x).split("\x1f") if t] for x in data["truths"]]

    # 字格池按字形名前缀选（与 42 条单字基线同分布 = lg/lgw/xl/md）。
    # sm_* 是徽位/部件干扰项（组合字形的零件），独立出现在谱面上的
    # 是完整减字/部件字格：复合减字（lg/lgw）、整字简写（xl）、弦序（md）。
    pools = {
        "42": lambda g: g.startswith(("lg_", "lgw_", "xl_", "md_")),
        "34": lambda g: g.startswith(("lg_", "lgw_", "xl_")),  # 只要复合减字
        "all": lambda g: True,
    }
    pred = pools[args.pool]
    pool = [(g, t[0]) for g, t in zip(names, truths) if t and pred(g)]
    print(f"[synth] 字格池 {args.pool}: {len(pool)} 个字形")
    # 每个字形的墨迹图只裁一次
    crops = {g: _crop_ink(RENDER_DIR / f"{g}.png") for g, _ in pool}

    _mkdirs(SHEETS_DIR, HERE / "annotations")
    gap_fracs = [float(x) for x in args.gap_fracs.split(",")]
    items = []
    sheet_id = 0
    for gap_frac in gap_fracs:
        for _ in range(args.sheets_per_gap):
            sheet_id += 1
            rows = rng.randint(2, 5)
            cols = rng.randint(3, 7)
            ink_size = rng.randint(56, 96)
            gap = round(gap_frac * ink_size)  # 间隙相对字高，直接对应真 app 的 0.5
            pitch_x = ink_size + gap
            pitch_y = ink_size + gap
            margin = 24
            w = margin * 2 + cols * ink_size + (cols - 1) * gap
            h = margin * 2 + rows * ink_size + (rows - 1) * gap
            canvas = np.full((h, w), 255, dtype=np.uint8)

            cells = []
            for r in range(rows):
                for c in range(cols):
                    g, text = pool[rng.randrange(len(pool))]
                    glyph = _scale_to_ink(crops[g], ink_size)
                    gh, gw = glyph.shape
                    # 居中放在格子里（格子边长 ink_size，墨块可能略小）
                    oy = margin + r * pitch_y + (ink_size - gh) // 2
                    ox = margin + c * pitch_x + (ink_size - gw) // 2
                    canvas[oy : oy + gh, ox : ox + gw] = np.minimum(
                        canvas[oy : oy + gh, ox : ox + gw], glyph
                    )
                    cells.append(
                        {"row": r, "col": c, "glyph": g, "truth": text}
                    )

            name = f"sheet_{sheet_id:03d}_gap{gap_frac}.png"
            from PIL import Image

            Image.fromarray(canvas).save(SHEETS_DIR / name)
            items.append(
                {
                    "image": f".cache/sheets/{name}",
                    "gap_frac": gap_frac,
                    "gap_px": gap,
                    "ink_size": ink_size,
                    "rows": rows,
                    "cols": cols,
                    "cells": cells,
                }
            )
        print(f"[synth] gap_frac={gap_frac}: {args.sheets_per_gap} 张")

    ANNOTATIONS.write_text(
        json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[synth] 共 {len(items)} 张 -> {SHEETS_DIR}")
    print(f"[synth] 真值 -> {ANNOTATIONS}")
    return 0


# ---------------------------------------------------------------------------
# 切分 + 匹配评估
# ---------------------------------------------------------------------------


def cmd_eval(args) -> int:
    from PIL import Image

    index = build_index()
    data = json.loads(ANNOTATIONS.read_text(encoding="utf-8"))
    items = data["items"]

    stats: dict[int, dict] = {}
    failures = []
    for it in items:
        gap = it["gap_frac"]
        s = stats.setdefault(
            gap,
            {
                "sheets": 0,
                "structure_ok": 0,
                "sheet_exact": 0,
                "cells_truth": 0,
                "cells_det": 0,
                "cell_exact": 0,
            },
        )
        s["sheets"] += 1
        truth_cells = sorted(it["cells"], key=lambda c: (c["row"], c["col"]))
        s["cells_truth"] += len(truth_cells)

        img = Image.open(HERE / it["image"]).convert("L")
        arr = np.asarray(img, dtype=np.uint8)
        det_rows = segment(arr)
        s["cells_det"] += sum(len(r) for r in det_rows)

        truth_by_row: dict[int, list] = {}
        for c in truth_cells:
            truth_by_row.setdefault(c["row"], []).append(c)

        structure_ok = len(det_rows) == len(truth_by_row) and all(
            len(det_rows[r]) == len(truth_by_row.get(r, []))
            for r in range(max(len(det_rows), len(truth_by_row)))
        )
        if structure_ok:
            s["structure_ok"] += 1

        # 逐格配对（结构对才按序配；否则按全局位置最近配，只计识别率）
        pairs = []
        if structure_ok:
            for r, row in enumerate(det_rows):
                for b, t in zip(row, truth_by_row[r]):
                    pairs.append((b, t))
        else:
            det_c = sorted(
                (b for row in det_rows for b in row),
                key=lambda b: ((b[0] + b[1]) / 2, (b[2] + b[3]) / 2),
            )
            pairs = list(zip(det_c, truth_cells))

        sheet_exact = structure_ok
        for b, t in pairs:
            crop = arr[b[0] : b[1], b[2] : b[3]]
            r = match_crop(index, crop)
            # 命中任一等价写法即对（合并同形模板后 truths 含全部写法）
            ok = t["truth"] in r["truths"]
            if ok:
                s["cell_exact"] += 1
            else:
                sheet_exact = False
                if len(failures) < (args.dump_limit or 10**9):
                    failures.append(
                        {
                            "image": it["image"],
                            "gap_frac": gap,
                            "expect": t["truth"],
                            "got": r["truth"],
                            "got_glyph": r["glyph"],
                            "distance": round(r["distance"], 2),
                            "margin": round(r["margin"], 2),
                            "structure_ok": structure_ok,
                        }
                    )
        if not structure_ok:
            sheet_exact = False
            if len(failures) < (args.dump_limit or 10**9):
                failures.append(
                    {
                        "image": it["image"],
                        "gap_frac": gap,
                        "expect": f"{it['rows']}×{it['cols']} 网格",
                        "got": f"{len(det_rows)} 行，各 {[len(r) for r in det_rows]} 格",
                        "structure_ok": False,
                    }
                )
        if sheet_exact:
            s["sheet_exact"] += 1

    print("gap/字高  张数  结构对  整页exact  格子truth/检出  逐格exact")
    tot = {"sheets": 0, "structure_ok": 0, "sheet_exact": 0, "cells_truth": 0, "cells_det": 0, "cell_exact": 0}
    for gap in sorted(stats):
        s = stats[gap]
        for k in tot:
            tot[k] += s[k]
        print(
            f"{gap:<5} {s['sheets']:<5} {s['structure_ok']:<7} {s['sheet_exact']:<10} "
            f"{s['cells_truth']}/{s['cells_det']:<13} {s['cell_exact']}/{s['cells_truth']} "
            f"({s['cell_exact'] / max(1, s['cells_truth']) * 100:.1f}%)"
        )
    print(
        f"合计  {tot['sheets']:<5} {tot['structure_ok']:<7} {tot['sheet_exact']:<10} "
        f"{tot['cells_truth']}/{tot['cells_det']:<13} {tot['cell_exact']}/{tot['cells_truth']} "
        f"({tot['cell_exact'] / max(1, tot['cells_truth']) * 100:.1f}%)"
    )

    if args.dump:
        out = Path(args.dump)
        _mkdirs(out.parent)
        out.write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[eval] 失败样本 {len(failures)} 条 -> {out}")
    return 0


def match_crop(index: dict, crop: np.ndarray) -> dict:
    """对切出来的字格灰度块做归一化 + 最近邻（复用 template_match 的归一化）。"""
    from PIL import Image

    q = normalize(Image.fromarray(crop)).reshape(-1)
    d = np.sqrt(((index["vecs"] - q) ** 2).sum(axis=1))
    order = np.argsort(d)[:3]
    best = int(order[0])
    second = float(d[order[1]]) if len(order) > 1 else float("inf")
    return {
        "glyph": index["names"][best],
        "truth": index["truths"][best][0],
        # 合并同形模板后的全部等价写法（如 一徽二分≡十二徽）
        "truths": index["truths"][best],
        "distance": float(d[best]),
        "margin": second - float(d[best]),
    }


def cmd_curve(args) -> int:
    """准确率-字号曲线：字形缩到不同 ink 尺寸后单字匹配的 exact 率。

    回答「上传/导出的谱图字要多大，模板匹配才可靠」。用 LANCZOS 重采样
    模拟不同字号（不是真字体重渲，但两者实测差异 <1pp，见 README）。
    """
    index = build_index()
    data = np.load(INDEX_NPZ, allow_pickle=False)
    names = [str(x) for x in data["names"]]
    truths = [[t for t in str(x).split("\x1f") if t] for x in data["truths"]]
    pools = {
        "42": lambda g: g.startswith(("lg_", "lgw_", "xl_", "md_")),
        "34": lambda g: g.startswith(("lg_", "lgw_", "xl_")),
        "all": lambda g: True,
    }
    pred = pools[args.pool]
    pool = [(g, t[0]) for g, t in zip(names, truths) if t and pred(g)]
    crops = {g: _crop_ink(RENDER_DIR / f"{g}.png") for g, _ in pool}
    print(f"字格池 {args.pool}: {len(pool)} 个字形")
    print("ink字号  exact           混淆对")
    for ink in args.sizes.split(","):
        ink = int(ink)
        ok, errs = 0, []
        for g, text in pool:
            q = _scale_to_ink(crops[g], ink)
            m = match_crop(index, q)
            if text in m["truths"]:
                ok += 1
            else:
                errs.append(f"{text}→{m['truth']}")
        print(
            f"{ink:>6}px  {ok}/{len(pool)} ({ok / len(pool) * 100:5.1f}%)  "
            f"{'、'.join(errs[:5])}"
        )
    return 0


def cmd_http_check(args) -> int:
    """同一批合成整页打真实后端，与本地 Python 预测逐格比对 ——
    验证 Rust `sheet_segment` 与本脚本 `segment`+`match_crop` 逐行等价。

    要求后端已启动（RECOGNIZE_MODE=auto 或 template，无需 LLM）：
        curl -s $BACKEND/health
    """
    import base64
    import urllib.request

    index = build_index()
    data = json.loads(ANNOTATIONS.read_text(encoding="utf-8"))
    items = data["items"][: args.limit or None]

    ok_sheets = ok_cells = total_cells = 0
    for it in items:
        from PIL import Image

        img_path = HERE / it["image"]
        arr = np.asarray(Image.open(img_path).convert("L"), dtype=np.uint8)
        det_rows = segment(arr)

        local: list[tuple[int, int, list[str]]] = []
        for r, row in enumerate(det_rows):
            for c, b in enumerate(row):
                m = match_crop(index, arr[b[0] : b[1], b[2] : b[3]])
                local.append((r, c, m["truths"]))

        body = json.dumps(
            {
                "image_base64": base64.b64encode(img_path.read_bytes()).decode(),
                "media_type": "image/png",
            }
        ).encode()
        req = urllib.request.Request(
            f"{args.backend}/api/v1/jianzi/recognize-sheet",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            remote = json.load(resp)

        remote_cells = sorted(
            (c["row"], c["col"], c["glyph"]) for c in remote["cells"]
        )
        local_cells = sorted(local)
        total_cells += len(local_cells)
        sheet_ok = remote.get("method") == "template" and len(remote_cells) == len(
            local_cells
        )
        if sheet_ok:
            for (r, c, truths), (rr, cc, glyph) in zip(local_cells, remote_cells):
                if (r, c) != (rr, cc) or glyph not in truths:
                    sheet_ok = False
                    print(
                        f"  ✗ {it['image']}: 本地({r},{c},{truths[0]}) "
                        f"vs 后端({rr},{cc},{glyph})"
                    )
                else:
                    ok_cells += 1
        else:
            print(
                f"  ✗ {it['image']}: method={remote.get('method')} "
                f"cells={len(remote_cells)} vs 本地 {len(local)}"
            )
        if sheet_ok:
            ok_sheets += 1

    print(
        f"[http-check] 整页一致 {ok_sheets}/{len(items)}，"
        f"逐格一致 {ok_cells}/{total_cells}"
    )
    return 0 if ok_sheets == len(items) else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="整页切分 + 模板匹配评估")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("synth", help="合成整页谱图 + 真值")
    sp.add_argument("--sheets-per-gap", type=int, default=12)
    sp.add_argument(
        "--gap-fracs",
        default="0,0.05,0.1,0.2,0.3,0.5",
        help="字格间隙/字高 比例，逗号分隔（真 app ≈ 0.5）",
    )
    sp.add_argument("--seed", type=int, default=42)
    sp.add_argument(
        "--pool",
        default="42",
        choices=["42", "34", "all"],
        help="字格池：42=lg/lgw/xl/md（与单字基线同分布，默认）；34=只要复合减字；all=全部真字",
    )

    ep = sub.add_parser("eval", help="切分 + 匹配，按 gap 报告")
    ep.add_argument("--dump", default="", help="失败样本 JSON 输出路径")
    ep.add_argument("--dump-limit", type=int, default=0, help="最多写多少条失败样本（0=不限）")

    cp = sub.add_parser("curve", help="准确率-字号曲线（单字）")
    cp.add_argument("--pool", default="42", choices=["42", "34", "all"])
    cp.add_argument("--sizes", default="24,48,72,96,128,192")

    hp = sub.add_parser("http-check", help="同批整页打真实后端，与本地预测逐格比对")
    hp.add_argument("--backend", default="http://127.0.0.1:3001")
    hp.add_argument("--limit", type=int, default=0, help="只测前 N 张（0=全部）")

    args = ap.parse_args()
    if args.cmd == "synth":
        return cmd_synth(args)
    if args.cmd == "curve":
        return cmd_curve(args)
    if args.cmd == "http-check":
        return cmd_http_check(args)
    return cmd_eval(args)


if __name__ == "__main__":
    raise SystemExit(main())
