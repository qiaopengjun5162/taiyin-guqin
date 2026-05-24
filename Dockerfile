# ────────────────────────────────────────────
# 太音 · Rust 后端构建与运行镜像
# ────────────────────────────────────────────

# -- 构建阶段 --
FROM rust:1.85-slim-bookworm AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/

RUN cargo build --package taiyin-server --release --all-features

# -- 运行阶段 --
FROM gcr.io/distroless/cc-debian12:latest

COPY --from=builder /app/target/release/taiyin-server /usr/local/bin/taiyin-server

EXPOSE 3001

CMD ["taiyin-server"]
