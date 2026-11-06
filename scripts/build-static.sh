#!/usr/bin/env bash
#
# 纯静态前端一键构建 —— GitHub Pages / Vercel / Netlify 等免费托管共用。
#
# 步骤：装 Rust 工具链（若缺失）→ 装 wasm-pack（若缺失）→ 编译 taiyin-core WASM
# → 拷进 apps/web → next build 静态导出到 apps/web/dist。
#
# 各平台接线方式：
#   仓库根部署（根 vercel.json / netlify.toml）：
#     buildCommand    = bash scripts/build-static.sh
#     outputDirectory = apps/web/dist
#   单项目导入 apps/web（apps/web/vercel.json，Vercel monorepo 推荐）：
#     buildCommand    = bash ../scripts/build-static.sh   （cwd 是 apps/web，往上一级才是仓库根）
#     outputDirectory = dist
#   三处共用：
#     installCommand  = pnpm install --frozen-lockfile --ignore-scripts
#     BASE_PATH       = ""  （根路径部署；GitHub Pages 子路径走 pages.yml，显式传 /taiyin-guqin）
#
# 脚本对「已装工具链」的幂等：cargo/wasm-pack 存在时跳过安装步骤。
set -euo pipefail

# 无论 Vercel / Netlify / 本地从哪个子目录调用，都先回到仓库根，
# 这样后面的相对路径（crates/taiyin-core、apps/web/wasm）始终成立。
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "== 准备 Rust 工具链 =="
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
  export PATH="$HOME/.cargo/bin:$PATH"
fi

echo "== 准备 wasm-pack =="
if ! command -v wasm-pack >/dev/null 2>&1; then
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
  export PATH="$HOME/.cargo/bin:$HOME/.wasm-pack/bin:$PATH"
fi

echo "== 编译 WASM (taiyin-core) =="
( cd crates/taiyin-core && wasm-pack build --target web )

echo "== 拷 WASM 进前端 =="
rm -rf apps/web/wasm apps/web/public/wasm
cp -r crates/taiyin-core/pkg apps/web/wasm
cp -r crates/taiyin-core/pkg apps/web/public/wasm

echo "== 构建静态站 =="
( cd apps/web && pnpm --filter web build )

echo "== 完成：产物在 apps/web/dist =="
