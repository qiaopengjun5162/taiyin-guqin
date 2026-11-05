#!/usr/bin/env bash
#
# 一键部署：在本机运行，通过 SSH 把太音后端推到一台 Linux 服务器、接好 HTTPS、跑完验收。
# 服务器上只做「拉成品镜像 + 跑容器 + 配反代」，绝不编译（1 核机器编 Rust 会拖死同机业务）。
#
#   bash scripts/deploy-to-server.sh <user@host> <域名> [选项]
#
# 示例：
#   bash scripts/deploy-to-server.sh ubuntu@paxon-server taiyin.qintopia.cn
#   bash scripts/deploy-to-server.sh root@122.51.77.220 122.51.77.220.nip.io   # 没 DNS 时用 nip.io
#
# 选项：
#   --dry-run         只打印将要执行的步骤，不碰服务器
#   --force-env       服务器上已有 /opt/taiyin/.env 时也重新生成（危险：换库口令）
#   --skip-proxy      不配置反向代理 / 证书（自己手动配）
#   --skip-verify     不跑 verify-deployed.sh 21 项验收
#   --skip-gh         不设置 GitHub 仓库变量 TAIYIN_API_URL
#   --with-admin      验收时带管理口令，把管理端链路一并测全（口令取自服务器 .env）
#   --install-caddy   80/443 空闲且没装反代时自动装 Caddy（默认只提示不装）
#
# 可选环境变量：
#   SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_PASSWORD MAIL_FROM
#       设置了就写进服务器 .env（自助找回口令的发信通道）；不设置留空并警告。
#   ALLOWED_ORIGINS   前端来源白名单，默认 https://qiaopengjun5162.github.io
#   APP_BASE_URL      重置邮件里的站点前缀，默认 GitHub Pages 地址
#   IMAGE_TAG         镜像标签，默认 latest；回滚时给上一个 sha-xxxxxx
#
# 前提：本机能免密 SSH 到目标服务器（公钥已在对方 ~/.ssh/authorized_keys）。
# 详细背景见 docs/deploy-backend-runbook.md。
#
# 刻意不开 pipefail：本脚本多处判定是「输出里有没有某字符串」，命中即关管道会把
# 上游 curl/openssl 的 SIGPIPE 误判成失败（verify-deployed.sh 踩过两次的坑）。
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TARGET="${1:-}"
DOMAIN="${2:-}"
if [ -z "$TARGET" ] || [ -z "$DOMAIN" ]; then
  echo "用法：bash scripts/deploy-to-server.sh <user@host> <域名> [选项]" >&2
  echo "示例：bash scripts/deploy-to-server.sh ubuntu@paxon-server taiyin.qintopia.cn" >&2
  exit 2
fi
shift 2

DRY=0
FORCE_ENV=0
SKIP_PROXY=0
SKIP_VERIFY=0
SKIP_GH=0
WITH_ADMIN=0
INSTALL_CADDY=0
PROXY_KIND=none
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --force-env) FORCE_ENV=1 ;;
    --skip-proxy) SKIP_PROXY=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    --skip-gh) SKIP_GH=1 ;;
    --with-admin) WITH_ADMIN=1 ;;
    --install-caddy) INSTALL_CADDY=1 ;;
    *) echo "未知选项：$arg" >&2; exit 2 ;;
  esac
done

case "$DOMAIN" in
  *[!A-Za-z0-9.-]*|'') echo "域名不合法：$DOMAIN（只允许字母、数字、点、连字符）" >&2; exit 2 ;;
esac

log()  { printf '\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

remote() {
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] ssh $TARGET :: $*"
    return 0
  fi
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET" "$@"
}

# ── 1. 本地预检 ─────────────────────────────────────────────
log "本地预检"

for f in deploy/docker-compose.yml deploy/.env.example scripts/verify-deployed.sh; do
  [ -f "$REPO_ROOT/$f" ] || die "仓库里缺文件：$f（在仓库根目录外运行了本脚本？）"
done
ok "仓库文件齐全"

if ! command -v ssh >/dev/null 2>&1; then die "本机没有 ssh"; fi

