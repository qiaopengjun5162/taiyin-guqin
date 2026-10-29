#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""减字谱识别准确率评估 harness。

用途
----
把一批「带标注的减字谱图片」喂给后端识别端点，跑端到端识别，
计算识别准确率指标，并产出可复盘的报告。

这是一道缺失的质量闸门（见仓库 VERIFICATION.md 第 3 节）：
有了它，AI 减字识别才能进入「跑 eval → 过了就推」的节奏，
而不是靠人工手测几张图做定性判断。

指标（模型无关、可解释）
----------------------
- exact_match：单元格级「规范减字文本完全相等」的命中率。
- CER (character error rate)：基于编辑距离 ref/pred 的字符错误率，
  是 OCR 领域的标准指标，越低越好。
- component F1：把减字拆成「字符多重集」后算 token 级
  precision / recall / F1，刻画「少写/多写/写错某个部件」的程度。
- detection_rate：模型给出非空 glyph（非 null）的比例，
  刻画「看不清就放弃」的倾向。
- confidence 分桶准确率（可选）：当响应带 confidence 时，
  按置信度区间报准确率，用于判断是否该用置信度阈值过滤。

两种运行模式
------------
- 在线（默认）：真实调用后端 `/api/v1/jianzi/recognize` 或 `/recognize-sheet`。
  需要后端已配置 ANTHROPIC_API_KEY；未配置时后端返回 HTTP 503，脚本会干净报错退出
  （提示需配 key 或加 --offline），不会假装通过。也可用 `mock_backend.py` 做无 key 冒烟。
- 离线（--offline）：直接用标注里的 `predicted` / `predicted_cells` 字段计分，
  不发起任何网络请求。用于校验评分逻辑、准备标注、CI 自测。

