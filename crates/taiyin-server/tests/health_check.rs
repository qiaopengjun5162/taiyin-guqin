use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use taiyin_server::app;
use tower::ServiceExt;

#[tokio::test]
async fn health_check_returns_ok() {
    let app = app();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