if [ "$DRY" = 1 ]; then
  warn "dry-run：跳过 SSH 连通性检查与所有远程动作，只打印计划"
else
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$TARGET" 'echo connected' >/dev/null 2>&1 \
    || die "SSH 连不上 $TARGET。
  最常见原因：对方 ~/.ssh/authorized_keys 里没有本机公钥。
  修法（在服务器上执行，把引号里这串换成本机 ~/.ssh/id_rsa.pub 的内容）：
      echo '本机公钥内容' >> ~/.ssh/authorized_keys
  公钥在本机的 ~/.ssh/id_rsa.pub，一条命令看它：cat ~/.ssh/id_rsa.pub"
  ok "SSH 连通"

  # 特权操作走 sudo（root 登录也用 sudo 命令；没有就装一个：apt-get install sudo）
  ssh -o BatchMode=yes "$TARGET" 'command -v sudo >/dev/null 2>&1' >/dev/null 2>&1 \
    || die "服务器上没有 sudo 命令。root 登录的话先装：apt-get install -y sudo"
  ssh -o BatchMode=yes "$TARGET" 'sudo -n true' >/dev/null 2>&1 \
    || die "sudo 需要密码（非免密）。把登录用户设成免密 sudo，或改用 root 登录重跑"

  # 服务器公网 IP（尽力而为；拿不到就跳过 DNS 比对）
  SERVER_IP="$(ssh -o BatchMode=yes "$TARGET" 'curl -4 -s --max-time 5 ifconfig.me || true' 2>/dev/null | tr -d ' \n')"
  DNS_IP="$(python3 - "$DOMAIN" <<'PYEOF' 2>/dev/null || true
import socket, sys
try:
    print(socket.gethostbyname(sys.argv[1]))
except Exception:
    pass
PYEOF
)"
  if [ -n "$SERVER_IP" ] && [ -n "$DNS_IP" ]; then
    if [ "$SERVER_IP" = "$DNS_IP" ]; then
      ok "DNS：$DOMAIN → $DNS_IP（与服务器一致）"
    else
      warn "DNS：$DOMAIN → $DNS_IP，但服务器公网 IP 是 $SERVER_IP。
  域名还指错地方时证书签不下来、验收全红。去 DNS 加一条 A 记录：$DOMAIN → $SERVER_IP
  （没有 DNS 想先跑通：改用 $SERVER_IP.nip.io 当域名再跑一次本脚本）"
    fi
  else
    warn "没能比对 DNS（解析失败或服务器无外网），自行确认 $DOMAIN 的 A 记录指向服务器"
  fi
fi

# ── 2. 服务器预检 ───────────────────────────────────────────
log "服务器预检"

if [ "$DRY" = 1 ]; then
  echo "[dry-run] 将探测：docker/compose、磁盘内存、13001 端口、80/443 上的反代"
else
  FACTS="$(ssh -o BatchMode=yes "$TARGET" 'bash -s' <<'EOF'
