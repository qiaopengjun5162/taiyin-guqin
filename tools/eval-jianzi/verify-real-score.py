#!/usr/bin/env python3
"""真谱验证闸门 —— 先把「方法上限」算清楚，再谈准确率。

为什么需要这道闸门
------------------
现用的识别是**闭集最近邻**：模板库 = 本项目字体渲染出的全部减字字形
（见 template_match.py），识别 = 找 L2 距离最近的那个模板。
因此一张真实老谱照片拿来之前，有个不用照片就能算的问题：

    谱上的字，有多少根本不在模板库里？

闭集方法对库外字**必然认不出**——它只能从库里挑一个最近的，而且会挑得很自信
（margin 不会告诉你「这个字我压根没见过」）。若库外字占三成，准确率天花板就是
70%，跑多少遍照片都改不了。所以本脚本把「模板库覆盖率」放第一，准确率放第二。

诚实边界
--------
robust 实验（同字体渲染 + 平移/噪声/模糊/缩放 0.7~1.4）命中率 97.6%~100%，
证明的是**对轻微退化的鲁棒性**，不是**跨分布泛化**。真实老谱的异体字、别本刻工、
手写体、笔画断裂、污渍、透视，都不在这批扰动覆盖内；template_match.py 的文档
也明确写了「拍照/扫描件不在适用范围内」。真谱数字难看不是 bug，是边界被量出来。

用法
----
    python verify-real-score.py --annotations annotations/real_score_template.json
    python verify-real-score.py --annotations xxx.json --vocab-only   # 只算上限，不用照片
    python verify-real-score.py --annotations xxx.json --report /tmp/real-score.json
    python verify-real-score.py --self-test                          # 指标计算自测

依赖：numpy / Pillow / fontTools（与 template_match.py 相同）。
⚠️ 本机只有受管 venv 装了 numpy，用：
   ~/.workbuddy/binaries/python/envs/default/bin/python verify-real-score.py ...
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from template_match import build_index, match_image, _resolve_image  # noqa: E402


def vocab_of(index: dict) -> set[str]:
    """模板库能输出的规范减字文本全集（一个模板可能对应多个写法）。"""
    return {t for truths in index["truths"] for t in truths}


def evaluate(items: list[dict], vocab: set[str], *, predictor=None, ann_path: Path | None = None) -> dict:
    """算指标。predictor=None 时用标注里已填的 predicted（离线/字表模式）。"""
    rows = []
    for item in items:
        truth = str(item.get("ground_truth_glyph") or "").strip()
        in_vocab = truth in vocab
        pred = item.get("predicted")
        if predictor is not None and not item.get("_skip_image"):
            img = _resolve_image(str(item.get("image") or ""), ann_path or HERE)
            if img is not None:
                r = match_image(predictor, img)
                pred = r["truth"]
                item["predicted_distance"] = round(r["distance"], 4)
                item["predicted_margin"] = round(r["margin"], 4)
        rows.append({
            "id": item.get("id", "?"),
            "truth": truth,
            "predicted": pred,
            "in_vocab": in_vocab,
            "correct": bool(truth and pred is not None and truth == str(pred).strip()),
            "image": item.get("image"),
        })

    total = len(rows)
    in_v = [r for r in rows if r["in_vocab"]]
    out_v = [r for r in rows if not r["in_vocab"]]
    scored = [r for r in rows if r["predicted"] is not None]
    correct = [r for r in rows if r["correct"]]
    correct_in = [r for r in in_v if r["correct"]]

    def pct(a: int, b: int) -> float:
        return round(100.0 * a / b, 1) if b else 0.0

    return {
        "total": total,
        "templates": None,  # 由调用方填
        "vocab_size": len(vocab),
        "in_vocab": len(in_v),
        "out_of_vocab": len(out_v),
        "coverage_pct": pct(len(in_v), total),
        "ceiling_pct": pct(len(in_v), total),  # 闭集方法的理论准确率上限
        "scored": len(scored),
        "correct": len(correct),
        "exact_match_pct": pct(len(correct), len(scored)),
        "in_vocab_accuracy_pct": pct(len(correct_in), len(in_v)),
        "effective_accuracy_pct": pct(len(correct), total),
        "out_of_vocab_truths": sorted({r["truth"] for r in out_v}),
        "wrong_rows": [r for r in rows if r["predicted"] is not None and not r["correct"]],
        "rows": rows,
    }


def render(result: dict) -> str:
    L = [
        "真谱验证报告（模板匹配 · 闭集最近邻）",
        f"模板库：{result['templates']} 个模板 / {result['vocab_size']} 个规范减字文本",
        f"标注：{result['total']} 条，可计分 {result['scored']} 条",
        "",
        "── ① 模板库覆盖（不用照片，先看方法上限）──",
        f"  库内 {result['in_vocab']}/{result['total']} = {result['coverage_pct']}%",
        f"  库外 {result['out_of_vocab']} 条 → 闭集方法必然认不出，准确率天花板 {result['ceiling_pct']}%",
    ]
    if result["out_of_vocab_truths"]:
        L.append(f"  库外字：{'、'.join(result['out_of_vocab_truths'][:12])}"
                 + (" …" if len(result["out_of_vocab_truths"]) > 12 else ""))
    if result["scored"] == 0:
        L += ["", "── ② 识别结果 ──", "  （未跑识别：--vocab-only 或标注未填 predicted）"]
    else:
        L += [
            "",
            "── ② 识别结果 ──",
            f"  exact_match        {result['correct']}/{result['scored']} = {result['exact_match_pct']}%",
            f"  库内正确率         {result['in_vocab_accuracy_pct']}%（分母只算库内字）",
            f"  全量有效准确率     {result['correct']}/{result['total']} = {result['effective_accuracy_pct']}%",
        ]
    if result["wrong_rows"]:
        L.append(f"  认错 {len(result['wrong_rows'])} 条（前 5）：")
        for r in result["wrong_rows"][:5]:
            L.append(f"    {r['id']}: 真值「{r['truth']}」→ 预测「{r['predicted']}」")
    L += [
        "",
        "⚠️ 适用边界：本方法只对该字体渲染的干净图有效（训练=测试分布）。",
        "   robust 的 97.6%~100% 是「同分布 + 轻扰动」，不能外推到真实老谱。",
        "   真谱若有异体字 / 别本刻工 / 手写 / 断裂 / 污渍，请先扩模板库或换方法，",
        "   不要把这个数字当成「识别准确率」对外说。",
    ]
    return "\n".join(L)


def self_test() -> int:
    """变异验证：故意造库外字和错误预测，证明指标会如实报红。"""
    vocab = {"大九勾四", "散挑一"}
    items = [
        {"id": "ok", "ground_truth_glyph": "大九勾四", "predicted": "大九勾四"},
        {"id": "wrong", "ground_truth_glyph": "散挑一", "predicted": "大九勾四"},
        {"id": "oov", "ground_truth_glyph": "异体字甲", "predicted": "大九勾四"},
        {"id": "noscore", "ground_truth_glyph": "大九勾四", "predicted": None},
    ]
    r = evaluate(items, vocab)
    assert r["in_vocab"] == 3 and r["out_of_vocab"] == 1, r
    assert r["coverage_pct"] == 75.0 and r["ceiling_pct"] == 75.0, r
    assert r["scored"] == 3 and r["correct"] == 1, r
    assert r["exact_match_pct"] == 33.3, r
    assert r["effective_accuracy_pct"] == 25.0, r
    assert r["out_of_vocab_truths"] == ["异体字甲"], r
    print("SELF-TEST OK: 库外字 / 认错 / 未计分 三类都如实计入，天花板 = 覆盖率")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="真谱验证闸门（闭集方法先算上限）")
    ap.add_argument("--annotations", help="标注 JSON（单字模式，items[]）")
    ap.add_argument("--report", help="额外写出 JSON 报告")
    ap.add_argument("--vocab-only", action="store_true", help="只算模板库覆盖，不读图片")
    ap.add_argument("--self-test", action="store_true", help="跑指标计算自测，不需要任何文件")
    args = ap.parse_args()

    if args.self_test:
        return self_test()
    if not args.annotations:
        ap.error("需要 --annotations 或 --self-test")

    ann_path = Path(args.annotations)
    if not ann_path.exists():
        ann_path = HERE / "annotations" / args.annotations
    if not ann_path.exists():
        print(f"找不到标注文件：{args.annotations}", file=sys.stderr)
        return 1
    data = json.loads(ann_path.read_text(encoding="utf-8"))
    items = data.get("items", [])

    index = build_index()
    vocab = vocab_of(index)
    predictor = None if args.vocab_only else index
    result = evaluate(items, vocab, predictor=predictor, ann_path=ann_path)
    result["templates"] = len(index["names"])
    print(render(result))

    if args.report:
        out = Path(args.report)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nJSON 报告 -> {out}")
    # 有库外字时给非零退出码？不。这是「量出边界」，不是失败；退出码只表示脚本跑没跑通。
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
