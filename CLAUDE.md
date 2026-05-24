# 太音 (Taiyin) · CLAUDE.md

- **GitHub**: https://github.com/qiaopengjun5162/taiyin-guqin
- **用户**: qiaopengjun5162 (活跃于 Rust/Solana/Web3 生态)

## 项目概览

古琴减字谱数字化工具与传习平台。核心壁垒是手机端减字谱拼装输入法 + AI 简谱转减字。

## 技术栈

- **Rust**: 核心库 (`crates/taiyin-core`) + 后端服务 (`crates/taiyin-server`)
- **Next.js 16 + React 19**: 前端 (`apps/web`)
- **Tailwind CSS 4 + shadcn/ui**: 样式
- **pnpm**: JS 包管理
- **just**: 构建任务管理（`just` 命令代替 `make`）
- **cargo-nextest**: Rust 测试运行器
- **Docker Compose**: 本地开发数据库（PostgreSQL + Redis）

## 目录结构

```
taiyin-guqin/
├── crates/
│   ├── taiyin-core/       # 核心数据结构 + WASM 逻辑
│   └── taiyin-server/     # Axum 后端 API 服务
├── apps/
│   └── web/               # Next.js 前端
├── justfile               # 构建命令
├── docker-compose.yml     # 本地基础服务
└── CLAUDE.md              # 本文件
```

## 常用命令

```bash
# Rust 检查 / 测试
just check          # cargo check
just test           # cargo nextest run
just clippy         # clippy lint

# 前端
just dev            # 启动 Next.js 开发服务器
pnpm --filter web dev

# 完整 CI 前检查
just ci

# Docker 本地服务（数据库等）
just docker-up
```

## API 设计规范

- POST `/api/v1/score` - 提交曲谱 JSON
- GET `/api/v1/score/{id}` - 获取曲谱
- POST `/api/v1/translate` - 简谱转减字（AI 翻译）

## Rust 代码规范

- 使用 `thiserror` / `anyhow` 处理错误（参考 rust-template 的 `error.rs` 模式）
- release profile: LTO fat, panic abort, strip symbols
- `cargo fmt` + `cargo clippy -- -D warnings` 是硬性要求

## 前端规范

- 使用 App Router（`app/` 目录）
- shadcn/ui 组件放 `src/components/ui/`
- Tailwind CSS 4 使用 `@theme inline` 定义主题变量

## 代理设置

外部访问（如安装 pnpm 依赖时）使用代理：
```bash
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
```
