# 社区后端上线操作手册

> **这份文档写给谁**：能登录一台服务器的人（运维同事 / 朋友 / 未来的自己）。
> 不需要懂 Rust，照着从上往下执行即可。
> 每一步先用大白话说「这步在干什么」，再给出可以直接复制的命令。

---

## 0. 先说明白：上线的是什么

**现状**：网页（GitHub Pages）是纯前端，曲谱只存在每个人自己的浏览器里，
琴友之间看不到彼此的谱，分享链接也只能分享「一台电脑上的东西」。

**上线后**：一台服务器上跑「后端程序 + 数据库」，曲谱统一存进数据库，
任何人拿到分享链接都能打开看，社区列表里能看到大家发布的谱。

**需要准备的东西**：

| 要什么 | 最低要求 | 说明 |
|---|---|---|
| 一台服务器 | 1 核 1G、任意主流 Linux | 能装 Docker 即可，流量很小 |
| 一个域名 | 子域名即可，如 `api.xxx.com` | 必须有 HTTPS（浏览器强制要求） |
| 约 1 小时 | — | 全程照抄命令 |

**整体结构**（谁连谁）：

```
弹琴的人的浏览器
    │  打开 GitHub Pages 上的静态网页
    ▼
https://qiaopengjun5162.github.io/taiyin-guqin/   ← 网页本体（已上线，不用动）
    │  网页里的「社区后端」填的是下面这个地址
    ▼
https://api.你的域名                      ← 反向代理（Nginx / Caddy，管 HTTPS）
    │  转发到本机 3001 端口
    ▼
taiyin-server 容器（Rust 后端）           ← 管曲谱的增删改查
    │
    ▼
PostgreSQL 容器（数据库）                 ← 真正存曲谱的地方
```

**身份方式（先说清楚，免得误会）**：改 / 删曲谱要出示凭据，两种任选其一：

- **本机凭证**：不注册也能用。浏览器首次发布时生成一个随机「钥匙」存在本地，
  之后改 / 删都要带这把钥匙。**代价**：清缓存 / 换电脑 = 失去旧谱的改删权
  （谱还能看，也能另存成新的）。
- **登录账号**（推荐）：邮箱 + 口令，会话 30 天。登录用户发布的谱自动归属账号，
  **换设备、清缓存都不再失去自己的谱**；旧谱可用「认领」挂到账号下，
  但必须出示当初那台设备的钥匙（否则注册一下就能认领别人的谱）。
  登录入口在网页「社区后端」设置面板里；社区列表中自己的谱会标「我的」。

口令用 Argon2id 加盐散列，会话存库、登出即吊销。**不做邮箱验证**（注册时不验信）。
**口令忘了能自助找回**：`POST /api/v1/auth/forgot-password` 把一次性重置链接寄到注册邮箱
（30 分钟内有效、只能用一次，改密即踢掉该用户全部会话），界面上点「忘了口令？」即可；
收不到信（邮箱填错 / 没配 SMTP）再走**管理员重置**兜底：
`POST /api/v1/admin/users/reset-password` 一条请求换新口令（见「管理端」一节的命令）。

---

## 1. 服务器准备

**这步在干什么**：把服务器变成能跑容器的样子，并把门关好（只开 80 / 443）。

```bash
# 1) 装 Docker（以 Ubuntu/Debian 为例，其他系统用对应包管理器）
curl -fsSL https://get.docker.com | sh

# 2) 确认装好了（两条都有版本号输出即可）
docker version
docker compose version

# 3) 防火墙：只对互联网开 80（网页）和 443（加密网页）
#    3001（后端）和 5432（数据库）只允许本机访问，绝不能暴露公网
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

> 如果用的是云服务器（阿里云 / 腾讯云 / AWS 等），安全组里同样只开 22 / 80 / 443。

---

## 2. 起数据库（PostgreSQL）

**这步在干什么**：数据库是存曲谱的仓库。先把它起起来，数据放在一个「不会因为
容器重建而丢失」的地方（叫数据卷）。

```bash
# 0) 建一个专用网络：后端用它按名字找到数据库（比 --link 干净，也不会过期失效）
docker network create taiyin-net

# 1) 建一个专门的目录，以后备份就备这个目录
sudo mkdir -p /opt/taiyin/pgdata