echo "user=$(whoami)"
echo "arch=$(uname -m)"
if command -v docker >/dev/null 2>&1; then echo "docker=yes"; else echo "docker=no"; fi
if docker compose version >/dev/null 2>&1; then echo "compose=yes"; else echo "compose=no"; fi
echo "mem=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')"
echo "disk=$(df -m / 2>/dev/null | awk 'NR==2{print $4}')"
if command -v ss >/dev/null 2>&1; then echo "port13001=$(ss -tln 2>/dev/null | grep -c ':13001 ')"; else echo "port13001=0"; fi
if command -v ss >/dev/null 2>&1; then echo "port80=$(ss -tln 2>/dev/null | grep -c ':80 ')"; else echo "port80=0"; fi
if systemctl is-active --quiet nginx 2>/dev/null; then echo "nginx=active"; else echo "nginx=inactive"; fi
if systemctl is-active --quiet caddy 2>/dev/null; then echo "caddy=active"; else echo "caddy=inactive"; fi
if command -v certbot >/dev/null 2>&1; then echo "certbot=yes"; else echo "certbot=no"; fi
if command -v python3 >/dev/null 2>&1; then echo "python3=yes"; else echo "python3=no"; fi
EOF
)" || die "服务器预检执行失败"

  fact() { printf '%s\n' "$FACTS" | sed -n "s/^$1=//p" | head -1; }

  [ "$(fact docker)" = yes ] || die "服务器没装 Docker。装好再跑：
      curl -fsSL https://get.docker.com | sh"
  [ "$(fact compose)" = yes ] || die "Docker 没有 compose 插件：
      apt-get install -y docker-compose-plugin"
  ok "Docker 就绪（用户 $(fact user) / 架构 $(fact arch)）"

  MEM="$(fact mem)"; DISK="$(fact disk)"
  [ -n "$MEM" ] && [ "$MEM" -lt 800 ] 2>/dev/null && warn "内存只剩 ${MEM}MB，1 核小机器跑数据库会紧"
  [ -n "$DISK" ] && [ "$DISK" -lt 1024 ] 2>/dev/null && warn "根分区只剩 ${DISK}MB，先清一清再部署"
  [ "$(fact port13001)" != 0 ] && warn "13001 端口已有进程在听（可能是上次部署），compose up 会更新它"

  NGINX="$(fact nginx)"; CADDY="$(fact caddy)"; PORT80="$(fact port80)"
  PROXY_KIND=none
  if [ "$NGINX" = active ] && [ "$CADDY" = active ]; then
    warn "nginx 和 caddy 同时在跑，不猜了。跳过自动配代理（--skip-proxy 语义），手动把 $DOMAIN 转到 127.0.0.1:13001"
    SKIP_PROXY=1
  elif [ "$NGINX" = active ]; then
    PROXY_KIND=nginx; ok "反代检测：nginx"
  elif [ "$CADDY" = active ]; then
    PROXY_KIND=caddy; ok "反代检测：caddy"
  elif [ "$PORT80" != 0 ]; then
    warn "80 端口被未知程序占着（不是 nginx/caddy 的服务单元）。不敢动它——
  手动给 $DOMAIN 配一条反代到 127.0.0.1:13001 后再跑 --skip-proxy"
    SKIP_PROXY=1
  else
    if [ "$INSTALL_CADDY" = 1 ]; then
      PROXY_KIND=caddy
      ok "将自动安装 Caddy（80/443 空闲）"
    else
      warn "没检测到 nginx/caddy，80/443 也空着。加 --install-caddy 可自动装 Caddy；
  或自己装好反代后用 --skip-proxy 重跑"
      SKIP_PROXY=1
    fi
  fi
fi

# ── 3. 生成 .env（本地生成、scp 上去；密钥不出现在命令行回显里）────────
log "准备 /opt/taiyin/.env"

GEN_ENV=1
if [ "$DRY" = 1 ]; then
  echo "[dry-run] 服务器上无 .env 时生成：随机 PG_PASSWORD/ADMIN_TOKEN，SMTP_* 取自本机环境变量"
else
  if remote "test -f /opt/taiyin/.env" >/dev/null 2>&1 && [ "$FORCE_ENV" != 1 ]; then
    GEN_ENV=0
    ok "服务器已有 .env，沿用（要重建加 --force-env；重建会换库口令，等于丢旧数据）"
  fi
fi

