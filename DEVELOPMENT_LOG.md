# 开发日志 (Development Log)

## 2026-05-24

### 项目初始化

- 确定品牌名：**太音**，GitHub 仓库：`taiyin-guqin`
- 创建项目骨架：
  - `crates/taiyin-core/` — Rust 核心数据结构（GuqinNote, GuqinScore）
  - `apps/web/` — Next.js 16 + React 19 + Tailwind CSS 4 前端
  - `justfile` — 统一构建命令
  - `docker-compose.yml` — 本地数据库服务
  - CI (GitHub Actions) + pre-commit hooks

### 代理配置

- 代理端口：7897（Clash HTTP 代理）
- 设置方式：`export http_proxy=http://127.0.0.1:7897`、`export https_proxy=http://127.0.0.1:7897`

### 数据结构设计要点

- 减字谱用 **拼装模型** 而非枚举组合，通过类型系统保证有效组合
- 散音用 `left_finger = None + hui = None` 表达
- 传统减字谱不记节奏，但传习平台需要，所以 `duration` 为必填

### GitHub 仓库

- 仓库：`qiaopengjun5162/taiyin-guqin`
- 已推送 main 分支
- Git workflow: 直接推送 main（单人开发阶段），后续视协作情况考虑 PR 流程

### 文档

- README.md — 中文项目文档
- README.en.md — 英文项目文档
- CONTRIBUTING.md — 贡献指南

### 下一步

- 减字键盘前端组件（CSS 拼装渲染）
- taiyin-server Axum 后端骨架
- WASM bindings for core lib