# 2) 起数据库容器
#   - 把数据落到 /opt/taiyin/pgdata（容器删了数据还在）
#   - 密码改成自己的强密码，别用示例值
#   - 端口 5432 只绑本机 127.0.0.1，外面连不进来
docker run -d \
  --name taiyin-pg \
  --network taiyin-net \
  --restart unless-stopped \
  -e POSTGRES_USER=taiyin \
  -e POSTGRES_PASSWORD=改成你自己的强密码 \
  -e POSTGRES_DB=taiyin \
  -v /opt/taiyin/pgdata:/var/lib/postgresql/data \
  -p 127.0.0.1:5432:5432 \
  postgres:16

# 确认它活着（输出里能看到 "database system is ready" 即可）
docker logs taiyin-pg 2>&1 | tail -5
```

---

## 3. 启动后端

**这步在干什么**：把后端跑起来。建表、升级表结构（数据库迁移）**已经内置在程序里**，
程序一启动会自动完成，不需要手动执行任何 SQL。

两条路，**默认走 3A**。

### 3A. 拉成品镜像（推荐）

**为什么默认走这条**：目标机器往往只有 1 核，还在跑别的业务。Rust release 全量编译
会长时间吃满 CPU，把同机服务拖慢甚至拖挂。镜像已经在 GitHub Actions 上编好
（`.github/workflows/backend-image.yml`），服务器只负责拉下来跑——不需要编译器，
也不需要 1G 以上的内存峰值。

```bash
# 1) 建目录，放进两个文件：docker-compose.yml、.env.example（仓库 deploy/ 目录里）
sudo mkdir -p /opt/taiyin && cd /opt/taiyin

# 2) 配环境变量
cp .env.example .env
vi .env          # 至少改 PG_PASSWORD；ALLOWED_ORIGINS 保持 github.io 那条

# 3) 拉镜像并起服务（数据库第一次初始化会自动建库建表）
docker compose pull
docker compose up -d

# 4) 确认活着
curl -i http://127.0.0.1:13001/health     # 返回 200 即成功

# 5) 看日志（首次启动会打印迁移与「CORS 未配置」之类的告警）
docker compose logs -f server
```

> **镜像是私有的，直接 `pull` 会 `denied`**。两种解法：
> ① GitHub → 你的头像 → **Packages** → `taiyin-server` → 右侧 **Package settings**
> → 把可见性改成 **Public**。一次点击，之后永久免登录（推荐）；
> ② 或先 `docker login ghcr.io -u <你的GitHub用户名>`，口令用一枚带 `read:packages` 的 PAT。
>
> ⚠️ **别看 CI 能拉就以为谁都行**：workflow 里的 `GITHUB_TOKEN` 对本仓库的包有读权限，
> 所以 Deploy Smoke 一直是绿的，而服务器上照样 `denied`。这是踩过的坑，写在手册里防再踩。

> **回滚**：把 `.env` 里的 `IMAGE_TAG` 改成上一个 `sha-xxxxxx`，再 `docker compose up -d`。
> 不用重新编译，也不用整包重下。

### 3B. 在服务器上编译（只在需要改后端代码时）

日常部署不要走这条——它会在这台机器上编 Rust。

```bash
# 1) 把代码弄到服务器上
git clone https://github.com/qiaopengjun5162/taiyin-guqin.git
cd taiyin-guqin

# 2) 构建镜像（1 核机器约 10-20 分钟，且会占满 CPU）
docker build -t taiyin-server .

# 3) 启动后端
#   - --network taiyin-net：后端直接用 "taiyin-pg" 这个名字连数据库
#   - 3001 端口只绑本机，让反向代理去转发，外面直接访问不到
docker run -d \
  --name taiyin-server \
  --network taiyin-net \
  --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -e DATABASE_URL='postgres://taiyin:改成你自己的强密码@taiyin-pg:5432/taiyin' \
  -e ALLOWED_ORIGINS='https://qiaopengjun5162.github.io' \
  -e RUST_LOG=info \
  taiyin-server

