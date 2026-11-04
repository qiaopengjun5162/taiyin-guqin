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
#   4. 无身份发布 → 401（不再产生谁也删不掉的无主谱）；
#   5. 账号链路：注册 → 只凭登录态发布 → 换设备凭登录态改 → 认领旧谱 → 收藏；
#      （认领必须出示原凭证，否则注册一下就能认领别人的谱）→ 登出即失效；
#   6. 列表分页：limit 夹紧、越界返回空数组、响应带总数头；
#   7. 限流层真的挂上了（响应带 x-ratelimit-* 头）——配置项写了却没接线
#      是这类「以为有保护、其实没有」的经典事故。
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
  -e ALLOWED_ORIGINS='https://qiaopengjun5162.github.io' \
  -e RUST_LOG=info \
  -e ADMIN_TOKEN="${SMOKE_ADMIN:-smoke-admin-key}" \
  -p 127.0.0.1:"${HOST_PORT}":3001 "$IMG" >/dev/null || fail "后端容器起不来"

BASE="http://127.0.0.1:${HOST_PORT}"
for _ in $(seq 1 60); do
  curl -fsS "$BASE/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "$BASE/health" >/dev/null 2>&1 || { docker logs "$SVR" | tail -20; fail "后端没起来（见上方日志）"; }
ok "后端就绪（/health 200，迁移已自动执行）"

echo "▶ 验 CORS 白名单（陌生来源不该拿到 allow-origin）"
curl -sS -D - -o /dev/null "$BASE/health" -H "Origin: https://qiaopengjun5162.github.io" \
  | grep -qi "access-control-allow-origin: https://qiaopengjun5162.github.io" \
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

