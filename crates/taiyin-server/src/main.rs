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
    // 限流 0 会让 governor 的 finish() 返回 None，进而以一句含糊的 panic 失败。
    // 先在这里说清是哪个变量、想关闸该用什么，再往下走。
    config
        .validate_rate_limits()
        .map_err(|e| anyhow::anyhow!(e))?;

    if !config.cors_locked() {
        tracing::warn!(
            "ALLOWED_ORIGINS 未设置，CORS 处于放开状态（仅建议本地开发）。生产部署请设置该变量。"
        );
    }
    if config.translate_api_key.is_some() {
        tracing::info!("/translate/select 已启用 API-key 闸门（纵深防御）");
    }
    // 配额 0 = 发布入口关闭。这可能是应急时的**故意**操作，但更可能是手滑，
    // 所以要在启动日志里喊出来——否则「社区突然谁都不能存谱」会被当成故障查半天。
    if config.publish_quota_per_account == 0 || config.publish_quota_per_device == 0 {
        tracing::warn!(
            account = config.publish_quota_per_account,
            device = config.publish_quota_per_device,
            "发布配额为 0：对应身份将**完全无法保存 / 发布曲谱**（若非有意，请检查 PUBLISH_QUOTA_* 环境变量）"
        );
    } else {
        tracing::info!(
            account = config.publish_quota_per_account,
            device = config.publish_quota_per_device,
            "发布配额已启用"
        );
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
    //
    // with_graceful_shutdown：收到 SIGTERM（容器 stop / 滚动更新）或 Ctrl-C 后，
    // 停止 accept 新连接、等 in-flight 请求跑完再退出。没有它，滚动发布时正在
    // 保存曲谱的用户会撞上「网络错误」。drain 不设上限：由部署层的停止超时兜底
    // （`docker stop` 默认 10 s 后 SIGKILL），服务自身不跟部署策略抢定义权。
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

/// 等待停机信号：SIGTERM（容器编排器）或 Ctrl-C（本地开发）。
///
/// 只在 Unix 上装 SIGTERM 处理器；其他平台用永不完成的 future 占位，
/// 让 `select!` 仍可编译，行为退化为只认 Ctrl-C。
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received: draining in-flight requests");
}