# 4) 确认活着（返回 200 即成功）
curl -i http://127.0.0.1:3001/health
```

看到 `HTTP/1.1 200 OK` 就说明后端起来了。

### 后端都有哪些配置（都是环境变量，`-e` 传入）

| 变量 | 必须？ | 说明 |
|---|---|---|
| `DATABASE_URL` | **必须** | 数据库连接串，格式见上面命令 |
| `ALLOWED_ORIGINS` | **必须** | 允许哪些网页域名调用本后端，逗号分隔。**不设等于对全网放开，公网绝不允许**。填网页的域名（如示例里的自定义域名 + github.io 两个都列上），域名要一字不差、含 `https://` |
| `RUST_LOG` | 建议 | 日志详细度，`info` 即可 |
| `HOST` / `PORT` | 可选 | 默认 `0.0.0.0:3001`，一般不用改 |
| `ANTHROPIC_API_KEY` | 可选 | 不配则「AI 优选」不可用，社区存谱不受影响 |
| `ANTHROPIC_MODEL` / `ANTHROPIC_BASE_URL` | 可选 | 默认官方 Claude 接口 |
| `LLM_API_STYLE` | 可选 | `anthropic`（默认）或 `openai`。**两套 key 二选一**：没有 Anthropic key、想用 DeepSeek 之类 OpenAI 兼容渠道时设成 `openai` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | 可选 | AI 减字图识别用（默认 DeepSeek 视觉）；不配则识别功能不可用。**模型必须支持看图**：DeepSeek 用 `deepseek-flash`，`deepseek-v4-pro` 只看文本——选错不报错，只会得到空识别 |
| `RECOGNIZE_MODE` | 可选 | 识别分流：`auto`（默认，电子谱面先走本地模板、模糊图才走 AI）/ `llm`（强制走视觉模型，跑准确率评测用） |
| `TRANSLATE_API_KEY` | 可选 | 给 `/translate/select` 加一道口令闸门（纵深防护） |
| `GLOBAL_RATE_PER_SECOND` / `GLOBAL_RATE_BURST` | 可选 | 全局限流：默认每 IP 每秒 2 次、突发 60。**这两个是真在跑的**，所有请求都过这道闸 |
| `AUTH_RATE_PER_SECOND` / `AUTH_RATE_BURST` | 可选 | 注册 / 登录的**独立**限流：默认每秒 2 次、突发 8。比全局严，因为口令散列故意慢（Argon2id 每次数百毫秒），不限流等于给攻击者一个把单核 CPU 打满的开关。1 核小机器别调大 |
| `WRITE_RATE_PER_SECOND` / `WRITE_RATE_BURST` | 可选 | 发布曲谱的**独立**限流（只锁 `POST /api/v1/scores`）：默认每秒 1 次、突发 10。它是全站唯一「一个请求换一行数据」的口子，不限就等于让人灌库；**列表读取不在这把锁里**，别把它挂到整条 `/scores` 上 |
| `PUBLISH_QUOTA_PER_ACCOUNT` / `PUBLISH_QUOTA_PER_DEVICE` | 可选 | 发布**配额**（存量，不是速率）：每个账号默认最多 100 首、每台未登录设备默认最多 30 首，超了返回 409 并提示「删掉几首旧谱」。限流管「每秒几次」，管不住「一秒发一首、连发两天」；两个都要有。未登录额度故意更低，因为本机凭证清了缓存就能换一个。**设成 0 = 立刻关闭发布入口**（出事时的应急开关，不用回滚） |
| `ADMIN_TOKEN` | 可选 | 管理端口令（请求头 `x-admin-token`）。**不设就没有管理入口**，治理接口一律 503——这是安全的默认值，不会因为忘记配置而敞开。做一次高熵随机串即可：`openssl rand -hex 24`。启用后可用：举报治理（下架/恢复）+ **重置用户口令**（自助找回的运维兜底） |
| `SMTP_HOST` | 找回口令必配 | 发信服务器（如 `smtp.163.com` / `smtp.qq.com`）。**不配则找回口令邮件只进日志、不真发出**——找回等于没通，生产必须配。授权码在邮箱设置里生成 |
| `SMTP_PORT` | 可选 | 默认 `587`（STARTTLS）；用 465 端口则自动走隐式 TLS |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | 找回口令必配 | SMTP 登录凭据（多数邮箱填的是「授权码」而不是登录口令） |
| `MAIL_FROM` | 找回口令必配 | 发件人，如 `太音古琴 <noreply@example.com>`。部分邮箱要求发件人与 SMTP 账号一致 |
| `APP_BASE_URL` | 可选 | 重置链接的站点前缀，默认 GitHub Pages 地址（`https://qiaopengjun5162.github.io/taiyin-guqin`）。换前端部署时改成新地址，否则邮件里的链接指错站 |
| `TRANSLATE_RATE_PER_SECOND` / `TRANSLATE_RATE_BURST` | 可选 | AI 翻译端点限流：默认每秒 1 次、突发 5，因为每次调用都在烧额度 |

