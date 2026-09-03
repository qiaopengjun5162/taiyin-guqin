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

# 从 Rust wire 类型重新生成前端 TS 类型（见 crates/taiyin-core/src/bin/gen_types.rs）。
# 生成结果落在 apps/web/src/lib/generated/，由前端直接 import，杜绝手工对齐。
gen-types:
    {{cargo}} run -p taiyin-core --bin gen_types

# 检查生成的前端类型是否与 Rust 契约同步（CI / 提交前用；若 Rust 改了却忘了重新生成则失败）。
# 做法：重新生成，再比对 git 工作树中的 generated 目录是否发生变化。
check-types-fresh:
    {{cargo}} run -p taiyin-core --bin gen_types
    git diff --exit-code -- apps/web/src/lib/generated

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

# 真实 WASM 产物契约验证（不经过 mock，需先 build-wasm）
verify-wasm:
    node scripts/verify-wasm.mjs

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

# ── 部署 ─────────────────────────────────────

# 构建生产产物：WASM + 前端静态导出
prod-build: build-wasm build-web

# 本地完整启动：数据库 + 后端 + 前端开发服务器
run-local: docker-up
    @echo "PostgreSQL/Redis 已启动，请另开终端运行 just dev"

# 全量检查和测试（CI 用，需要数据库；见 .github/workflows/build.yml 的 postgres 服务）
ci: fmt-check clippy test test-web check-types-fresh

# 单元测试（不含需要 DATABASE_URL 的集成测试，本地无需起库）
test-lib *args="":
	{{cargo}} nextest run --all-features --lib {{args}}

# 提交前本地快速检查（不依赖数据库，秒级）
# 由 .githooks/pre-commit 调用；需要数据库的后端集成测试交给 CI。
# check-types-fresh 保证 Rust 契约改动后前端生成类型同步更新，防止契约漂移。
precommit: fmt-check clippy test-lib test-web check-types-fresh

# ── 覆盖率 ────────────────────────────────────

# 生成覆盖率报告（lcov 格式，便于 CI/编辑器展示）。
# 前置：rustup component add llvm-tools-preview && cargo install cargo-llvm-cov
# 仅跑 --lib（不依赖数据库）；软目标：taiyin-core 行覆盖 ≥ 90%（2026-08-02 实测基线 96.8%）。
# 设计上不硬性 fail 构建，避免误伤正常改动；达标情况以报告为准。
coverage:
    {{cargo}} llvm-cov nextest --lib --lcov --output-path lcov.info

# ── 杂项 ──────────────────────────────────────

# 设置 git hooks（首次克隆仓库后运行一次）
# 唯一机制：git native hook + just。项目不再使用 python 的 pre-commit 框架。
setup-hooks:
    git config core.hooksPath .githooks
    @echo "✓ git hooks 已安装（.githooks/）；提交前会自动运行 just precommit"

# 显示本帮助
default:
    @just --list
