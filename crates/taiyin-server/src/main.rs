//! # taiyin-server
//!
//! 太音 · Axum 后端 API 服务。
//!
//! 负责社区曲谱管理、AI 简谱翻译转发、积分记账等业务逻辑。

use std::net::SocketAddr;
use std::sync::Arc;

use taiyin_server::{AppState, ServerConfig, app, db, llm::LlmConfig};
use tower_governor::{
    GovernorLayer, governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor,
};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = ServerConfig::from_env();

    if !config.cors_locked() {
        tracing::warn!(
            "ALLOWED_ORIGINS 未设置，CORS 处于放开状态（仅建议本地开发）。生产部署请设置该变量。"
        );
    }
    if config.translate_api_key.is_some() {
        tracing::info!("/translate/select 已启用 API-key 闸门（纵深防御）");
    }

    let pool = db::init_pool(&config.database_url).await?;

    // 全局限流：按客户端 IP 计（经反向代理时读取 X-Forwarded-For 等头，
    // 回退到 TCP peer IP）。use_headers 回写 x-ratelimit-* 头，便于前端感知。
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor)
            .per_second(config.global_per_second)
            .burst_size(config.global_burst)
            .use_headers()
            .finish()
            .expect("global rate config must be valid"),
    );

    let app = app(
        AppState {
            pool,
            llm: LlmConfig::from_env(),
        },
        &config,
    )
    .route_layer(GovernorLayer::new(governor_conf));

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(3001);
    let addr = format!("{host}:{port}");
    tracing::info!("taiyin-server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    // into_make_service_with_connect_info 注入 ConnectInfo，供 SmartIpKeyExtractor
    // 在缺少代理头时回退到真实 peer IP 进行限流。
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