echo "▶ 验列表分页（谱攒多了不能一次全拉）"
HDRS=$(mktemp)
ONE=$(curl -sS -D "$HDRS" "$BASE/api/v1/scores?limit=1")
N=$(printf '%s' "$ONE" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
[[ "$N" == "1" ]] && ok "?limit=1 只回 1 条" || fail "?limit=1 应回 1 条，实际 $N"
grep -qi "x-total-count:" "$HDRS" \
  && ok "响应带 x-total-count（前端靠它判断还有没有更多）" \
  || fail "缺 x-total-count，前端无从知道总数"
CAP=$(curl -sS "$BASE/api/v1/scores?limit=99999" \
  | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
[[ "$CAP" -le 200 ]] && ok "?limit=99999 被夹到 200（挡不住就能一条请求拖走整库）" \
  || fail "单页上限没生效，实际返回 $CAP 条"
FAR=$(curl -sS "$BASE/api/v1/scores?offset=999999" \
  | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
[[ "$FAR" == "0" ]] && ok "越界 offset 返回空数组" || fail "越界 offset 应返回空数组，实际 $FAR"
rm -f "$HDRS"

echo "▶ 验限流层确实接上了"
curl -sS -D - -o /dev/null "$BASE/health" | grep -qi "x-ratelimit-limit" \
  && ok "响应带 x-ratelimit-* 头（配置项真的挂到了路由上）" \
  || fail "没有 x-ratelimit 头：限流配置可能写了但没接线"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/v1/scores/$ID" \
  -H 'Content-Type: application/json' -H 'x-owner-token: wrong-key' -d '{"title":"改不掉"}')
[[ "$code" == "403" ]] && ok "错钥匙改 → 403（正是防「知道链接就能改」）" \
  || fail "错钥匙改应 403，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/v1/scores/$ID" \
  -H 'Content-Type: application/json' -H 'x-owner-token: smoke-key-1' -d '{"title":"上线验收测试-已改"}')
[[ "$code" == "200" ]] && ok "对钥匙改 → 200" || fail "对钥匙改应 200，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/scores" \
  -H 'Content-Type: application/json' -d '{"title":"无主谱","notes":[]}')
[[ "$code" == "401" ]] && ok "无身份发布 → 401（不再产生谁也删不掉的无主谱）" \
  || fail "无身份发布应 401，实际 $code"

echo "▶ 验账号链路（注册 → 跨设备改 → 认领旧谱）"
# 邮箱带时间戳：脚本可重复跑，重复注册会 409
EMAIL="smoke-$(date +%s)@example.com"

REG=$(curl -sS -X POST "$BASE/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smoke-pass-1234\",\"display_name\":\"冒烟\"}")
TOKEN=$(printf '%s' "$REG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' 2>/dev/null) \
  || fail "注册失败：$REG"
ok "注册成功（返回会话 token）"

code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN")
[[ "$code" == "200" ]] && ok "凭会话查到当前用户 → 200" || fail "/auth/me 应 200，实际 $code"

# 只带会话、不带本机凭证发布：这首谱归属账号，不依赖任何一台设备
ACC=$(curl -sS -X POST "$BASE/api/v1/scores" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"账号发布的谱","notes":[],"tuning":"zhengdiao"}')
AID=$(printf '%s' "$ACC" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])' 2>/dev/null) \
  || fail "登录态发布失败：$ACC"
ok "登录态发布成功（归属账号）"

# 换设备：新会话、没有原凭证，只凭登录态仍应改得动
code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/v1/scores/$AID" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"账号发布的谱-已改"}')
[[ "$code" == "200" ]] && ok "换设备凭登录态改 → 200（账号体系的核心承诺）" \
  || fail "登录态改应 200，实际 $code"

# 认领：先在没登录的情况下用本机凭证发一首，再挂到账号下
OLD=$(curl -sS -X POST "$BASE/api/v1/scores" -H 'Content-Type: application/json' \
  -H 'x-owner-token: smoke-key-2' -d '{"title":"待认领的谱","notes":[]}')
OID=$(printf '%s' "$OLD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])' 2>/dev/null) \
  || fail "无账号发布失败：$OLD"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/scores/$OID/claim" \
  -H "Authorization: Bearer $TOKEN" -H 'x-owner-token: smoke-key-1')
[[ "$code" == "403" ]] && ok "拿错凭证认领 → 403（防「注册一下认领别人的谱」）" \
  || fail "错凭证认领应 403，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/scores/$OID/claim" \
  -H "Authorization: Bearer $TOKEN" -H 'x-owner-token: smoke-key-2')
[[ "$code" == "200" ]] && ok "出示原凭证认领 → 200" || fail "认领应 200，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/v1/scores/$OID" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"已认领的谱"}')
[[ "$code" == "200" ]] && ok "认领后只凭登录态就能改 → 200" \
  || fail "认领后应可凭登录态改，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}")
[[ "$code" == "401" ]] && ok "错误口令登录 → 401" || fail "错误口令应 401，实际 $code"

echo "▶ 验收藏（必须登录，取消幂等）"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/v1/scores/$AID/favorite")
[[ "$code" == "401" ]] && ok "未登录收藏 → 401（收藏跟账号走，不跟设备走）" \
  || fail "未登录收藏应 401，实际 $code"

FAV=$(curl -sS -X PUT "$BASE/api/v1/scores/$AID/favorite" -H "Authorization: Bearer $TOKEN")
printf '%s' "$FAV" | grep -q '"favorited":true' && ok "登录后收藏 → favorited:true" \
  || fail "收藏响应不对：$FAV"

FAVLIST=$(curl -sS "$BASE/api/v1/favorites" -H "Authorization: Bearer $TOKEN")
printf '%s' "$FAVLIST" | grep -q '账号发布的谱' && ok "收藏列表里能找到刚收的谱" \
  || fail "收藏列表里没有刚收的谱：$FAVLIST"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/v1/scores/$AID/favorite" \
  -H "Authorization: Bearer $TOKEN")
[[ "$code" == "200" ]] && ok "取消收藏 → 200（重复取消也不报错）" \
  || fail "取消收藏应 200，实际 $code"

