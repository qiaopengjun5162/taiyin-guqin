#!/usr/bin/env bash
# 从 git 日志生成文章时间线骨架（docs/articles/timeline.md）。
#
# 为什么用脚本而不是手抄：文章要引用「几个月、多少次提交、多少行」这类数字，
# 手抄一次就错一次。这个脚本让数字永远和仓库一致，重跑即可刷新。
#
# 用法：
#   bash scripts/gen-article-timeline.sh                    # 全量
#   bash scripts/gen-article-timeline.sh --since 2026-09-01 # 只看某段
#   bash scripts/gen-article-timeline.sh --out /tmp/t.md
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="docs/articles/timeline.md"
SINCE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    --out)   OUT="$2";   shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [ -n "$SINCE" ]; then
  RANGE=(--since "$SINCE")
else
  RANGE=()
fi

commits=$(git rev-list --count HEAD "${RANGE[@]}")
first=$(git log --reverse --format=%ad --date=short "${RANGE[@]}" | head -1)
last=$(git log -1 --format=%ad --date=short "${RANGE[@]}")
days=$(git log --format=%ad --date=short "${RANGE[@]}" | sort -u | wc -l | tr -d ' ')
files=$(git ls-files | wc -l | tr -d ' ')

# 累计增删行（git --shortstat 的文本需要解析）
read -r ins del <<<"$(git log --shortstat --format="" "${RANGE[@]}" | awk '
  /insertion|deletion/ {
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^insertions?\(\+\)/) ins += $(i-1)
      if ($i ~ /^deletions?\(-\)/)  del += $(i-1)
    }
  }
  END { printf "%d %d", ins+0, del+0 }')"

mkdir -p "$(dirname "$OUT")"

{
  echo "# 项目时间线（自动生成）"
  echo
  echo "> 由 \`scripts/gen-article-timeline.sh\` 从 git 日志生成，请勿手改。"
  echo "> 生成时间：$(date '+%Y-%m-%d %H:%M')"
  echo
  echo "## 总量"
  echo
  echo "| 指标 | 数值 |"
  echo "|---|---|"
  echo "| 提交数 | $commits |"
  echo "| 时间跨度 | $first → $last |"
  echo "| 有提交的天数 | $days |"
  echo "| 累计新增 / 删除行 | +$ins / -$del |"
  echo "| 跟踪文件数 | $files |"
  echo
  echo "## 按月"
  echo
  echo "| 月份 | 提交数 |"
  echo "|---|---|"
  git log --format=%ad --date=format:%Y-%m "${RANGE[@]}" | sort | uniq -c |
    awk '{ printf "| %s | %s |\n", $2, $1 }'
  echo
  echo "## 逐条提交"
  echo
  echo "按时间正序。写文章时按「阶段」聚合，不要流水账。"
  echo

  month=""
  git log --reverse --format="%ad|%h|%s" --date=short "${RANGE[@]}" |
    while IFS='|' read -r d h s; do
      m="${d:0:7}"
      if [ "$m" != "$month" ]; then
        echo
        echo "### $m"
        echo
        month="$m"
      fi
      echo "- \`$d\` · \`$h\` · $s"
    done
} >"$OUT"

echo "[timeline] $commits 次提交 / $days 个有效工作日 / +$ins -$del -> $OUT"
