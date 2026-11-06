//! 请求体上限的回归护栏。
//!
//! 背景（0.41 实测）：路由层写的是 `RequestBodyLimitLayer::new(5 MiB)`，但
//! `Json` 提取器读的是 axum 自己的 `DefaultBodyLimit`（默认 2 MiB），两者取小。
//! 结果是「配置写 5 MiB、实际只吃到 2 MiB」——一张 2.7 MiB 的手机截图被 413，
//! 而这正是识别端点的主要输入。这种「配置项存在但没生效」的错没有编译期提示，
//! 只能靠用例钉住。

mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use taiyin_server::{AppState, ServerConfig, app};
use tower::util::ServiceExt;

/// 发一个 `image_base64` 长度为 `payload_len` 的识别请求。
///
/// 内容是无意义的 base64（全 `A`）：解码能过、但不是图片，于是模板路径放弃、
/// LLM 未配置时回落到 503。测试只关心**它有没有被请求体上限挡在门外**。
async fn post_recognize_with_payload(payload_len: usize) -> StatusCode {
    let pool = common::test_pool().await;
    let state = AppState {
        pool,
        llm: Default::default(),
    };

    let body = serde_json::to_string(&json!({
        "image_base64": "A".repeat(payload_len),
        "media_type": "image/png"
    }))
    .unwrap();

    app(state, &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/jianzi/recognize")
                .header("content-type", "application/json")
                // 限流层用 SmartIpKeyExtractor，oneshot 没有连接信息，必须补代理头
                .header("x-forwarded-for", "127.0.0.1")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// 2.2 MiB 的 base64（约 1.6 MiB 原图）必须能进到 handler。
///
/// 修复前这里是 413——比 axum 的 2 MiB 默认值大、又比路由层写的 5 MiB 小，
/// 正好落在「配置说行、实际不行」的缝里。
#[tokio::test]
async fn accepts_payload_above_axum_default_limit() {
    let status = post_recognize_with_payload(2_200_000).await;
    assert_ne!(
        status,
        StatusCode::PAYLOAD_TOO_LARGE,
        "2.2 MiB 的身体不应再被请求体上限拒绝（实际上限应等于 MAX_BODY_BYTES）"
    );
    // 图片是假的、LLM 也没配：走到业务层就等于身体已经进来了。
    assert_eq!(
        status,
        StatusCode::SERVICE_UNAVAILABLE,
        "应落到「LLM 未配置」而不是被截断"
    );
}

/// 超过 5 MiB 仍然要拒绝——上限是放宽到 5 MiB，不是取消。
#[tokio::test]
async fn rejects_payload_above_limit() {
    let status = post_recognize_with_payload(6_000_000).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "超过 5 MiB 必须拒绝");
}
