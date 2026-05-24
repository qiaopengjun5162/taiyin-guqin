# ──────────────────────────────────────────────
# 太音 (Taiyin) · 构建与工作流命令
# ──────────────────────────────────────────────

# ── 环境 ──────────────────────────────────────
cargo := cargo
pnpm := pnpm
RUST_BACKTRACE := 1

# ── Rust ──────────────────────────────────────

# 快速检查所有 crate
check *args="":
    {{cargo}} check --all {{args}}

# 运行所有 Rust 测试（使用 nextest，如模板习惯）
test *args="":
    {{cargo}} nextest run --all-features {{args}}

# 持续测试（开发用）
test-watch *args="":
    {{cargo}} watch -x "nextest run --all-features {{args}}"

# Clippy lint（失败即报错）
clippy *args="":
    {{cargo}} clippy --all-targets --all-features --tests --benches -- -D warnings {{args}}

# 格式化 Rust 代码
fmt:
    {{cargo}} fmt --all

# 格式化检查
fmt-check:
    {{cargo}} fmt --all -- --check

# ── 前端 ──────────────────────────────────────

# 启动前端开发服务器
dev:
    {{pnpm}} --filter web dev

# 构建前端
build-web:
    {{pnpm}} --filter web build

# ── Docker ────────────────────────────────────

# 构建 Docker 镜像
docker-build:
    docker compose build

# 启动所有服务
docker-up:
    docker compose up -d

# 停止并清理
docker-down:
    docker compose down -v

# ── 完整流程 ──────────────────────────────────

# 全量检查和测试（提交前运行）
ci: fmt-check clippy test

# ── 杂项 ──────────────────────────────────────

# 显示本帮助
default:
    @just --list