echo "▶ 验内容治理（举报只记录、下架必须管理员点头）"
ADMIN_KEY="${SMOKE_ADMIN:-smoke-admin-key}"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/scores/$ID/report")
[[ "$code" == "401" ]] && ok "未登录举报 → 401（举报按人去重，不认设备）" \
  || fail "未登录举报应 401，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/scores/$AID/report" \
  -H "Authorization: Bearer $TOKEN")
[[ "$code" == "400" ]] && ok "举报自己的谱 → 400（想删用删除，别走举报）" \
  || fail "举报自己的谱应 400，实际 $code"

REP=$(curl -sS -X POST "$BASE/api/v1/scores/$ID/report" -H "Authorization: Bearer $TOKEN")
printf '%s' "$REP" | grep -q '"reported":true' && ok "首次举报 → reported:true" \
  || fail "首次举报响应不对：$REP"
REP2=$(curl -sS -X POST "$BASE/api/v1/scores/$ID/report" -H "Authorization: Bearer $TOKEN")
printf '%s' "$REP2" | grep -q '"reported":false' && ok "重复举报 → reported:false（不会把数字刷上去）" \
  || fail "重复举报应 reported:false，实际：$REP2"

code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/v1/admin/reported")
[[ "$code" == "401" ]] && ok "管理端不带口令 → 401" || fail "管理端无口令应 401，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/v1/admin/reported" \
  -H "x-admin-token: wrong-admin")
[[ "$code" == "401" ]] && ok "管理端口令错误 → 401" || fail "管理端口令错误应 401，实际 $code"

curl -sS "$BASE/api/v1/admin/reported" -H "x-admin-token: $ADMIN_KEY" \
  | grep -q "上线验收测试-已改" && ok "被举报列表里能看到这首（带举报人数）" \
  || fail "管理端列表里没有刚被举报的谱"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/admin/scores/$ID/hide" \
  -H "x-admin-token: $ADMIN_KEY")
[[ "$code" == "200" ]] && ok "管理员下架 → 200" || fail "下架应 200，实际 $code"

curl -sS "$BASE/api/v1/scores?limit=200" | grep -q "上线验收测试-已改" \
  && fail "下架后仍出现在列表里：等于没下架" || ok "下架后从列表消失"

code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/v1/scores/$ID")
[[ "$code" == "404" ]] && ok "外人凭 id 直接读 → 404（分享链接也打不开，才叫下架）" \
  || fail "外人读已下架谱应 404，实际 $code"

OWN=$(curl -sS "$BASE/api/v1/scores/$ID" -H 'x-owner-token: smoke-key-1')
printf '%s' "$OWN" | grep -q '"hidden":true' && ok "谱主仍能读到，并看到 hidden:true（才知道发生了什么）" \
  || fail "谱主应能读到已下架谱：$OWN"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/admin/scores/$ID/restore" \
  -H "x-admin-token: $ADMIN_KEY")
[[ "$code" == "200" ]] && ok "管理员恢复 → 200" || fail "恢复应 200，实际 $code"
curl -sS "$BASE/api/v1/scores?limit=200" | grep -q "上线验收测试-已改" \
  && ok "恢复后重新出现在列表里" || fail "恢复后列表里还是没有"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/auth/logout" \
  -H "Authorization: Bearer $TOKEN")
[[ "$code" == "200" ]] && ok "登出 → 会话即失效" || fail "登出应 200，实际 $code"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN")
[[ "$code" == "401" ]] && ok "登出后 /auth/me → 401（会话真被吊销，不是只清本地）" \
  || fail "登出后应 401，实际 $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/v1/scores/$ID" \
  -H "x-owner-token: smoke-key-1")
[[ "$code" == "200" ]] && ok "对钥匙删 → 200" || fail "对钥匙删应 200，实际 $code"

cleanup
echo
echo "🎉 手册全链路验证通过：Docker + Postgres + 后端 + 所有权链路均按手册描述工作。"
