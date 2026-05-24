//! # taiyin-server
//!
//! 太音 · Axum 后端 API 服务。
//!
//! 负责社区曲谱管理、AI 简谱翻译转发、积分记账等业务逻辑。
//! MVP 阶段可以先不启动，前端直接调用 DeepSeek API。

use axum::{routing::get, Router};
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化日志（参考 RUST_LOG 环境变量）
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let app = Router::new()
        .route("/health", get(health_check))
        .layer(CorsLayer::permissive());

    let addr = "0.0.0.0:3001";
    tracing::info!("taiyin-server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// 健康检查端点。
async fn health_check() -> &'static str {
    "🪕 taiyin ok"
}
