#!/usr/bin/env bash
# 减字谱识别准确率评估 harness 便捷入口。
#
# 离线校验评分逻辑（无需 key / 无需后端）：
#   ./run.sh --offline --annotations annotations/sample_single.json --report /tmp/eval_single.html
#   ./run.sh --offline --annotations annotations/sample_sheet.json
#
# 在线跑真实识别（需后端已配置 ANTHROPIC_API_KEY）：
#   EVAL_BACKEND=http://127.0.0.1:3001 ./run.sh --annotations annotations/your_set.json
#
# 单测指标数学：
#   ./run.sh --self-check
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="${EVAL_BACKEND:-http://127.0.0.1:3001}"
exec python3 "$HERE/score.py" --backend "$BACKEND" "$@"