依赖：仅 Python 3 标准库。
"""
from __future__ import annotations

import argparse
import base64
import datetime as _dt
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter


class BackendError(RuntimeError):
    """后端调用失败的统一异常基类（所有非 2xx / 连接失败都归到这里）。"""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class BackendUnavailable(BackendError):
    """后端识别服务不可用（通常 503：未配置 ANTHROPIC_API_KEY）。"""


class BackendConnectionError(BackendError):
    """无法连接后端（通常后端未启动 / 地址错误）。"""


# ---------------------------------------------------------------------------
# 指标函数（纯逻辑，便于 --self-check 单测）
# ---------------------------------------------------------------------------


def levenshtein(a: str, b: str) -> int:
    """标准编辑距离（DP，O(n*m)）。"""
    m, n = len(a), len(b)
    if m == 0:
        return n
    if n == 0:
        return m
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i] + [0] * n
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[n]


def char_error_rate(ref: str, pred: str) -> float:
    if not ref:
        return 0.0 if not pred else 1.0
    return levenshtein(ref, pred) / len(ref)


def component_prf(ref: str, pred: str):
    """把减字当作字符多重集，算 token 级 P/R/F1 及 tp/fp/fn。"""
    rc, pc = Counter(ref), Counter(pred)
    tp = sum((rc & pc).values())
    fp = sum((pc - rc).values())
    fn = sum((rc - pc).values())
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
    return prec, rec, f1, tp, fp, fn


def fmt_pct(x: float) -> str:
    return f"{x * 100:.1f}%"


# ---------------------------------------------------------------------------
# 后端调用
# ---------------------------------------------------------------------------


def _post_json(url: str, payload: dict, timeout: int) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    # 本地 eval 不应经过公司/沙箱 HTTP 代理：显式用「无代理」opener。
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:  # 503 无 key / 422 字段错 / 5xx 等
        body = e.read().decode("utf-8", "replace")
        if e.code == 503:
            # 后端路由在未配置密钥时返回 503 + {"error": "..."}（见 routes.rs）。
            # 透出服务端消息，便于快速定位是「环境/配置」而非「模型」问题。
            msg = ""
            try:
                msg = json.loads(body).get("error", "")
            except Exception:
                msg = body[:200]
            raise BackendUnavailable(msg or f"HTTP 503 from {url}", status=503)
        raise BackendError(f"HTTP {e.code} from {url}: {body[:300]}", status=e.code)
    except urllib.error.URLError as e:
        raise BackendConnectionError(
            f"无法连接后端 {url}：{e.reason}（后端是否已启动？）"
        )


def b64_or_inline(item: dict, base_dir: str) -> tuple[str, str]:
    """返回 (image_base64, media_type)。优先用内联 image_base64，否则读文件。"""
    if item.get("image_base64"):
        return item["image_base64"], item.get("media_type", "image/png")
    img_path = item.get("image")
    if not img_path:
        raise ValueError(f"样本 {item.get('id')} 既无 image_base64 也无 image 路径")
    full = img_path if os.path.isabs(img_path) else os.path.join(base_dir, img_path)
    with open(full, "rb") as f:
        raw = f.read()
    # 猜测 mime
    ext = os.path.splitext(full)[1].lower()
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, "image/jpeg")
    return base64.b64encode(raw).decode("ascii"), item.get("media_type", mime)


def recognize_single(backend: str, item: dict, base_dir: str, timeout: int) -> dict:
    b64, mime = b64_or_inline(item, base_dir)
    resp = _post_json(
        f"{backend}/api/v1/jianzi/recognize",
        {"image_base64": b64, "media_type": mime},
        timeout,
    )
    return resp


def recognize_sheet(backend: str, item: dict, base_dir: str, timeout: int) -> dict:
    b64, mime = b64_or_inline(item, base_dir)
    resp = _post_json(
        f"{backend}/api/v1/jianzi/recognize-sheet",
        {"image_base64": b64, "media_type": mime},
        timeout,
    )
    return resp


# ---------------------------------------------------------------------------
# 计分核心
# ---------------------------------------------------------------------------


def score_cell(ref_glyph: str, pred_glyph: str | None):
    """对单个单元格计分，返回一行指标 dict。pred_glyph 可能为 None（模型放弃）。"""
    pred = pred_glyph or ""
    exact = (ref_glyph == pred) and pred != ""
    cer = char_error_rate(ref_glyph, pred)
    prec, rec, f1, tp, fp, fn = component_prf(ref_glyph, pred)
    detected = pred_glyph is not None and pred_glyph != ""
    return {
        "ref": ref_glyph,
        "pred": pred_glyph,
        "exact": exact,
        "cer": cer,
        "comp_prec": prec,
        "comp_rec": rec,
        "comp_f1": f1,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "detected": detected,
    }


def aggregate(rows: list[dict]) -> dict:
    n = len(rows)
    if n == 0:
        return {"n": 0}
    exact = sum(1 for r in rows if r["exact"])
    detected = sum(1 for r in rows if r["detected"])
    cer_sum = sum(r["cer"] for r in rows)
    tp = sum(r["tp"] for r in rows)
    fp = sum(r["fp"] for r in rows)
    fn = sum(r["fn"] for r in rows)
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
    return {
        "n": n,
        "exact_match": exact / n,
        "detection_rate": detected / n,
        "mean_cer": cer_sum / n,
        "comp_prec": prec,
        "comp_rec": rec,
        "comp_f1": f1,
        "tp": tp,
        "fp": fp,
        "fn": fn,
    }


def confidence_buckets(rows: list[dict], conf_map: dict, rows_by_id: dict) -> list[dict]:
    """conf_map: cell_id -> confidence。按 0.2 宽分桶报准确率。"""
    buckets = {}
    for cid, conf in conf_map.items():
        if conf is None:
            continue
        b = min(int(conf // 0.2), 4)
        buckets.setdefault(b, []).append(cid)
    out = []
    for b in sorted(buckets):
        ids = buckets[b]
        hit = sum(1 for i in ids if rows_by_id[i]["exact"])
        lo, hi = b * 0.2, (b + 1) * 0.2
        out.append(
            {
                "range": f"[{lo:.1f},{hi:.1f})",
                "n": len(ids),
                "exact_match": hit / len(ids),
            }
        )
    return out


# ---------------------------------------------------------------------------
# 报告
# ---------------------------------------------------------------------------


def render_html(template_path: str, meta: dict, summary: dict, rows: list[dict]) -> str:
    with open(template_path, "r", encoding="utf-8") as f:
        tpl = f.read()
    # 汇总表
    if summary.get("n", 0) == 0:
        summary_html = "<p>无样本</p>"
    else:
        summary_html = (
            "<table><tr>"
            + "".join(f"<th>{k}</th>" for k in ["样本数", "exact_match", "detection_rate", "mean_cer", "comp_P", "comp_R", "comp_F1"])
            + "</tr><tr>"
            + "".join(
                f"<td>{v}</td>"
                for v in [
                    summary["n"],
                    fmt_pct(summary["exact_match"]),
                    fmt_pct(summary["detection_rate"]),
                    f"{summary['mean_cer']:.3f}",
                    fmt_pct(summary["comp_prec"]),
                    fmt_pct(summary["comp_rec"]),
                    fmt_pct(summary["comp_f1"]),
                ]
            )
            + "</tr></table>"
        )
    # 逐样本
    cell_rows = "".join(
        "<tr>"
        + "".join(
            f"<td class=\"{'ok' if r['exact'] else 'bad'}\">{r.get(k,'')}</td>"
            for k in ["id", "ref", "pred", "exact", "cer", "comp_f1", "note"]
        )
        + "</tr>"
        for r in rows
    )
    cell_html = (
        "<table><tr>"
        + "".join(f"<th>{h}</th>" for h in ["id", "ref(真值)", "pred(识别)", "exact", "cer", "comp_F1", "note"])
        + "</tr>"
        + cell_rows
        + "</table>"
    )
    # 置信度分桶
    buckets = summary.get("confidence_buckets") or []
    if buckets:
        conf_html = (
            "<table><tr><th>confidence 区间</th><th>样本数</th><th>exact_match</th></tr>"
            + "".join(
                f"<tr><td>{b['range']}</td><td>{b['n']}</td><td>{fmt_pct(b['exact_match'])}</td></tr>"
                for b in buckets
            )
            + "</table>"
        )
    else:
        conf_html = "<p>本次无 confidence 数据（离线样本或未返回置信度）。</p>"
    return (
        tpl.replace("{{RUN_ID}}", meta.get("run_id", ""))
        .replace("{{MODE}}", meta.get("mode", ""))
        .replace("{{BACKEND}}", meta.get("backend", ""))
        .replace("{{TIMESTAMP}}", meta.get("timestamp", ""))
        .replace("{{SUMMARY_TABLE}}", summary_html)
        .replace("{{CONF_BUCKETS}}", conf_html)
        .replace("{{CELL_ROWS}}", cell_html)
    )


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def run_eval(annotations: dict, backend: str, offline: bool, timeout: int) -> dict:
    mode = annotations.get("mode", "single")
    base_dir = annotations.get("_base_dir", ".")
    items = annotations.get("items", [])
    rows = []
    rows_by_id = {}
    conf_map = {}
    run_id = 0

    for item in items:
        iid = item.get("id", f"item{run_id}")
        run_id += 1
        note = item.get("note", "")
        if mode == "single":
            ref = item.get("ground_truth_glyph", "")
            pred = item.get("predicted")
            if not offline and pred is None:
                resp = recognize_single(backend, item, base_dir, timeout)
                if resp.get("method") != "llm":
                    raise RuntimeError(
                        f"后端不可用（method={resp.get('method')}），需配置 ANTHROPIC_API_KEY"
                    )
                pred = resp.get("glyph")
                conf_map[iid] = resp.get("confidence")
            row = score_cell(ref, pred)
            row.update({"id": iid, "note": note})
            rows.append(row)
            rows_by_id[iid] = row
        elif mode == "sheet":
            grid = { (g["row"], g["col"]): g.get("ground_truth_glyph", "") for g in item.get("grid", []) }
            pred_cells = item.get("predicted_cells")
            if not offline and pred_cells is None:
                resp = recognize_sheet(backend, item, base_dir, timeout)
                if resp.get("method") != "llm":
                    raise RuntimeError(
                        f"后端不可用（method={resp.get('method')}），需配置 ANTHROPIC_API_KEY"
                    )
                pred_cells = resp.get("cells", [])
            # 建立 (row,col) -> glyph
            pred_map = {}
            if pred_cells:
                for c in pred_cells:
                    pred_map[(c.get("row"), c.get("col"))] = c.get("glyph")
                    if "confidence" in c:
                        conf_map[f"{iid}:{c.get('row')},{c.get('col')}"] = c.get("confidence")
            for (r, c), ref in grid.items():
                pred = pred_map.get((r, c))
                row = score_cell(ref, pred)
                row.update({"id": f"{iid}@r{r}c{c}", "note": note})
                rows.append(row)
                rows_by_id[f"{iid}:{r},{c}"] = row
        else:
            raise ValueError(f"未知 mode: {mode}")

    summary = aggregate(rows)
    summary["confidence_buckets"] = confidence_buckets(rows, conf_map, rows_by_id) if conf_map else []
    summary["_rows"] = rows
    summary["_rows_by_id"] = rows_by_id
    return summary


def self_check() -> int:
    """内部单测：验证指标数学正确，退出码 0 表示通过。"""
    assert levenshtein("kitten", "sitting") == 3, "lev failed"
    assert char_error_rate("大九勾四", "大九勾四") == 0.0
    assert abs(char_error_rate("大九勾四", "大九勾") - 0.25) < 1e-9
    p, r, f1, tp, fp, fn = component_prf("大九勾四", "大九勾四")
    assert tp == 4 and fp == 0 and fn == 0 and f1 == 1.0
    # 多写一个部件：pred 多「七」
    p, r, f1, tp, fp, fn = component_prf("大九勾四", "大九勾四七")
    assert tp == 4 and fp == 1 and fn == 0 and abs(p - 4 / 5) < 1e-9
    # 聚合
    rows = [score_cell("大九勾四", "大九勾四"), score_cell("散挑一", "散桃一"), score_cell("七徽挑六", None)]
    s = aggregate(rows)
    assert s["n"] == 3
    assert s["exact_match"] == 1 / 3
    assert s["detection_rate"] == 2 / 3
    # tp=4+2+0=6, fp=0+1+0=1, fn=0+1+4=5 -> F1 = 2*(6/7)*(6/11)/(6/7+6/11) = 2/3
    assert abs(s["comp_f1"] - 2 / 3) < 1e-9
    print("SELF-CHECK OK: levenshtein / CER / component-F1 / aggregate 均正确")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="减字谱识别准确率评估 harness")
    ap.add_argument("--annotations", default=None, help="标注 JSON 文件路径（--self-check 时不需要）")
    ap.add_argument("--backend", default="http://127.0.0.1:3001", help="后端基础地址")
    ap.add_argument("--offline", action="store_true", help="用标注里的 predicted 字段离线计分，不调后端")
    ap.add_argument("--timeout", type=int, default=60, help="单次请求超时（秒）")
    ap.add_argument("--report", default=None, help="输出 HTML 报告路径（默认不写）")
    ap.add_argument("--template", default=None, help="HTML 报告模板路径，默认同目录 report_template.html")
    ap.add_argument("--self-check", action="store_true", help="运行内部指标单测并退出")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()
    if not args.annotations:
        ap.error("--annotations 必填（除非使用 --self-check）")

    with open(args.annotations, "r", encoding="utf-8") as f:
        annotations = json.load(f)
    annotations["_base_dir"] = os.path.dirname(os.path.abspath(args.annotations))

    meta = {
        "run_id": _dt.datetime.now().strftime("%Y%m%d-%H%M%S"),
        "mode": annotations.get("mode", "single"),
        "backend": "(offline)" if args.offline else args.backend,
        "timestamp": _dt.datetime.now().isoformat(timespec="seconds"),
    }

    try:
        summary = run_eval(annotations, args.backend, args.offline, args.timeout)
    except BackendError as e:
        if isinstance(e, BackendUnavailable):
            print(
                f"[eval] 后端识别服务不可用（503）：{e}\n"
                f"       需配置 ANTHROPIC_API_KEY，或经 ANTHROPIC_BASE_URL 走兼容代理；\n"
                f"       或加 --offline 离线计分（用标注里的 predicted 字段）。",
                file=sys.stderr,
            )
        else:
            print(f"[eval] 后端调用失败：{e}", file=sys.stderr)
        return 2
    rows = summary.pop("_rows")
    rows_by_id = summary.pop("_rows_by_id")

    # 控制台摘要
    if summary.get("n", 0) == 0:
        print("无样本可评估。", file=sys.stderr)
        return 1
    print(f"[eval] mode={meta['mode']} backend={meta['backend']} n={summary['n']}")
    print(f"  exact_match   = {fmt_pct(summary['exact_match'])}")
    print(f"  detection_rate= {fmt_pct(summary['detection_rate'])}")
    print(f"  mean_cer      = {summary['mean_cer']:.3f}")
    print(f"  component P/R/F1 = {fmt_pct(summary['comp_prec'])} / {fmt_pct(summary['comp_rec'])} / {fmt_pct(summary['comp_f1'])}")
    if summary.get("confidence_buckets"):
        print("  confidence 分桶准确率:")
        for b in summary["confidence_buckets"]:
            print(f"    {b['range']:>12}: n={b['n']:>3}  exact={fmt_pct(b['exact_match'])}")

    if args.report:
        tpl = args.template or os.path.join(os.path.dirname(os.path.abspath(__file__)), "report_template.html")
        html = render_html(tpl, meta, summary, rows)
        with open(args.report, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"[eval] 报告已写出: {args.report}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
