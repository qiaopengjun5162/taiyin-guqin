//! 可选的 API-key 闸门（纵深防御中间件）。
//!
//! ## 为什么是"纵深防御"而非真正的鉴权
//!
//! `/translate/select` 是公开前端（浏览器）直接调用的 LLM 代理端点，
//! 它使用**服务端**的 `ANTHROPIC_API_KEY`。真正的用户级鉴权需要账号体系，
//! 而浏览器直连意味着任何 key 都会出现在前端 JS 包中，无法保密。
//!
//! 因此本闸门的价值在于：在配置了 `TRANSLATE_API_KEY` 后，要求客户端携带
//! `Authorization: Bearer <key>` 或 `x-api-key: <key>`，
//! 从而阻止**跨站脚本调用**与**自动化爬取/刷量**。它不能替代限流，
//! 也不能当作机密——仅作为纵深防御的一环。

use axum::{
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::sync::Arc;

/// API-key 闸门中间件。
///
/// - `expected = None`：闸门禁用，直接放行（默认行为，不破坏现有部署）。
/// - `expected = Some(key)`：要求 `Authorization: Bearer <key>` 或 `x-api-key: <key>`，
///   否则返回 `401 Unauthorized`。
pub async fn require_api_key(
    State(expected): State<Option<Arc<str>>>,
    req: Request,
    next: Next,
) -> Response {
    let authorized = match expected {
        None => true,
        Some(key) => {
            let via_auth = req
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v == format!("Bearer {key}"));
            let via_x = req
                .headers()
                .get("x-api-key")
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v == key.as_ref());
            via_auth || via_x
        }
    };

    if authorized {
        next.run(req).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"error":"missing or invalid API key"}"#,
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, middleware, routing::get};
    use tower::ServiceExt;

    async fn ok() -> &'static str {
        "ok"
    }

    fn app_with(key: Option<Arc<str>>) -> axum::Router {
        axum::Router::new()
            .route("/x", get(ok))
            .route_layer(middleware::from_fn_with_state(key, require_api_key))
    }

    #[tokio::test]
    async fn rejects_without_key_when_configured() {
        let resp = app_with(Some(Arc::from("secret")))
            .oneshot(Request::builder().uri("/x").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn accepts_with_x_api_key() {
        let resp = app_with(Some(Arc::from("secret")))
            .oneshot(
                Request::builder()
                    .uri("/x")
                    .header("x-api-key", "secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn accepts_with_bearer() {
        let resp = app_with(Some(Arc::from("secret")))
            .oneshot(
                Request::builder()
                    .uri("/x")
                    .header("authorization", "Bearer secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn open_when_unconfigured() {
        let resp = app_with(None)
            .oneshot(Request::builder().uri("/x").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
