# ────────────────────────────────────────────
# 太音 · Rust 后端构建与运行镜像
# ────────────────────────────────────────────

# -- 构建阶段 --
# 版本与 CI 的 stable 对齐（构建镜像与 CI 不应各用各的编译器）；MSRV 是 1.88。
FROM rust:1.99-slim-bookworm AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/

# --locked：锁文件缺失或需要改写就直接失败，而不是「顺手升一下依赖」——
# 构建必须可复现，否则同一份代码今天和下周打出不同的镜像。
RUN cargo build --package taiyin-server --release --all-features --locked

# -- 运行阶段 --
# distroless + nonroot：无 shell、无包管理器，以 uid 65532 运行。
# 容器逃逸的代价从「一个 root 进程」降到「一个非 root 进程」。
# 没写 HEALTHCHECK：distroless 里没有 shell 也没有 curl，写了永远失败；
# 健康检查交给编排层的 HTTP 探针（GET /health，见 routes.rs）。
FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=builder /app/target/release/taiyin-server /usr/local/bin/taiyin-server

EXPOSE 3001

# 绝对路径 + exec 形式：不经过 shell，SIGTERM 能直达进程，优雅停机才会生效
# （shell 形式下 PID 1 是 sh，SIGTERM 到不了 taiyin-server，graceful shutdown 永不触发）。
CMD ["/usr/local/bin/taiyin-server"]
