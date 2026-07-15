mod common;

use axum::{body::Body, http::Request};
use serde_json::{Value, json};
use taiyin_server::{AppState, app};
use tower::util::ServiceExt;

#[tokio::test]
async fn select_without_api_key_falls_back_to_heuristic() {
    let pool = common::test_pool().await;
    let state = AppState {
        pool,
        llm: Default::default(),
    };

    let body = serde_json::to_string(&json!({
        "notes": [{"number": 5, "octave": 0}, {"number": 6, "octave": 0}],
        "tuning": "zheng"
    }))
    .unwrap();

    let resp = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/translate/select")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(json["method"], "heuristic");
    let sels = json["selections"].as_array().unwrap();
    assert_eq!(sels.len(), 2);
    assert!(sels.iter().all(|s| s["candidate_index"] == 0));
}

#[tokio::test]
async fn select_rejects_invalid_body() {
    let pool = common::test_pool().await;
    let state = AppState {
        pool,
        llm: Default::default(),
    };

    let resp = app(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/translate/select")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), 422);
}
