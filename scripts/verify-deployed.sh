#!/usr/bin/env bash
#
# 上线验收：对着一台**已经在跑**的后端打一轮真请求。
#
#   bash scripts/verify-deployed.sh https://taiyin.你的域名
#   bash scripts/verify-deployed.sh http://127.0.0.1:13001
#   FRONTEND_ORIGIN=https://你的前端域名 bash scripts/verify-deployed.sh https://...
#
# 与 smoke-backend.sh 的分工（两者不要合并）：
#   - smoke-backend.sh 验「代码 + 容器能不能跑」，自己起库、自己起服务、跑完清理；
#   - 本脚本验「线上一台真机器是不是真的对公网可用」——多验 TLS、真实 Origin 的 CORS、
#     以及线上那台机器的数据库到底有没有落盘。它只发请求，不碰容器。
#
# 会写数据：创建一首测试谱，验完删掉；注册一个带时间戳的测试账号（后端没有删号接口，
# 留着不影响使用）。别对着生产库反复跑成百上千次——每次会留一个测试账号。
#
# 退出码：0 = 全过；1 = 有失败项（逐条已打印）。

# 刻意不用 pipefail：本脚本每条判定都是「输出里有没有这段字符串」，
# 配上 `grep -q` 就会在命中那一刻提前关闭管道，上游（openssl / curl）收到 SIGPIPE、
# 退出码非 0，pipefail 于是把「命中」判成「失败」。这条坑让 TLS 检查假红过两次。
set -u

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo "用法: bash scripts/verify-deployed.sh https://taiyin.你的域名"
  exit 2
fi
BASE="${BASE%/}"
ORIGIN="${FRONTEND_ORIGIN:-https://qiaopengjun5162.github.io}"
TAG="验收-$(date +%H%M%S)"