if [ "$GEN_ENV" = 1 ] && [ "$DRY" != 1 ]; then
  remote "sudo mkdir -p /opt/taiyin/pgdata" || die "建目录失败（需要 sudo 权限？）"
  TMP_ENV="$(mktemp)"
  trap 'rm -f "$TMP_ENV"' EXIT
  PG_PASSWORD="$(openssl rand -hex 24)"
  ADMIN_TOKEN="$(openssl rand -hex 24)"
  {
    echo "# 由 scripts/deploy-to-server.sh 生成于 $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "PG_USER=taiyin"
    echo "PG_DB=taiyin"
    echo "PG_PASSWORD=$PG_PASSWORD"
    echo "ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-https://qiaopengjun5162.github.io}"
    echo "HOST_PORT=13001"
    echo "ADMIN_TOKEN=$ADMIN_TOKEN"
    echo "SMTP_HOST=${SMTP_HOST:-}"
    echo "SMTP_PORT=${SMTP_PORT:-587}"
    echo "SMTP_USERNAME=${SMTP_USERNAME:-}"
    echo "SMTP_PASSWORD=${SMTP_PASSWORD:-}"
    echo "MAIL_FROM=${MAIL_FROM:-}"
    echo "APP_BASE_URL=${APP_BASE_URL:-https://qiaopengjun5162.github.io/taiyin-guqin}"
    echo "IMAGE_TAG=${IMAGE_TAG:-latest}"
    echo "RUST_LOG=info"
  } > "$TMP_ENV"
  scp -o BatchMode=yes "$TMP_ENV" "$TARGET:/tmp/taiyin.env" >/dev/null || die "scp .env 失败"
  remote "sudo mv /tmp/taiyin.env /opt/taiyin/.env && sudo chmod 600 /opt/taiyin/.env" || die "安装 .env 失败"
  rm -f "$TMP_ENV"; trap - EXIT
  ok ".env 已生成（口令只存在服务器 /opt/taiyin/.env，不回显）"
  if [ -z "${SMTP_HOST:-}" ]; then
    warn "没配 SMTP：找回口令邮件只进容器日志。要真发信，在本机 export SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD/MAIL_FROM 后 --force-env 重跑（或直接编辑服务器 .env）"
  fi
fi

# ── 4. 布置 compose 文件并起服务 ────────────────────────────
log "布置 compose 并启动"

IMG_SERVER="ghcr.io/qiaopengjun5162/taiyin-server:${IMAGE_TAG:-latest}"
IMG_PG="postgres:16"

if [ "$DRY" = 1 ]; then
  echo "[dry-run] scp deploy/docker-compose.yml → /opt/taiyin/，docker compose pull && up -d"
  echo "[dry-run] 服务器拉不到镜像时兜底：本机 docker save → scp → 服务器 docker load"
else
  scp -o BatchMode=yes "$REPO_ROOT/deploy/docker-compose.yml" "$TARGET:/tmp/docker-compose.yml" >/dev/null \
    || die "scp compose 失败"
  remote "sudo mv /tmp/docker-compose.yml /opt/taiyin/docker-compose.yml" || die "安装 compose 失败"

  # 先试服务器直连拉（网络通就走这条，最省事）
  PULLED=0
  if remote "cd /opt/taiyin && sudo docker compose pull" ; then
    PULLED=1
    ok "服务器已直接拉取镜像"
  else
    warn "服务器拉镜像失败（国内机器常连不上 docker.io/ghcr.io）。改走兜底：本机代拉 → scp 注入"
    command -v docker >/dev/null 2>&1 \
      || die "本机也没有 docker，兜底走不了。两条路任选：
  ① 在服务器给 docker 配镜像加速（腾讯云内网加速器 mirror.ccs.tencentyun.com）后重跑；
  ② 在有 docker 的机器上跑本脚本"
    log "本机代拉镜像（linux/amd64，与服务器架构一致）"
    docker pull --platform linux/amd64 "$IMG_PG" >/dev/null || die "本机拉 $IMG_PG 失败"
    docker pull --platform linux/amd64 "$IMG_SERVER" >/dev/null \
      || die "本机拉 $IMG_SERVER 失败（镜像已公开匿名可拉；仍失败查网络/代理）"
    TMP_TAR="$(mktemp -u /tmp/taiyin-images.XXXXXX.tar)"
    trap 'rm -f "$TMP_TAR"' EXIT
    docker save -o "$TMP_TAR" "$IMG_PG" "$IMG_SERVER" || die "docker save 失败"
    log "上传镜像到服务器（$(du -m "$TMP_TAR" | cut -f1)MB）"
    scp -o BatchMode=yes "$TMP_TAR" "$TARGET:/tmp/taiyin-images.tar" >/dev/null || die "scp 镜像包失败"
    remote "sudo docker load -i /tmp/taiyin-images.tar && rm -f /tmp/taiyin-images.tar" || die "服务器 docker load 失败"
    rm -f "$TMP_TAR"; trap - EXIT
    ok "镜像已注入服务器"
  fi

  remote "cd /opt/taiyin && sudo docker compose up -d" || die "启动容器失败（看日志：cd /opt/taiyin && sudo docker compose logs server）"
  ok "容器已启动"

  # 等 /health（迁移要跑几秒；distroless 镜像没有 shell，只能从宿主机探）
  HEALTHY=0
  i=0
  while [ $i -lt 30 ]; do
    if remote "curl -sf --max-time 3 http://127.0.0.1:13001/health" >/dev/null 2>&1; then
      HEALTHY=1; break
    fi
    i=$((i + 1)); sleep 2
  done
  [ "$HEALTHY" = 1 ] || die "后端 60 秒内没通过 /health。查日志：ssh $TARGET 'cd /opt/taiyin && sudo docker compose logs server | tail -50'"
  ok "后端 /health 200"
