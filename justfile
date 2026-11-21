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

# 依赖安全审计（cargo audit）。
# 不可修的已知 advisory 在 .cargo/audit.toml 中豁免并附说明；
# 凡有修复版本的漏洞应通过 `cargo update -p <crate>` 升级，而非豁免。
# CI 中由 .github/workflows/build.yml 的 rustsec/audit-check 步骤强制跑。
audit:
    {{cargo}} audit

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
    node scripts/verify-wasm-fresh.mjs --write

# WASM 产物新鲜度：提交的 .wasm 必须与 Rust 源码同步。
# 产物是进 git 的，改了核心却忘了重建，本地跑真实 WASM 的测试会测旧逻辑而全绿。
verify-wasm-fresh:
    node scripts/verify-wasm-fresh.mjs

# 重建 web + 小程序探针的 WASM（一条命令闭环）。
# 只跑 build-wasm 会让探针停在旧二进制 —— 2026-11-08 就是这么漂移了四天。
rebuild-probe-wasm: build-wasm
    node apps/miniprogram-wasm-probe/scripts/build-worker.mjs

# 探针全部校验（七项：六项逻辑 + 真机前静态预检，含产物同源）
verify-probe:
    node apps/miniprogram-wasm-probe/scripts/verify-all.mjs

# 生成真机验证副本：真 AppID 只写进 /tmp，不进 git
probe-copy appid:
    node apps/miniprogram-wasm-probe/scripts/prepare-realdevice-copy.mjs --appid {{appid}}

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

# 真浏览器冒烟：实际渲染 + 实际视口 + 实际交互，断言「能用」而不只是「不报错」。
# 前置：另开终端跑 `just dev`（或在 SMOKE_URL 指定已部署地址）。
#
# 为什么需要：2026-11-18 那天 1390 条单测全绿、tsc/eslint 干净、next build 通过，
# 但用户打开页面说「感觉根本不能用」——jsdom 看不到真实布局、像素与触控。
# 这一条覆盖假字、sticky 叠压、栅格溢出、字号过小、触控目标过小、键盘被推太远。
smoke-browser:
    node scripts/smoke-browser.mjs

# 15 个薄客户端端点的**真服务**冒烟（不是 oneshot）：405 / 400 / 413 / 限流，
# 并把每个响应与 apps/web/wasm 的输出逐字节比对（证明「同一份逻辑」不是口号）。
#
# 前置：另开终端把服务跑起来——
#   cargo build -p taiyin-server && PORT=3001 ./target/debug/taiyin-server
# 用 SMOKE_BASE 指到别的地址：SMOKE_BASE=http://127.0.0.1:3101 just smoke-domain
#
# 为什么必须有这一条：oneshot 不经过 main() 里的全局限流、请求体上限、CORS，
# 路由层全绿只证明 handler 对，证明不了部署起来能用。首次跑就抓到
# rapid-parse 坏请求体回 200（其余端点 400）。
smoke-domain:
    node scripts/smoke-domain-http.mjs --base ${SMOKE_BASE:-http://127.0.0.1:3001}

# 定弦名单四份同源校验（纯 Node，不需要构建产物）；--self-test 跑 7 条变异
verify-tuning:
    node scripts/verify-tuning-contract.mjs --self-test && node scripts/verify-tuning-contract.mjs

# 时值码四处同源校验（纯 Node，只读）；--self-test 跑 8 条变异
verify-duration:
    node scripts/verify-duration-code-contract.mjs --self-test && node scripts/verify-duration-code-contract.mjs

# 领域常量契约（徽位音高 + 减字记号，20 项）；--self-test 跑 20 条变异
verify-domain:
    node scripts/verify-domain-contracts.mjs --self-test && node scripts/verify-domain-contracts.mjs

# 本机 Rust 覆盖率：**不能**用来判 CI 的 75% 闸门（macOS aarch64 分母更大，同代码显示 ~56%）。
# 只在要找「哪些行没跑到」时用；零命中文件在任何平台都成立，是真实缺口。
coverage-local:
    node scripts/coverage-local.mjs

# 所有静态契约闸门（与 CI 的 build.yml 保持一致；本地跑得到就等于提前发现）
verify-contracts: verify-tuning verify-duration verify-domain verify-wasm-fresh verify-audit-exemptions

# 依赖审计豁免表同源：.cargo/audit.toml ↔ build.yml 的 ignore: 必须完全相等
verify-audit-exemptions:
    node scripts/verify-audit-exemptions.mjs

# S2 可行性实测：真实 Chromium 里跑静态导出产物的同步 WASM 初始化（需先 pnpm build）
probe-wasm-sync:
    node scripts/probe-wasm-sync-browser.mjs

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

# 从 WangJiJianZiPuKaiTi 提取所有 SVG path（基准版本）
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
# audit 与 build.yml 的 rustsec/audit-check 保持一致：本地全量检查也跑依赖安全审计。
ci: fmt-check clippy test test-web check-types-fresh audit

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