PASS=0
FAIL=0
ok()  { echo "✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "❌ $1"; FAIL=$((FAIL + 1)); }

echo "验收目标：$BASE"
echo "前端来源：$ORIGIN"
echo "────────────────────────────────────────"

# ── 1. TLS ────────────────────────────────────────────────
# 浏览器只肯从 https 页面调 https 接口（混合内容会被直接拦），
# 所以证书是否真的有效，是「能不能用」的第一道门，不是加分项。
if [[ "$BASE" == https://* ]]; then
  hostport="${BASE#https://}"
  hostport="${hostport%%/*}"
  hostname_only="${hostport%%:*}"
  # openssl 不读 http_proxy，得显式 -proxy；否则在代理环境下这条会假红，
  # 把「证书没问题」误判成「证书有问题」——比不检查更糟。
  proxy_args=()
  p="${HTTPS_PROXY:-${https_proxy:-}}"
  if [[ -n "$p" ]]; then
    p="${p#http://}"; p="${p#https://}"; p="${p%/}"
    proxy_args=(-proxy "$p")
  fi
  # 注意是 2>&1 不是 2>/dev/null：openssl 把 "Verify return code" 打在 stderr 上，
  # 吞掉 stderr 会让这条检查永远失败（假红，比不检查更坏）。
  if echo | openssl s_client -servername "$hostname_only" -connect "$hostport" "${proxy_args[@]}" 2>&1 \
      | grep -q "Verify return code: 0 (ok)"; then
    ok "TLS 证书有效（$hostname_only）"
  else
    bad "TLS 证书校验失败——手机上会直接白屏（点开浏览器看是否提示不安全）"
  fi
else
  echo "⏭  跳过 TLS 检查（目标是 http）"
fi

# ── 2. 健康检查 ────────────────────────────────────────────
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/health" 2>/dev/null)
[[ "$code" == "200" ]] && ok "/health 200" || bad "/health 应 200，实际 ${code:-连不上}"

# ── 3. CORS 白名单 ────────────────────────────────────────
if curl -sS -D - -o /dev/null --max-time 15 "$BASE/health" -H "Origin: $ORIGIN" 2>/dev/null \
  | grep -qi "access-control-allow-origin: $ORIGIN"; then
  ok "白名单来源回显 allow-origin（前端能调通）"
else
  bad "白名单来源没拿到 allow-origin —— ALLOWED_ORIGINS 没配成 $ORIGIN"
fi

if curl -sS -D - -o /dev/null --max-time 15 "$BASE/health" -H "Origin: https://evil.example" 2>/dev/null \
  | grep -qi "access-control-allow-origin"; then
  bad "陌生来源也拿到了 allow-origin —— ALLOWED_ORIGINS 没生效（等于对全网放开）"
else
  ok "陌生来源被拒"
fi

# ── 4. 限流层真的挂上了 ────────────────────────────────────
if curl -sS -D - -o /dev/null --max-time 15 "$BASE/health" 2>/dev/null | grep -qi "x-ratelimit-limit"; then
  ok "响应带 x-ratelimit-*（限流不是写在配置里没人用）"
else
  bad "没有 x-ratelimit 头：限流配置可能写了但没接线"
fi

# ── 5. 写路径：无身份必须 401 ──────────────────────────────
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$BASE/api/v1/scores" \
  -H 'Content-Type: application/json' -d '{"title":"无主谱","notes":[]}' 2>/dev/null)
[[ "$code" == "401" ]] && ok "无身份发布 → 401" || bad "无身份发布应 401，实际 $code"

# ── 6. 带钥匙发布 → 列表可见 ───────────────────────────────
KEY="verify-key-$RANDOM$RANDOM"
NEW=$(curl -sS --max-time 20 -X POST "$BASE/api/v1/scores" \
  -H 'Content-Type: application/json' -H "x-owner-token: $KEY" \
  -d "{\"title\":\"$TAG\",\"notes\":[],\"tuning\":\"zhengdiao\",\"author\":\"上线验收\"}" 2>/dev/null)
ID=$(printf '%s' "$NEW" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
if [[ -n "$ID" ]]; then
  ok "带设备钥匙发布成功（id=${ID:0:8}）"
else
  bad "发布失败：$NEW"
fi

if [[ -n "$ID" ]]; then
  # 按 id 找而不是按标题找：标题是中文，某些 locale 下 grep 会失手；
  # id 是 UUID，不会误命中，也不会因为编码问题假红。
  curl -sS --max-time 20 "$BASE/api/v1/scores?limit=200" 2>/dev/null | grep -q "$ID" \
    && ok "社区列表里查得到刚发布的谱（数据库真的在写）" \
    || bad "社区列表里找不到刚发布的谱"

  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X PUT "$BASE/api/v1/scores/$ID" \
    -H 'Content-Type: application/json' -H 'x-owner-token: wrong-key' -d '{"title":"改不掉"}' 2>/dev/null)
  [[ "$code" == "403" ]] && ok "错钥匙改 → 403" || bad "错钥匙改应 403，实际 $code"

  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X PUT "$BASE/api/v1/scores/$ID" \
    -H 'Content-Type: application/json' -H "x-owner-token: $KEY" -d '{"title":"上线验收-已改"}' 2>/dev/null)
  [[ "$code" == "200" ]] && ok "对钥匙改 → 200" || bad "对钥匙改应 200，实际 $code"
fi

# ── 7. 分页 ───────────────────────────────────────────────
HDRS=$(mktemp)
curl -sS -D "$HDRS" -o /dev/null --max-time 20 "$BASE/api/v1/scores?limit=1" 2>/dev/null
grep -qi "x-total-count:" "$HDRS" && ok "响应带 x-total-count（前端靠它判断有没有下一页）" \
  || bad "缺 x-total-count"
CAP=$(curl -sS --max-time 25 "$BASE/api/v1/scores?limit=99999" 2>/dev/null \
  | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
if [[ -n "${CAP:-}" && "$CAP" -le 200 ]]; then
  ok "?limit=99999 被夹到 ≤200（挡不住就能一条请求拖走整库）"
else
  bad "单页上限没生效，实际返回 ${CAP:-未知}"
fi
rm -f "$HDRS"

# ── 8. 账号链路：注册 → 我是谁 → 收藏 ──────────────────────
EMAIL="verify-$(date +%s)-$RANDOM@example.com"
REG=$(curl -sS --max-time 20 -X POST "$BASE/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"verify-pass-1234\",\"display_name\":\"验收\"}" 2>/dev/null)
TOKEN=$(printf '%s' "$REG" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
if [[ -n "$TOKEN" ]]; then
  ok "注册成功（$EMAIL）"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/v1/auth/me" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)
  [[ "$code" == "200" ]] && ok "带会话取「我是谁」→ 200" || bad "/auth/me 应 200，实际 $code"

  if [[ -n "$ID" ]]; then
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X PUT \
      "$BASE/api/v1/scores/$ID/favorite" -H "Authorization: Bearer $TOKEN" 2>/dev/null)
    [[ "$code" == "200" ]] && ok "收藏 → 200" || bad "收藏应 200，实际 $code"
    curl -sS --max-time 20 "$BASE/api/v1/favorites" -H "Authorization: Bearer $TOKEN" 2>/dev/null \
      | grep -q "$ID" && ok "收藏列表里有它（跟着账号走）" || bad "收藏列表里找不到"
  fi
else
  bad "注册失败：$REG"
fi

# ── 9. 收尾：删掉测试谱，别把验收垃圾留在社区里 ────────────
if [[ -n "$ID" ]]; then
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X DELETE "$BASE/api/v1/scores/$ID" \
    -H "x-owner-token: $KEY" 2>/dev/null)
  [[ "$code" == "200" || "$code" == "204" ]] && ok "删除测试谱 → $code（收尾干净）" \
    || bad "删除测试谱失败，实际 $code（请手动删掉「$TAG」）"
fi

echo "────────────────────────────────────────"
echo "通过 $PASS 项，失败 $FAIL 项"
if [[ "$FAIL" -gt 0 ]]; then
  echo "结论：**还不能给用户用**，先修上面标 ❌ 的项。"
  exit 1
fi
echo "结论：这台后端对公网可用，账号 / 发布 / 收藏 / 检索链路都通。"
