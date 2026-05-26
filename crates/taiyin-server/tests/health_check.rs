mod common;

use axum::{body::Body, http::Request};
use taiyin_server::{AppState, app};
use tower::util::ServiceExt;

#[tokio::test]
async fn health_check_returns_ok() {
    let pool = common::test_pool().await;
    let app = app(AppState { pool });
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
}