fi

# ── 5. 反向代理 + HTTPS ─────────────────────────────────────
if [ "$SKIP_PROXY" = 1 ]; then
  warn "跳过反代配置。自己把 $DOMAIN 转到 127.0.0.1:13001（注意 client_max_body_size 20m、proxy_read_timeout 180s）"
else
  log "配置反向代理（$PROXY_KIND）"

  if [ "$DRY" = 1 ]; then
    echo "[dry-run] 反代（自动检测 nginx/caddy）：写 $DOMAIN 站点 → 127.0.0.1:13001，申请证书，重载"
  elif [ "$PROXY_KIND" = caddy ]; then
    remote "command -v caddy >/dev/null 2>&1" >/dev/null 2>&1 || {
      [ "$INSTALL_CADDY" = 1 ] || die "caddy 不在 PATH；加 --install-caddy 自动装"
      log "安装 Caddy"
      remote "sudo apt-get update -qq && sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gpg" || die "装 Caddy 前置包失败"
      remote "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg" || die "导入 Caddy key 失败"
      remote "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null" || die "加 Caddy 源失败"
      remote "sudo apt-get update -qq && sudo apt-get install -y -qq caddy" || die "装 Caddy 失败"
    }
    # 幂等：站点块已存在就不再追加（按域名前缀判断）
    remote "grep -q '^$DOMAIN {' /etc/caddy/Caddyfile 2>/dev/null" >/dev/null 2>&1 && {
      ok "Caddyfile 已有 $DOMAIN 站点，跳过追加"
    } || {
      remote "sudo tee -a /etc/caddy/Caddyfile >/dev/null" <<EOF || die "写 Caddyfile 失败"

# ---- taiyin (added by scripts/deploy-to-server.sh) ----
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:13001 {
        transport http {
            read_timeout 180s
            write_timeout 180s
        }
    }
}
EOF
      ok "Caddy 站点已追加"
    }
    remote "sudo systemctl reload caddy" || die "重载 caddy 失败"
    ok "caddy 已重载（证书自动申请/续期）"
  elif [ "$PROXY_KIND" = nginx ]; then
    if ! remote "command -v certbot >/dev/null 2>&1" >/dev/null 2>&1; then
      log "安装 certbot"
      remote "sudo apt-get update -qq && sudo apt-get install -y -qq certbot" || die "装 certbot 失败"
    fi
    if remote "test -d /etc/nginx/sites-available" >/dev/null 2>&1; then
      NGINX_PATH=/etc/nginx/sites-available/taiyin.conf
      NGINX_LINK=/etc/nginx/sites-enabled/taiyin.conf
    else
      NGINX_PATH=/etc/nginx/conf.d/taiyin.conf
      NGINX_LINK=""
    fi
    # 先放 HTTP-only（certbot 要用 80 口验证域名），签完再让它自己补 443
    remote "sudo tee $NGINX_PATH >/dev/null" <<EOF || die "写 nginx 配置失败"
