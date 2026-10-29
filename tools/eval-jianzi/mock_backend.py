#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""减字谱识别 eval 的「确定性 mock 后端」（仅 stdlib，无需 Anthropic key）。

为什么需要它
------------
eval harness 的在线模式要真实调后端识别端点；但识别质量取决于 Claude 多模态能力，
而那需要一个有效的 ANTHROPIC_API_KEY。我们不希望「验证 eval 流水线本身」这件事
被「有没有 key / 模型准不准」卡住。

这个 mock 服务与真实后端**具有相同的接口契约**
（`POST /api/v1/jianzi/recognize` 与 `/recognize-sheet`，返回同构 JSON），
但识别结果是**由图片字节确定性派生**的（sha256 → 固定词表），不调用任何模型。

用途（对应 VERIFICATION.md 的研究三分法：eval / env / model）
- 端到端冒烟：验证「图片→HTTP→后端解析→打分→HTML 报告」整条管线通畅、字段对齐。
- 隔离 env：把「管线/环境」与「模型」解耦——mock 下能跑通，说明问题只在模型侧。
- CI 友好：不需要 key 即可持续验证 harness 不被回归破坏。

注意：mock 返回的 glyph 是**确定性但非真实**的，仅用于验证管线，不代表识别准确率。
真实准确率评估请接入带 ANTHROPIC_API_KEY 的后端（见 README）。
"""
from __future__ import annotations

import base64
import hashlib
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

# 一组「像那么回事」的减字谱规范文本，作为确定性派生的目标词表。
VOCAB = [
    "散挑一",
    "大九勾四",
    "散勾三",
    "名十挑七",
    "泛起",
    "跪七勾二",
    "中七勾四",
    "食六挑五",
]


def _hash_int(b: bytes) -> int:
    return int(hashlib.sha256(b).hexdigest(), 16)


def derive_glyph(image_bytes: bytes) -> str:
    """由图片字节确定性派生一个「减字」文本（非真实识别，仅供管线验证）。"""
    return VOCAB[_hash_int(image_bytes) % len(VOCAB)]


def derive_sheet_cells(image_bytes: bytes, rows: int = 2, cols: int = 2) -> list[dict]:
    """确定性派生整页识别结果：rows×cols 网格，每格 glyph 由(图片+坐标)派生。"""
    cells: list[dict] = []
    for r in range(rows):
        for c in range(cols):
            salted = image_bytes + f":{r}:{c}".encode("utf-8")
            glyph = derive_glyph(salted)
            conf = 0.70 + (_hash_int(salted) % 30) / 100.0  # 0.70~0.99
            cells.append(
                {
                    "row": r,
                    "col": c,
                    "glyph": glyph,
                    "explanation": "mock 确定性派生（非真实识别）",
                    "confidence": round(conf, 2),
                }
            )
    return cells


class _Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict) -> None:
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler 命名约定)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length > 0 else b"{}"
            data = json.loads(body.decode("utf-8"))
            raw = base64.b64decode(data.get("image_base64", ""))
        except Exception as e:  # 请求体不合法
            self._send(400, {"error": f"bad request: {e}"})
            return

        if self.path.endswith("/recognize-sheet"):
            self._send(200, {"method": "llm", "cells": derive_sheet_cells(raw)})
        else:
            self._send(
                200,
                {
                    "method": "llm",
                    "glyph": derive_glyph(raw),
                    "explanation": "mock 确定性派生（非真实识别）",
                    "confidence": 0.92,
                },
            )

    def log_message(self, *args) -> None:  # 静默
        return


def main(argv=None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="减字谱识别 eval 的确定性 mock 后端")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=3099)
    args = ap.parse_args(argv)
    srv = HTTPServer((args.host, args.port), _Handler)
    print(f"[mock] 减字识别 mock 后端已启动： http://{args.host}:{args.port}/api/v1/jianzi/recognize", file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
