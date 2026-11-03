#!/usr/bin/env bash
#
# 照着 docs/deploy-backend-runbook.md 全链路跑一遍，验证手册没写错。
#
#   本地：bash scripts/smoke-backend.sh            （跑完自动清理容器）
#         bash scripts/smoke-backend.sh --keep     （保留容器，方便手测）
#   CI  ：由 .github/workflows/runbook-smoke.yml 调用，改 Dockerfile / 手册 /
#         服务端代码时自动跑一次，防止手册与代码各说各话。
#
# 它验的正是手册里最容易过时的几条承诺：
#   1. 迁移内置：启动即自动建表，不需要手动跑 SQL；
#   2. /health 200，且 CORS 白名单对陌生来源不回 allow-origin；
#   3. 所有权链路：带钥匙发布 → 错钥匙改 403 → 对钥匙改 200 → 对钥匙删 200；
#   4. 无钥匙发布 → 成「无主谱」 → 谁也改不了（403）。
#
set -euo pipefail

NET=taiyin-smoke-net
PG=taiyin-pg-smoke
SVR=taiyin-server-smoke
IMG=taiyin-server:latest
PG_PW=taiyin_smoke_pw
HOST_PORT="${HOST_PORT:-13001}"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; cleanup; exit 1; }

cleanup() {
  if [[ $KEEP -eq 1 ]]; then echo "（--keep：容器保留，端口 $HOST_PORT）"; return; fi
  docker rm -f "$SVR" >/dev/null 2>&1 || true
  docker rm -f "$PG"  >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}

# 先把上一次没清干净的残留处理掉，否则新容器起不来（Address already in use）
docker rm -f "$SVR" >/dev/null 2>&1 || true
docker rm -f "$PG"  >/dev/null 2>&1 || true
docker network rm "$NET" >/dev/null 2>&1 || true
docker network create "$NET" >/dev/null

if ! docker image inspect "$IMG" >/dev/null 2>&1; then
  echo "▶ 构建镜像（首次约 10 分钟）"
  timeout 1800 docker build -t "$IMG" . || fail "镜像构建失败"
fi
ok "镜像就绪"

echo "▶ 起 Postgres（手册第 2 步：数据卷 + 只绑本机）"
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=taiyin -e POSTGRES_PASSWORD="$PG_PW" -e POSTGRES_DB=taiyin \
  -v taiyin-smoke-pgdata:/var/lib/postgresql/data \
  -p 127.0.0.1:15444:5432 postgres:16 >/dev/null || fail "Postgres 容器起不来"

for _ in $(seq 1 40); do
  docker exec "$PG" pg_isready -U taiyin -d taiyin >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$PG" pg_isready -U taiyin -d taiyin >/dev/null 2>&1 || fail "Postgres 一直没就绪"
ok "Postgres 就绪"

echo "▶ 起后端（手册第 3 步：迁移内置，启动自动建表）"
docker run -d --name "$SVR" --network "$NET" \
  -e DATABASE_URL="postgres://taiyin:${PG_PW}@${PG}:5432/taiyin" \
  -e ALLOWED_ORIGINS='https://paxonqiao.com,https://qiaopengjun5162.github.io' \
  -e RUST_LOG=info \
  -p 127.0.0.1:"${HOST_PORT}":3001 "$IMG" >/dev/null || fail "后端容器起不来"

BASE="http://127.0.0.1:${HOST_PORT}"
for _ in $(seq 1 60); do
  curl -fsS "$BASE/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$BASE/health" >/dev/null 2>&1 || { docker logs "$SVR" | tail -20; fail "后端没起来（见上方日志）"; }
ok "后端就绪（/health 200，迁移已自动执行）"

echo "▶ 验 CORS 白名单（陌生来源不该拿到 allow-origin）"
curl -sS -D - -o /dev/null "$BASE/health" -H "Origin: https://paxonqiao.com" \
  | grep -qi "access-control-allow-origin: https://paxonqiao.com" \
  && ok "合法来源：正确回显" || fail "合法来源没拿到 allow-origin"
curl -sS -D - -o /dev/null "$BASE/health" -H "Origin: https://evil.example" \
  | grep -qi "access-control-allow-origin" \
  && fail "陌生来源居然也拿到了 allow-origin" || ok "陌生来源：正确拒绝"

echo "▶ 验所有权链路（手册第 6 节 ②—⑤）"
NEW=$(curl -sS -X POST "$BASE/api/v1/scores" \
  -H 'Content-Type: application/json' -H 'x-owner-token: smoke-key-1' \
  -d '{"title":"上线验收测试","notes":[],"tuning":"zhengdiao","author":"冒烟脚本"}')
ID=$(printf '%s' "$NEW" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])' 2>/dev/null) \
  || fail "带钥匙发布失败：$NEW"
ok "带钥匙发布成功 id=${ID:0:8}"

curl -sS "$BASE/api/v1/scores" | grep -q "上线验收测试" || fail "列表里找不到刚发布的谱"
ok "列表可见"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/v1/scores/$ID" \
  -H 'Content-Type: application/json' -H 'x-owner-token: wrong-key' -d '{"title":"改不掉"}')
[[ "$code" == "403" ]] && ok "错钥匙改 → 403（正是防「知道链接就能改」）" \
  || fail "错钥匙改应 403，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/v1/scores/$ID" \
  -H 'Content-Type: application/json' -H 'x-owner-token: smoke-key-1' -d '{"title":"上线验收测试-已改"}')
[[ "$code" == "200" ]] && ok "对钥匙改 → 200" || fail "对钥匙改应 200，实际 $code"

GHOST=$(curl -sS -X POST "$BASE/api/v1/scores" -H 'Content-Type: application/json' \
  -d '{"title":"无主谱","notes":[]}')
GID=$(printf '%s' "$GHOST" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])' 2>/dev/null) \
  || fail "无钥匙发布失败：$GHOST"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/v1/scores/$GID" \
  -H 'Content-Type: application/json' -H 'x-owner-token: smoke-key-1' -d '{"title":"谁也改不了"}')
[[ "$code" == "403" ]] && ok "无主谱谁也改不了 → 403（手册承诺一致）" \
  || fail "无主谱应 403，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/v1/scores/$ID" \
  -H "x-owner-token: smoke-key-1")
[[ "$code" == "200" ]] && ok "对钥匙删 → 200" || fail "对钥匙删应 200，实际 $code"

cleanup
echo
echo "🎉 手册全链路验证通过：Docker + Postgres + 后端 + 所有权链路均按手册描述工作。"
