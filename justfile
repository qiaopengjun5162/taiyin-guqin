# ──────────────────────────────────────────────
# 太音 (Taiyin) · 构建与工作流命令
# ──────────────────────────────────────────────

# ── 环境 ──────────────────────────────────────
export RUST_BACKTRACE := "1"

# ── 工具别名 ──────────────────────────────────
cargo := "cargo"
pnpm := "pnpm"

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

# ── Rust WASM ────────────────────────────────────

# 构建 taiyin-core WASM 包并部署到前端
build-wasm:
    cd crates/taiyin-core && wasm-pack build --target web
    rm -rf apps/web/wasm apps/web/public/wasm
    cp -r crates/taiyin-core/pkg apps/web/wasm
    cp -r crates/taiyin-core/pkg apps/web/public/wasm

# ── 前端 ──────────────────────────────────────

# 启动前端开发服务器
dev:
    {{pnpm}} --filter web dev

# 构建前端
build-web:
    {{pnpm}} --filter web build

# 前端类型检查
ts-check:
    cd apps/web && npx tsc --noEmit

# 前端测试
test-web:
    {{pnpm}} --filter web test

# 前端 lint
lint-web:
    cd apps/web && npx eslint src/ --ext .ts,.tsx

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

# ── SVG 字形提取 ──────────────────────────────

# 从 TaiYinJianZiPuKaiTi 提取所有 SVG path（基准版本）
extract-svg-paths:
    python3 scripts/extract-svg-paths.py

# 从齊伋體提取古体字形 SVG path
extract-ancient-paths:
    python3 scripts/extract-ancient-paths.py

# 将古体字形合并到 svg-paths.ts 中（替换 22 个标准 CJK 字符）
merge-ancient-paths:
    python3 scripts/merge-ancient-paths.py

# ── 完整流程 ──────────────────────────────────

# 全量检查和测试（提交前运行）
ci: fmt-check clippy test test-web

# ── 杂项 ──────────────────────────────────────

# 设置 git hooks（首次克隆仓库后运行一次）
setup-hooks:
    git config core.hooksPath .githooks
    @echo "✓ git hooks 已安装（.githooks/）"

# 显示本帮助
default:
    @just --list
