#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「确定性 mock 后端」配套的真值标注集，用于端到端冒烟。

复用 mock_backend 的派生函数计算真值，保证：mock 返回的 glyph 与标注里的
ground_truth_glyph 一致 → 在线模式 exact_match≈100%。再故意把个别样本的真值
改成错误文本，制造「红行」与 <100% 的汇总，验证打分/着色逻辑。

生成的文件（均为可再生的产物，已在 .gitignore 忽略）：
- images/smoke_single_*.bin   占位图片（任意字节，mock 只哈希不解码）
- images/smoke_sheet.bin
- annotations/smoke_single.json / smoke_sheet.json
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mock_backend import derive_glyph, derive_sheet_cells  # noqa: E402

IMAGES_DIR = os.path.join(HERE, "images")
ANN_DIR = os.path.join(HERE, "annotations")


def _write_image(name: str, content: bytes) -> str:
    os.makedirs(IMAGES_DIR, exist_ok=True)
    path = os.path.join(IMAGES_DIR, name)
    with open(path, "wb") as f:
        f.write(content)
    return os.path.relpath(path, ANN_DIR)  # 标注里用相对 annotations/ 的路径


def gen_single(n: int = 5) -> str:
    items = []
    for i in range(n):
        content = (f"SMOKE-SINGLE-{i}::").encode("utf-8") * 8
        rel = _write_image(f"smoke_single_{i}.bin", content)
        items.append(
            {
                "id": f"s{i}",
                "image": rel,
                "media_type": "image/png",
                "ground_truth_glyph": derive_glyph(content),
                "note": "mock 确定性识别（真值=派生值）",
            }
        )
    # 故意改错一个真值 → 制造红行 + <100% 汇总
    items[3]["ground_truth_glyph"] = "错例非减字"
    items[3]["note"] = "故意错值（验证红行/低 F1）"
    doc = {"mode": "single", "items": items}
    out = os.path.join(ANN_DIR, "smoke_single.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    return out


def gen_sheet() -> str:
    content = b"SMOKE-SHEET-PAGE::" * 8
    rel = _write_image("smoke_sheet.bin", content)
    cells = derive_sheet_cells(content)
    grid = [
        {"row": c["row"], "col": c["col"], "ground_truth_glyph": c["glyph"]}
        for c in cells
    ]
    # 故意改错一个格 → 验证整页模式的红行
    grid[2]["ground_truth_glyph"] = "错例"
    grid[2]["note"] = "故意错值（验证红行）"
    doc = {
        "mode": "sheet",
        "items": [
            {
                "id": "p1",
                "image": rel,
                "media_type": "image/png",
                "grid": grid,
                "note": "mock 整页确定性识别",
            }
        ],
    }
    out = os.path.join(ANN_DIR, "smoke_sheet.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    return out


def main() -> int:
    os.makedirs(ANN_DIR, exist_ok=True)
    s1 = gen_single()
    s2 = gen_sheet()
    print(f"[gen] 已生成冒烟标注集：")
    print(f"  {s1}")
    print(f"  {s2}")
    print(f"  images/ 下占位图片已写入 {IMAGES_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
