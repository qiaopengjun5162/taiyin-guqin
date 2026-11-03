# 太音 (Taiyin)

![Rust](https://img.shields.io/badge/Rust-1.85.0-orange?logo=rust)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![License](https://img.shields.io/badge/License-MIT-blue)

**太音 · 古琴减字谱 AI 传习平台**

手机端古琴减字谱拼装输入法 + AI 简谱翻译 + 琴友社区。用 Rust WASM 做核心引擎，Next.js 做前端，将千年减字谱带入数字时代。

---

## ✨ 功能特性

- **减字谱拼装输入**：移动端友好的减字键盘，支持单音 / 序列输入，双层渲染（OpenType GSUB 字体 + SVG 四象限降级）覆盖泛音、打摘等特殊指法。
- **AI 减字谱识别**：上传减字谱图片，由 Claude 多模态识别为减字文本 —— 支持**单字识别 + 试听**与**整页批量识别**（按网格坐标排布成谱）。
- **误读校正**：单字与整页均支持**逐字 / 逐格校正**，直接在可编辑框改错，试听与简谱实时跟随校正结果。
- **由减字反推简谱音高**：识别出的减字自动反推简谱音高（散音取空弦、按音按徽位比例、泛音取谐波），音域扩至 **±2 八度**，覆盖古琴低音区与高音区。
- **整段导入与诊断**：校正后一键导入为可整段播放 / 导出的曲谱；导入带**诊断**，明确区分「可导入 / 待校正 / 空格」，不再静默丢弃无法解析的减字。
- **简谱翻译与演奏**：多调式简谱 ↔ 减字翻译、**全局指法编排**（Rust Viterbi，把整句当一条路径求最连贯的手位，而不是每个音各自最舒服）、LLM 候选择优、旋律播放、节拍器联动高亮、WAV / PNG / SVG 导出。

## 📂 项目结构

```text
.
├── crates
│   ├── taiyin-core          # Rust 核心数据结构 + WASM 逻辑
│   └── taiyin-server        # Axum 后端 API 服务
├── apps
│   └── web                  # Next.js 16 + React 19 前端
├── justfile                 # 统一命令入口
├── docker-compose.yml       # 本地开发数据库
└── .github/workflows/       # CI
```

## 🛠 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| **核心库** | Rust + serde | GuqinNote/GuqinScore 数据结构，WASM 编译 |
| **后端** | Axum (Rust) | 社区 API、AI 翻译转发、积分记账 |
| **前端** | Next.js 16 + React 19 | H5 网页，后续可封装为小程序 |
| **样式** | Tailwind CSS 4 + shadcn/ui | 减字键盘 CSS 拼装渲染 |
| **AI** | Anthropic Claude 多模态 (Rust) | 减字谱图片识别（`/api/v1/jianzi/recognize`、`/recognize-sheet`）+ `/api/v1/translate/select` 简谱序列候选择优 |

## 🚀 快速开始

```bash
# 安装依赖
pnpm install

# 启动前端开发服务器
just dev

# 检查 Rust 代码
just check

# 运行测试
just test

# 本地数据库（可选）
just docker-up
```

## 📐 核心数据模型

减字谱被完全结构化为 JSON 友好的数据格式，支持前端、后端、AI Agent 统一交互：

```rust
// 大指九徽勾一弦
GuqinNote {
    left_finger: Some(Da),
    hui: Some(HuiPosition { hui: 9, fen: None }),
    right_action: Gou,
    string_number: 1,
    ornaments: [],
    duration: 1.0,
}
```

详见 [taiyin-core](crates/taiyin-core/src/lib.rs)。

## 🤖 AI 减字识别

首页折叠面板「＋ 用 AI 识别减字图片」提供两个标签：

- **单字**：上传单张减字图片 → 识别为减字文本 → 实时试听、可校正。
- **整页**：上传整页减字谱图片 → 按网格批量识别 → 逐格校正 → 一键导入为曲谱。

识别走后端 `taiyin-server` 的多模态接口：

| 接口 | 说明 |
| --- | --- |
| `POST /api/v1/jianzi/recognize` | 单字识别，返回减字文本 |
| `POST /api/v1/jianzi/recognize-sheet` | 整页识别，返回按行列排布（`{row, col, glyph, confidence}`）的减字网格 |

> ⚠️ 后端需配置 `ANTHROPIC_API_KEY` 才能调用 Claude；未配置时接口返回 `503`。
> **静态前端（如 GitHub Pages）必须设置构建期环境变量 `NEXT_PUBLIC_API_URL` 指向已部署的后端**，否则识别请求会打到 `localhost:3001`。

## 🔧 常用命令

```bash
just check         # cargo check
just test          # cargo nextest run
just clippy        # clippy lint
just dev           # 前端开发服务器
just ci            # 提交前全量检查
```

## 🚀 部署

### 环境变量

后端（`crates/taiyin-server`）与前端构建均通过环境变量配置：

```bash
# 后端
DATABASE_URL=postgres://taiyin:taiyin_dev@localhost:5432/taiyin
HOST=0.0.0.0
PORT=3001
ALLOWED_ORIGINS=https://qiaopengjun5162.github.io,https://paxonqiao.com  # 生产必设
ANTHROPIC_API_KEY=sk-...        # 可选，未配置时 LLM 择优回退启发式
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
TRANSLATE_API_KEY=...           # 可选，设置后翻译端点需带 x-api-key
GLOBAL_RATE_PER_SECOND=2        # 可选，按 IP 限流（默认 2/s）
GLOBAL_RATE_BURST=60
TRANSLATE_RATE_PER_SECOND=1
TRANSLATE_RATE_BURST=5

# 前端构建
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_TRANSLATE_API_KEY=...   # 可选，与后端 TRANSLATE_API_KEY 对应
```

### Docker 部署后端

```bash
# 构建镜像
docker build -t taiyin-server .

# 运行（需 PostgreSQL 可达）
docker run -d \
  -e DATABASE_URL=postgres://taiyin:taiyin_dev@host.docker.internal:5432/taiyin \
  -e ALLOWED_ORIGINS=https://qiaopengjun5162.github.io,https://paxonqiao.com \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -p 3001:3001 \
  taiyin-server
```

### 生产上线检查清单

> 完整的、可照抄命令的上线步骤见 **[社区后端上线操作手册](docs/deploy-backend-runbook.md)**——
> 写给能登录服务器的人，从装 Docker 到验收清单一步不缺。下面是上线前的关键确认点。

后端能起来 ≠ 社区能用。上线前逐项确认：

1. **`ALLOWED_ORIGINS` 必须设**（前端域名，逗号分隔）。不设时 CORS 全放开，
   启动日志会打 `WARN`——本地开发可以，公网不行。
2. **数据库迁移无需挂载 SQL 文件**：`migrations/` 已由 `sqlx::migrate!` 在**编译期**嵌入二进制，
   容器启动即自动建表/升级。运行镜像是 distroless，不含 migrations 目录也能正常工作。
   （早期版本用 `Migrator::new(路径)` 运行时读文件，在 distroless 下会启动失败，已修正。）
3. **健康检查**：`GET /health` 返回 200，可直接作为容器/反向代理的存活探针。
4. **限流要看真实客户端 IP**：经 Nginx / Cloudflare 时**必须**透传 `X-Forwarded-For`。
   不传的后果不只是「限流不准」：所有用户会被算成同一个 IP，共享同一份额度，
   于是别人正常使用就把你挡在外面；更糟的是拿不到任何地址时限流层直接回 500。
   （`SmartIpKeyExtractor` 依次读 `X-Forwarded-For` / `X-Real-IP` / `Forwarded`，
   最后回退到 TCP 对端地址。）
5. **认证端点有独立限流**（`AUTH_RATE_PER_SECOND` / `AUTH_RATE_BURST`，默认 2/s、突发 8）。
   理由不是「防刷」而是「防 CPU 放大器」：口令散列是故意慢的（Argon2id 每次数百毫秒），
   一个不限流的注册接口等于给攻击者一个把单核打满的开关。`/auth/me` 刻意不在这把锁里——
   它被限流会被前端误当成「会话失效」，把用户登出。
6. **前端指后端**：静态站点用构建期 `NEXT_PUBLIC_API_URL`，或在页面「社区后端」面板
   填运行时地址（运行时优先级更高，改完不用重新构建）。
7. **分享链接依赖后端**：`?score=<id>` 直达、社区 tab、本机谱迁移都要求后端可达；
   后端没起来时页面会退回浏览器本地存储。
8. **改 / 删社区曲谱要有凭据**，两种任选其一，服务端认其一即放行：
   - **本机凭证**（不注册也能用）：浏览器首次发布时生成随机 token 存本地
     （`taiyin.ownerToken`），改删时放在 `x-owner-token` 请求头；
   - **登录态**（推荐）：注册邮箱 + 口令后拿会话 token，放在
     `Authorization: Bearer <token>`。登录用户发布的谱会自动记下归属账号，
     **换设备、清缓存都不再失去自己的谱**。
   已在别处发布的旧谱可用 `POST /api/v1/scores/{id}/claim` 认领到账号下，
   **必须出示当初那台设备的 `x-owner-token`**——否则注册一下就能把别人的谱认领走。
   迁移前的老数据没有 token，属于「无主谱」，一律拒绝改删，需管理员直接操作数据库清理。
9. **列表是分页的**：`GET /api/v1/scores` 默认返回 50 条、单页最多 200 条
   （`?limit=&offset=`），总数由响应头 `x-total-count` 给出。直接拿全量的调用方
   要按页取完——只看第一页去做「是否已发过」这类判断，会重复发布。
   - **界面入口**：登录 / 注册在页面「社区后端」设置面板里；社区列表中自己的谱标
     「我的」并保留删除按钮；本机发布但还没归账号的谱多一个「认领」按钮。
8. **账号体系的边界（如实说明）**：口令用 Argon2id 加盐散列，会话是随机 32 字节、
   存库、30 天过期（登出即吊销，不是自证式 JWT）；但**不做邮箱验证**（没有邮件通道），
   **也不做找回口令**——口令真丢了只能由管理员介入。界面上要照实说，
   不能让人以为注册过就等于安全托管。

### 静态前端部署

```bash
just build-wasm      # 构建 WASM 并复制到 public/wasm
pnpm --filter web build   # 输出到 apps/web/dist
```

`dist/` 为纯静态文件，可用 nginx、Cloudflare Pages、Vercel 等任意静态托管。

### GitHub Pages 自动部署

仓库已配置 `.github/workflows/pages.yml`：每次 push 到 `main` 自动构建 WASM + 前端并发布到 GitHub Pages（自定义域名 `paxonqiao.com/taiyin-guqin/`）。部署时需保证：

- `NEXT_PUBLIC_API_URL` 指向可访问的 `taiyin-server` 后端（AI 识别功能依赖它）；
- 后端 `ANTHROPIC_API_KEY` 已配置。

> 部署状态以 GitHub Actions 的 **Deploy to GitHub Pages** 工作流结论为准；自定义域名的 HTTPS 证书需在仓库 **Settings → Pages** 中确认有效。

## 📄 许可

MIT