---

## 4. 反向代理 + HTTPS

**这步在干什么**：浏览器只肯通过 HTTPS（带小锁的网址）连后端，而 HTTPS 证书要由
一个「反向代理」来管。它坐在前面收 HTTPS 请求，转手交给本机 3001 端口的后端。

**推荐用 Caddy**（自动申请、自动续期 HTTPS 证书，配置最短）：

```bash
# 装 Caddy（Debian/Ubuntu）
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

编辑 `/etc/caddy/Caddyfile`，整个文件内容就写：

```
api.你的域名 {
    # 限流要按真实用户 IP 计数，必须让代理把来访 IP 传给后端
    reverse_proxy 127.0.0.1:3001 {
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

然后：

```bash
sudo systemctl reload caddy
# 从公网验证（注意是 https，换成你的域名）
curl -i https://api.你的域名/health
```

看到 `HTTP/2 200` 就全通了。

> **用 Nginx 的话**等价要点：`proxy_pass http://127.0.0.1:3001;` 之外，
> 必须加 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，
> 并用 certbot 签证书。
>
> **少了这个头，后果比想象严重**：后端拿不到真实来源，所有用户会被算成同一个人——
> 别人正常用就把你挡在门外（429）；注册 / 登录还有单独的更严格的限流，会被更快打满。
> 极端情况下完全拿不到任何地址时，限流层会直接回 500，整个服务不可用。
> 上线后第一件事就是按第 6 节验收里的「限流头」那一条确认它在工作。

---

## 5. 把网页接上后端（在浏览器里操作，1 分钟）

1. 打开 <https://qiaopengjun5162.github.io/taiyin-guqin/>
2. 找到「社区后端」设置面板，填 `https://api.你的域名`，顺手填上「我的署名」，保存
3. 这个地址存在浏览器本地（`taiyin.apiBaseUrl`），**换浏览器 / 换设备要各填一次**

> 为什么不写死在网页里？网页托管在 GitHub Pages，是纯静态文件，没法藏配置；
> 运行时填写的好处是换后端地址不用重新构建发布网页。

---

## 5.5 内容治理：举报与下架（可选但建议配）

**这步在干什么**：社区里如果有人发了不该在那儿的东西（灌水谱、乱码谱、抄错署名的谱），
登录用户能点「举报」，但**举报不会自动下架**——下架得你点头。

为什么不做「够 N 人举报就自动下架」：本项目的注册**不验证邮箱**，一个人三分钟能开三个号。
自动下架等于给任何人一个「三个小号删掉任意一首好谱」的开关。误杀一首认真打的谱，
比晚删一天垃圾谱严重得多。

先设口令（没设就没有管理入口，接口返回 503）：

```bash
docker rm -f taiyin-server
docker run -d --name taiyin-server --network taiyin-net \
  -e DATABASE_URL="postgres://taiyin:你的密码@taiyin-pg:5432/taiyin" \
  -e ALLOWED_ORIGINS='https://你的域名' \
  -e RUST_LOG=info \
  -e ADMIN_TOKEN="$(openssl rand -hex 24)" \
  -p 127.0.0.1:3001:3001 taiyin-server:local
```

**把生成的口令存好**（密码管理器里），它是唯一的管理入口，丢了只能改环境变量重启。
找回口令要真发信的话同样方式带上 `-e SMTP_HOST=... -e SMTP_USERNAME=... -e SMTP_PASSWORD=... -e MAIL_FROM=...`
（见环境变量表；`docker compose` 部署则写进 `.env` 即可，编排里已透传）。

日常巡检：看被举报最多的谱（按举报人数倒序，最多 100 条）

```bash
curl -sS http://127.0.0.1:3001/api/v1/admin/reported \
  -H "x-admin-token: 你的口令" | python3 -m json.tool
```

每条带 `reports_count`（**不同的人**举报了几次，同一人重复举报只算一次）和 `hidden_at`
（`null` = 还没处理）。看到该处理的，先自己读一遍再决定：

```bash
# 下架（从列表消失，分享链接也变成 404）
curl -sS -X POST http://127.0.0.1:3001/api/v1/admin/scores/<id>/hide \
  -H "x-admin-token: 你的口令"

# 恢复（误杀、或谱主改好了）
curl -sS -X POST http://127.0.0.1:3001/api/v1/admin/scores/<id>/restore \
  -H "x-admin-token: 你的口令"
```

下架后**谱主自己还能打开它**（会看到「已被下架」），这样他知道发生了什么、也有机会改好再来找你恢复；
外人拿 id 直接访问是 404，列表里也搜不到。

**帮琴友重置口令**（忘口令时用，不用手进数据库）：

```bash
# 方式一：自己指定新口令（响应不回显）
curl -sS -X POST http://127.0.0.1:3001/api/v1/admin/users/reset-password \
  -H "x-admin-token: 你的口令" -H "Content-Type: application/json" \
  -d '{"email":"琴友@example.com","new_password":"告诉他的新口令"}'

# 方式二：不传 new_password，服务端生成一次性口令（响应里 temporary_password 只出现这一次，
# 抄下来转告本人，丢了就再重置一次）
curl -sS -X POST http://127.0.0.1:3001/api/v1/admin/users/reset-password \
  -H "x-admin-token: 你的口令" -H "Content-Type: application/json" \
  -d '{"email":"琴友@example.com"}'
```

重置成功 = 新口令生效 + **该用户全部登录会话立刻作废**（改密即踢下线，
偷到旧登录态的人也一起被踢）。邮箱写错会返回 404，口令不足 8 位返回 400 且原口令不动。

---

## 5.6 两条命令把「能不能用」验掉

下面第 6 节是给人看的清单；实际上有两条命令能替你走完，出错会直接指出是哪一项。

```bash
# ① 只发请求，验接口：TLS / CORS / 鉴权 / 分页 / 落库 / 管理端闸门 / 自助找回（21 项，约 25 秒；
#    另带 ADMIN_TOKEN=... 可再跑「重置口令」4 项完整链路）
bash scripts/verify-deployed.sh https://api.你的域名

# ② 开真浏览器，验界面：设置面板在不在、能不能注册、发布后社区里看不看得到、
#    收藏刷新后还在不在、375px 会不会横向溢出（9 项，需本机装了 playwright）
node scripts/e2e-community.mjs https://qiaopengjun5162.github.io/taiyin-guqin/ https://api.你的域名
```

两者不要合并：① 测的是「服务器对不对」，可以塞进 CI；② 测的是「界面这层对不对」，
混合内容被拦、按钮点不动、发布完列表不刷新，这些 curl 一条都测不出来，却恰好是
「用户说用不了」的常见原因。两条都绿，才算可以交给琴友。

> **临时拿自己电脑演示**（还没上服务器时）：`docker compose up -d` 起后端，
> 再 `cloudflared tunnel --url http://127.0.0.1:13001 --no-autoupdate --protocol http2`。
> **必须带 `--protocol http2`**：默认走 QUIC（UDP 7844），UDP 一被限速就会反复
> `no recent network activity`、外网访问回 530，看着像后端挂了，其实只是隧道在抖。
> 这种 `https://xxx.trycloudflare.com` 地址每次重启都会变，电脑睡眠就断，**只适合自查，
> 不适合发给琴友**——长期地址仍要走第 4 节的自有域名。

## 6. 上线验收清单

### v1.0 发布标准（四条缺一不可，2026-11-05 状态）

| # | 标准 | 状态 | 依据 |
|---|---|---|---|
| 1 | 线上手机走完「拼 → 译 → 编 → 播 → 慢练 → 导出 → 存」不报错 | ✅ | `scripts/e2e-community.mjs` 9 项（375px 无横向溢出） |
| 2 | 注册 / 登录 / 发布 / 收藏 / 检索全通，数据落真 Postgres | ✅ 接口层 | `scripts/verify-deployed.sh` 21 项（带 ADMIN_TOKEN 再 +4 项重置口令链路）；**对公众开放还差一台长期服务器**（见第 0 节） |
| 3 | AI 识别拿真实谱图跑一批，准确率有一个明确数字 | ⚠️ 有数字：**纯 AI exact 0%**（42 条字体真值，「模板坍缩」）；电子谱面模板路径 100% | `tools/eval-jianzi/README.md`「基线结果」。**结论：现阶段不对外开识别**，电子谱面走模板即可 |
| 4 | 密码丢了能自己找回 | ✅ 代码已备齐：邮件令牌自助找回（30 分钟有效、一次有效、改密踢会话）+ 管理员重置兜底；**生产启用需配 SMTP**（见环境变量表） | `scripts/verify-deployed.sh` 第 9/10 节；`tests/admin_reset.rs` 6 项 + `tests/password_reset_flow.rs` 8 项 |

第 3 条的数字不好看，但它正是这道闸门存在的意义：**没有数字就不敢开放，现在有数字了，可以理直气壮地关着识别入口**，直到有认得减字谱的模型（微调专用识别器，或换一家真会看的视觉渠道重跑评测）。

### 后端接口逐条打勾

逐条打勾，全过才算上线成功：

```bash
BASE=https://api.你的域名

# ① 活着
curl -i $BASE/health                                  # 期望 200

# ② 发布一首谱（必须带 x-owner-token；不带会被 401 挡下，库里不留无主数据）
curl -s -X POST $BASE/api/v1/scores \
  -H 'Content-Type: application/json' \
  -H 'x-owner-token: test-key-123' \
  -d '{"title":"上线测试","notes":[],"tuning":"zhengdiao","author":"测试员"}'
# 期望返回一段 JSON，里面有 "id"

# ③ 能拉到列表（新发布的谱在最上面）
curl -s $BASE/api/v1/scores

# ④ 拿着 ② 返回的 id，用错误的钥匙改它 → 必须 403（防的就是「知道链接就能改」）
curl -i -X PUT $BASE/api/v1/scores/把id贴这里 \
  -H 'Content-Type: application/json' -H 'x-owner-token: wrong-key' \
  -d '{"title":"改标题"}'                              # 期望 403

# ⑤ 用正确的钥匙改它 → 200
curl -i -X PUT $BASE/api/v1/scores/把id贴这里 \
  -H 'Content-Type: application/json' -H 'x-owner-token: test-key-123' \
  -d '{"title":"上线测试-已改"}'                       # 期望 200
```

浏览器侧再走一遍：

- [ ] 网页里点「发布」，社区列表出现这首谱，署名正确
- [ ] 复制分享链接，**开无痕窗口**打开，能看（只读）
- [ ] 无痕窗口里试着删 → 删不掉（因为没有钥匙）——这是**预期行为**
- [ ] 回到原来那个浏览器，能改能删
- [ ] 清掉浏览器缓存后，旧谱只能看和「另存为新谱」，不能改删——同样是预期行为
- [ ] 注册一个账号（设置面板里），社区列表里自己的谱标「我的」，还能删
- [ ] 认领一首「本机凭证发的谱」，认领后只凭登录态就能改删它
- [ ] 登出后刷新页面，界面自动回到未登录（不会一直显示已登录却改不动）

### 不想手工逐条 curl？有一键脚本

仓库里 `scripts/smoke-backend.sh` 会照本节全链路原样跑一遍：起 Postgres → 起后端
→ 验 `/health` 与 CORS 白名单 → 验所有权链路（带钥匙发布 / 错钥匙 403 / 对钥匙
200 / 无身份发布 401 / 对钥匙删 200）→ **验账号链路**（注册 / 只凭登录态发布 /
换设备凭登录态改 / 错凭证认领 403 / 对原凭证认领 200 / 收藏未登录 401 → 登录后收藏
→ 列表可见 → 取消幂等 / 登出即失效），跑完自动清理容器。

```bash
bash scripts/smoke-backend.sh            # 跑完自动清理
bash scripts/smoke-backend.sh --keep     # 保留容器，方便接着手测
```

CI 已经在替我们盯着它：改 Dockerfile、手册或服务端代码时，
`.github/workflows/runbook-smoke.yml` 会自动跑一遍，
**手册和代码不会各说各话**。

---

## 7. 备份与升级

**备份**（数据 = `/opt/taiyin/pgdata`，最简单是每天打个包）：

```bash
# 每天凌晨 3 点备份一次数据库（写进 crontab -e）
0 3 * * * docker exec taiyin-pg pg_dump -U taiyin taiyin | gzip > /opt/taiyin/backup-$(date +\%F).sql.gz

# 只保留最近 14 天
0 4 * * * find /opt/taiyin -name 'backup-*.sql.gz' -mtime +14 -delete
```

**升级后端**（改了代码 / 拉了新版之后）：

```bash
cd taiyin-guqin
git pull
docker build -t taiyin-server .
docker rm -f taiyin-server          # 删掉旧容器（数据库容器不动，数据不丢）
# 然后原样重跑第 3 步的 docker run 命令
```

表结构升级（数据库迁移）**随程序启动自动执行**，不需要手动操作。
万一新版有问题，`git checkout` 回旧版本重新 build + run 即可回滚。

---

## 8. 出问题了怎么办

| 现象 | 最可能的原因 | 怎么确认 / 修 |
|---|---|---|
| 网页里提示「后端不可达」 | 地址没填、填错、或没走 HTTPS | 先在服务器上 `curl https://api.你的域名/health`；再看浏览器控制台红字 |
| 浏览器控制台报 CORS 错误 | `ALLOWED_ORIGINS` 里没有网页的域名 | 改 `ALLOWED_ORIGINS` 后重启容器（域名要一字不差，含 `https://`） |
| 能发布，改 / 删总是 403 | 不是故障：没带钥匙，或这不是你这台浏览器发的 | 见第 0 节「安全边界」；想验证用第 6 步 ④⑤ 的 curl |
| 一会儿就 429（限流） | 反向代理没传 `X-Forwarded-For`，所有人被算成一个 IP | 按第 4 节把转发头补上 |
| 登录 / 注册频繁 429，浏览谱却正常 | 认证端点有独立且更严的限流（防口令散列的 CPU 放大攻击） | 确认转发头正确；确认是本人操作而非共享出口 IP；必要时调大 `AUTH_RATE_BURST` |
| 所有请求都 500，日志没有业务错误 | 限流层「提取不到客户端 IP」——既没有转发头也没有连接信息 | 前面必须挂反向代理并按第 4 节透传 `X-Forwarded-For`；不要用奇怪的方式直接转发到应用 |
| 列表只显示 50 首，以为数据丢了 | 列表默认分页 50 条（单页最多 200），总数在响应头 `x-total-count` | 不是 bug。界面底部有「已显示 N / 总数」与「加载更多」；接口调用方用 `?limit=&offset=` 翻页 |
| 容器启动几秒就退出 | `DATABASE_URL` 写错 / 数据库没起来 | `docker logs taiyin-server` 看最后一行；`docker logs taiyin-pg` 看数据库 |
| 启动报 `Address already in use` | 上一个实例没退干净，还占着 3001 | `lsof -nP -iTCP:3001 -sTCP:LISTEN` 找到旧 PID，`kill` 掉再启 |
| `docker build` 拉不到 rust 镜像 / 报编译器版本不够 | 部分镜像源没有 `rust:1.85` 这个旧标签（本机实测 403），且 edition 2024 的 workspace 本身就要更新编译器 | Dockerfile 已固定 `rust:1.98-slim-bookworm`；仍失败就检查本机的 Docker 镜像源配置 |
| AI 优选 / 图片识别没反应 | 只是没配 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 属于可选功能，不影响社区存谱；配上后重启容器 |
| 想看后端实时日志 | — | `docker logs -f taiyin-server`（distroless 镜像没有 shell，只能看日志） |

---

## 9. 这套系统不做什么（免得期望错位）

1. **账号很轻**：无邮箱验证（注册不验信）；找回口令靠**注册邮箱**收一次性重置链接
   （页面上点「忘了口令？」），收不到信再走**管理员重置**兜底：
   `POST /api/v1/admin/users/reset-password`（命令见「管理端」一节），
   一条请求换新口令并自动踢掉该用户全部会话。
   没配 SMTP 时找回邮件只进服务器日志、不真发出——生产上线前务必配好 SMTP_*。
2. **「无主谱」不可改删**：这是迁移前老数据的遗留问题，只能由管理员直接进数据库清理。
   新版本已禁止无身份发布（401），所以不会再新增；库里如果还查得到 `owner_token IS NULL`
   的历史行，那是升级前留下的。
3. **不含支付、私信、评论**：当前社区只做「发谱、列谱、分享、改删自己的」。

---

*代码仓库：`crates/taiyin-server`（后端）/ `apps/web`（网页）。本文档对应 README 的「生产上线检查清单」，两者冲突时以代码实际行为为准。*
