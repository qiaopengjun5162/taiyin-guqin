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
https://paxonqiao.com/taiyin-guqin/     ← 网页本体（已上线，不用动）
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

**安全边界（先说清楚，免得误会）**：这套系统**没有账号体系**。
发布谱时浏览器会生成一个随机「钥匙」存在本地，之后改 / 刹都要带这把钥匙。
所以：**清浏览器缓存 / 换电脑 = 失去自己旧谱的修改删除权**（谱还能看，也能另存成新的）。
要「登录认领旧谱」需要另做账号系统，不在本次上线范围。

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
# 建一个专门的目录，以后备份就备这个目录
sudo mkdir -p /opt/taiyin/pgdata

# 起数据库容器
#   - 把数据落到 /opt/taiyin/pgdata（容器删了数据还在）
#   - 密码改成自己的强密码，别用示例值
#   - 端口 5432 只绑本机 127.0.0.1，外面连不进来
docker run -d \
  --name taiyin-pg \
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

## 3. 构建并启动后端

**这步在干什么**：把后端程序编译成一个「镜像」（可以理解成一个打包好的软件），
然后用这个镜像跑起来。建表、升级表结构（数据库迁移）**已经内置在程序里**，
程序一启动会自动完成，不需要手动执行任何 SQL。

```bash
# 1) 把代码弄到服务器上
git clone https://github.com/qiaopengjun/taiyin-guqin.git
cd taiyin-guqin

# 2) 构建镜像（第一次约 5-10 分钟，之后有缓存会快很多）
docker build -t taiyin-server .

# 3) 启动后端
#   - --link 让后端能用 "taiyin-pg" 这个名字找到数据库
#   - 3001 端口只绑本机，让反向代理去转发，外面直接访问不到
docker run -d \
  --name taiyin-server \
  --restart unless-stopped \
  --link taiyin-pg \
  -p 127.0.0.1:3001:3001 \
  -e DATABASE_URL='postgres://taiyin:改成你自己的强密码@taiyin-pg:5432/taiyin' \
  -e ALLOWED_ORIGINS='https://paxonqiao.com,https://qiaopengjun5162.github.io' \
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
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | 可选 | AI 减字图识别用（默认 DeepSeek 视觉）；不配则识别功能不可用 |
| `TRANSLATE_API_KEY` | 可选 | 给 `/translate/select` 加一道口令闸门（纵深防护） |
| `GLOBAL_RATE_PER_SECOND` 等 | 可选 | 限流参数，默认每 IP 每秒 2 次、突发 60，一般不用改 |

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
> 并用 certbot 签证书。少了 `X-Forwarded-For` 时，所有用户会被限流算成同一个人。

---

## 5. 把网页接上后端（在浏览器里操作，1 分钟）

1. 打开 <https://paxonqiao.com/taiyin-guqin/>
2. 找到「社区后端」设置面板，填 `https://api.你的域名`，顺手填上「我的署名」，保存
3. 这个地址存在浏览器本地（`taiyin.apiBaseUrl`），**换浏览器 / 换设备要各填一次**

> 为什么不写死在网页里？网页托管在 GitHub Pages，是纯静态文件，没法藏配置；
> 运行时填写的好处是换后端地址不用重新构建发布网页。

---

## 6. 上线验收清单

逐条打勾，全过才算上线成功：

```bash
BASE=https://api.你的域名

# ① 活着
curl -i $BASE/health                                  # 期望 200

# ② 发布一首谱（注意带上钥匙头；不带也能发，但那条谱将「无主」谁也改删不了）
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
| 容器启动几秒就退出 | `DATABASE_URL` 写错 / 数据库没起来 | `docker logs taiyin-server` 看最后一行；`docker logs taiyin-pg` 看数据库 |
| 启动报 `Address already in use` | 上一个实例没退干净，还占着 3001 | `lsof -nP -iTCP:3001 -sTCP:LISTEN` 找到旧 PID，`kill` 掉再启 |
| `docker build` 拉不到 rust 镜像 / 报编译器版本不够 | 部分镜像源没有 `rust:1.85` 这个旧标签（本机实测 403），且 edition 2024 的 workspace 本身就要更新编译器 | Dockerfile 已固定 `rust:1.98-slim-bookworm`；仍失败就检查本机的 Docker 镜像源配置 |
| AI 优选 / 图片识别没反应 | 只是没配 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 属于可选功能，不影响社区存谱；配上后重启容器 |
| 想看后端实时日志 | — | `docker logs -f taiyin-server`（distroless 镜像没有 shell，只能看日志） |

---

## 9. 这套系统不做什么（免得期望错位）

1. **没有登录账号**：清缓存 / 换设备会失去旧谱的改删权（可看、可另存）。跨设备认领需要另做账号系统。
2. **「无主谱」不可改删**：发布时没带钥匙的历史数据，只能由管理员直接进数据库清理。
3. **不含支付、私信、评论**：当前社区只做「发谱、列谱、分享、改删自己的」。

---

*代码仓库：`crates/taiyin-server`（后端）/ `apps/web`（网页）。本文档对应 README 的「生产上线检查清单」，两者冲突时以代码实际行为为准。*
