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

## 减字渲染架构（关键）

- **纯字体 GSUB 连字方案**: 忘机减字谱楷体是 OpenType GSUB 连字引擎，26 个 lookup + 227 个 GPOS lookup。输入完整字符串（如"散勾五"），字体自动完成传统半包围嵌套排版。
- **组件**: `JianziBlock` (`src/components/jianzi-block.tsx`) 是唯一渲染入口，接收 `JianziState + fontSize + compact`，通过 `jianziToText()` 序列化为字符串后写入 `<span>`，CSS 开启 `font-variant-ligatures: common-ligatures` 和 `font-feature-settings: "liga" on, "clig" on`。
- **`jianziToText` 翻译层** (`src/lib/types.ts`): 键盘偏旁（勹/木/乚/乇/丁/尸/倽）需映射为字体 GSUB 可识别的全字符（勾/抹/挑/托/打/擘/摘），否则字体 cmap 找不到对应字形。
- **音色后缀**: 泛音的音色标记 "泛" 放在字符串末尾（非前缀），因字体 GSUB 上下文匹配依赖后缀位置。
- **连续同音省略**: `ScoreView` 在 map 循环中对比前后 `toneType`，相同时传 `compact={true}` 给 `JianziBlock`，隐藏音色标记。
- **状态保留**: 提交后保留 `toneType/leftFinger/hui/fen`（模态属性），仅清空 `rightAction/stringNumber`。

## 忘机减字谱楷体（TaiYinJianZiPuKaiTi）

- 原始字体 `WangJiJianZiPuKaiTi1.1.ttf` (1.2MB) —— 含 DRM 广告 glyph（名为 `placeholder`，面积 580 万像素，映射到 10 万+ Unicode 码位）
- 清理后字体 `TaiYinJianZiPuKaiTi.ttf` —— 所有 name table 条目已改名，placeholder glyph 清空，码位重映射到 .notdef
- GSUB: 26 lookups（ContextSubst/ChainContextSubst/LigatureSubst/SingleSubst），GPOS: 227 lookups
- 字体本质是 GSUB 连字引擎，不支持拆开独立渲染

## 代理设置

外部访问（如安装 pnpm 依赖时）使用代理：
```bash
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
```
