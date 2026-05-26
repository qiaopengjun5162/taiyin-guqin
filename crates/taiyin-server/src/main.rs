//! # taiyin-server
//!
//! 太音 · Axum 后端 API 服务。
//!
//! 负责社区曲谱管理、AI 简谱翻译转发、积分记账等业务逻辑。

use taiyin_server::{AppState, app, db};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://taiyin:taiyin_dev@localhost:5432/taiyin".into());

    let pool = db::init_pool(&database_url).await?;

    let app = app(AppState { pool });

    let addr = "0.0.0.0:3001";
    tracing::info!("taiyin-server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