# taiyin (added by scripts/deploy-to-server.sh)
# 三条不能少：上传体积 20m（整页谱图）、读超时 180s（AI 识别）、X-Forwarded-*（真实 IP）。
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ { root /var/www/html; }

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:13001;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_send_timeout    180s;
        proxy_read_timeout    180s;
    }
}
EOF
    [ -n "$NGINX_LINK" ] && remote "sudo ln -sf $NGINX_PATH $NGINX_LINK"
    remote "sudo nginx -t" || die "nginx 配置校验失败（别 reload，线上别的站还跑着）"
    remote "sudo systemctl reload nginx" || die "重载 nginx 失败"
    log "申请 HTTPS 证书（Let's Encrypt）"
    remote "sudo certbot --nginx -d $DOMAIN --noninteractive --agree-tos --register-unsafely-without-email --redirect" \
      || die "certbot 签证书失败。常见原因：DNS 还没指到这台机器（第 1 步的 DNS 警告）。修好 DNS 后重跑本脚本即可（幂等）"
    ok "nginx + HTTPS 就绪"
  fi
fi

# ── 6. 验收 ─────────────────────────────────────────────────
if [ "$SKIP_VERIFY" = 1 ]; then
  warn "跳过验收"
else
  log "线上验收：https://$DOMAIN"
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] 远端探 https://$DOMAIN/health 后跑 scripts/verify-deployed.sh（21 项）"
  else
    HTTPS_OK=0
    i=0
    while [ $i -lt 20 ]; do
      if remote "curl -sf --max-time 5 https://$DOMAIN/health" >/dev/null 2>&1; then
        HTTPS_OK=1; break
      fi
      i=$((i + 1)); sleep 3
    done
    [ "$HTTPS_OK" = 1 ] || warn "https://$DOMAIN/health 没通（证书刚签可能还要一两分钟）。验收继续跑，失败项会指出来"

    VERIFY_ENV="FRONTEND_ORIGIN=${ALLOWED_ORIGINS:-https://qiaopengjun5162.github.io}"
    if [ "$WITH_ADMIN" = 1 ]; then
      ADMIN_TOK="$(remote "sudo sed -n 's/^ADMIN_TOKEN=//p' /opt/taiyin/.env" | tr -d ' \n')"
      [ -n "$ADMIN_TOK" ] || warn "服务器 .env 里没有 ADMIN_TOKEN，管理端链路测不了"
      VERIFY_ENV="$VERIFY_ENV ADMIN_TOKEN=$ADMIN_TOK"
    fi
    if env $VERIFY_ENV bash "$REPO_ROOT/scripts/verify-deployed.sh" "https://$DOMAIN"; then
      ok "线上验收全过"
    else
      die "验收有失败项（逐条见上）。修好后重跑：
      bash scripts/deploy-to-server.sh $TARGET $DOMAIN --skip-proxy --skip-gh"
    fi
  fi
fi

# ── 7. 全站默认连后端 ───────────────────────────────────────
if [ "$SKIP_GH" = 1 ]; then
  warn "跳过 TAIYIN_API_URL 设置。记得手动：gh variable set TAIYIN_API_URL --body https://$DOMAIN"
else
  log "设置前端默认后端地址"
  if [ "$DRY" = 1 ]; then
    echo "[dry-run] gh variable set TAIYIN_API_URL --body https://$DOMAIN"
  else
    export PATH="/opt/homebrew/bin:$PATH"
    if command -v gh >/dev/null 2>&1 \
       && gh variable set TAIYIN_API_URL --body "https://$DOMAIN" >/dev/null 2>&1; then
      ok "TAIYIN_API_URL=https://$DOMAIN 已设（下一次 Pages 构建生效，访客不再手填后端地址）"
    else
      warn "设置仓库变量失败（没装 gh / 不是仓库管理员）。手动执行：
      gh variable set TAIYIN_API_URL --body https://$DOMAIN"
    fi
  fi
fi

echo
ok "部署流程走完：https://$DOMAIN"
cat <<'EOF'

接下来：
  1. 打开网页 https://qiaopengjun5162.github.io/taiyin-guqin （等 1-2 分钟让 Pages 重建）
     「社区后端」面板里应显示已连接；发一首谱、换个浏览器能搜到，就算真正上线。
  2. 找回口令要真发信：服务器 /opt/taiyin/.env 里配 SMTP_* 后 `sudo docker compose up -d`。
  3. 备份：整个 /opt/taiyin/pgdata 目录就是数据库，定期打包走。
  4. 回滚：.env 里 IMAGE_TAG 改成上一个 sha-xxxxxx，再 `sudo docker compose up -d`。
EOF
