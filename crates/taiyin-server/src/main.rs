//! # taiyin-server
//!
//! 太音 · Axum 后端 API 服务。
//!
//! 负责社区曲谱管理、AI 简谱翻译转发、积分记账等业务逻辑。

use taiyin_server::app;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let app = app();

    let addr = "0.0.0.0:3001";
    tracing::info!("taiyin-server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
