#!/usr/bin/env bash
# CI 专用：装固定版本的 wasm-opt（binaryen v130），供 wasm-pack 使用。
#
# 为什么不用 wasm-pack 自带下载 / apt：
# - wasm-pack 自己从 GitHub Releases 拉 binaryen，2026-11-08 两次红掉流水线
#   （一次下载失败、一次 504 六连败）；
# - apt 的 binaryen 是 108（Ubuntu 24.04），旧 wasm-opt 会把 externref 表优化坏
#   （WebAssembly.Table.grow 失败 → wasm 起不来）。
#
# 策略：版本钉死 130（与 wasm-pack 默认一致）→
#   主路 GitHub Releases（curl 带重试）→ 失败兜底 npm registry（不同基础设施）。
# 缓存目录由 actions/cache 持久化（WASM_OPT_CACHE_DIR），成功一次后不再下载。
set -euo pipefail

VERSION="${WASM_OPT_VERSION:-130}"
CACHE_DIR="${WASM_OPT_CACHE_DIR:-$HOME/binaryen-v$VERSION}"
URL="https://github.com/WebAssembly/binaryen/releases/download/version_$VERSION/binaryen-version_$VERSION-x86_64-linux.tar.gz"

ok_version() {
  command -v wasm-opt >/dev/null 2>&1 && wasm-opt --version 2>/dev/null | grep -q "$VERSION"
}

if ok_version; then
  echo "wasm-opt $(wasm-opt --version) 已在 PATH，跳过安装"
  exit 0
fi

mkdir -p "$CACHE_DIR"
if [ ! -x "$CACHE_DIR/bin/wasm-opt" ]; then
  if curl -fsSL --retry 8 --retry-delay 5 --retry-max-time 300 --retry-all-errors \
      -o /tmp/binaryen.tar.gz "$URL"; then
    tar -xzf /tmp/binaryen.tar.gz -C /tmp
    rm -rf "$CACHE_DIR/bin"
    cp -r "/tmp/binaryen-version_$VERSION/bin" "$CACHE_DIR/"
  else
    echo "GitHub Releases 下载失败，兜底 npm registry（binaryen@$VERSION.0.0）" >&2
    npm install -g "binaryen@$VERSION.0.0"
    if ok_version; then
      echo "npm 版 wasm-opt 生效：$(wasm-opt --version)"
      exit 0
    fi
    echo "npm 兜底也没拿到 version $VERSION 的 wasm-opt" >&2
    exit 1
  fi
fi

sudo install "$CACHE_DIR/bin/wasm-opt" /usr/local/bin/wasm-opt
if ! ok_version; then
  echo "装好的 wasm-opt 版本不对：$(wasm-opt --version 2>&1 || true)" >&2
  exit 1
fi
echo "wasm-opt $(wasm-opt --version) 就绪（来源：$CACHE_DIR）"
