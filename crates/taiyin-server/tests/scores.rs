mod common;

use axum::{body::Body, http::Request};
use serde_json::{Value, json};
use taiyin_server::{AppState, app};
use tower::util::ServiceExt;

#[tokio::test]
async fn test_create_and_list_scores() {
    let pool = common::test_pool().await;
    sqlx::query("DELETE FROM scores")
        .execute(&pool)
        .await
        .unwrap();

    let state = AppState {
        pool: pool.clone(),
        llm: Default::default(),
    };
    let notes = json!([{"id": "1", "toneType": "散", "rightAction": "勾", "stringNumber": "五"}]);
    let body_str = serde_json::to_string(&json!({"title": "练习曲", "notes": notes})).unwrap();

    let resp = app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/scores")
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let resp = app(state)
        .oneshot(
            Request::builder()
                .uri("/api/v1/scores")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let items: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(
        items
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["title"] == "练习曲")
    );
}

#[tokio::test]
async fn test_create_get_update_delete() {
    let pool = common::test_pool().await;
    sqlx::query("DELETE FROM scores")
        .execute(&pool)
        .await
        .unwrap();
    let state = AppState {
        pool: pool.clone(),
        llm: Default::default(),
    };

    // 创建
    let body_str = serde_json::to_string(&json!({
        "title": "待修改",
        "notes": [{"id": "a", "toneType": "泛"}]
    }))
    .unwrap();
    let resp = app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/scores")
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let created: Value = serde_json::from_slice(&body_bytes).unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    // 获取单个
    let resp = app(state.clone())
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // 更新
    let body_str = serde_json::to_string(&json!({
        "title": "已修改",
        "notes": [{"id": "a", "toneType": "按"}]
    }))
    .unwrap();
    let resp = app(state.clone())
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/v1/scores/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // 验证更新
    let resp = app(state.clone())
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let updated: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(updated["title"], "已修改");

    // 删除
    let resp = app(state.clone())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // 确认删除
    let resp = app(state)
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}
