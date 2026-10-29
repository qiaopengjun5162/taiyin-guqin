#!/usr/bin/env bash
# 端到端冒烟：启动 mock 后端 → 生成真值标注 → 在线跑 eval → 出报告 → 关 mock。
#
# 目的：在「无 ANTHROPIC_API_KEY」的前提下，验证 eval harness 的在线管线
# （图片→HTTP→后端解析→打分→HTML 报告）通畅且字段对齐。
# 真实准确率评估请接入带 key 的后端（README 有说明）。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PORT="${EVAL_MOCK_PORT:-3099}"
BACKEND="http://127.0.0.1:${PORT}"

# 1) 启动 mock 后端（后台）
python3 "$HERE/mock_backend.py" --port "$PORT" &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true' EXIT

# 等端口起来
for _ in $(seq 1 20); do
  if python3 - "$PORT" <<'PY' 2>/dev/null
import socket, sys
s = socket.socket(); s.settimeout(0.3)
try:
    s.connect(("127.0.0.1", int(sys.argv[1]))); sys.exit(0)
except Exception:
    sys.exit(1)
PY
  then break; fi
  sleep 0.2
done

# 2) 生成真值标注集
python3 "$HERE/gen_smoke.py"

# 3) 在线跑 eval（指向 mock 后端）
EVAL_BACKEND="$BACKEND" ./run.sh --annotations annotations/smoke_single.json --report /tmp/eval_smoke_single.html
EVAL_BACKEND="$BACKEND" ./run.sh --annotations annotations/smoke_sheet.json  --report /tmp/eval_smoke_sheet.html

echo
echo "冒烟完成。报告："
echo "  file:///tmp/eval_smoke_single.html"
echo "  file:///tmp/eval_smoke_sheet.html"
