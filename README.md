# 太音 (Taiyin)

![Rust](https://img.shields.io/badge/Rust-1.85.0-orange?logo=rust)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![License](https://img.shields.io/badge/License-MIT-blue)

**太音 · 古琴减字谱 AI 传习平台**

手机端古琴减字谱拼装输入法 + AI 简谱翻译 + 琴友社区。用 Rust WASM 做核心引擎，Next.js 做前端，将千年减字谱带入数字时代。

---

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
| **AI** | Anthropic Messages API (Rust) | `/api/v1/translate/select` 简谱序列候选择优 |

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
ANTHROPIC_API_KEY=sk-...        # 可选，未配置时 LLM 择优回退启发式
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# 前端构建
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Docker 部署后端

```bash
# 构建镜像
docker build -t taiyin-server .

# 运行（需 PostgreSQL 可达）
docker run -d \
  -e DATABASE_URL=postgres://taiyin:taiyin_dev@host.docker.internal:5432/taiyin \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -p 3001:3001 \
  taiyin-server
```

### 静态前端部署

```bash
just build-wasm      # 构建 WASM 并复制到 public/wasm
pnpm --filter web build   # 输出到 apps/web/dist
```

`dist/` 为纯静态文件，可用 nginx、Cloudflare Pages、Vercel 等任意静态托管。

## 📄 许可

MIT
