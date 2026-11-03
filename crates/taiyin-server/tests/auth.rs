//! 账号体系与「认领旧谱」的端到端测试（连真实 Postgres）。
//!
//! 这里测的不是「注册能不能成功」，而是**所有权这条线有没有接错**：
//! 接错的后果是「别人登录一下就能改你的谱」，或者「你换了设备就再也改不了自己的谱」——
//! 两者都不会报错，只会让人莫名其妙地丢东西。

mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use taiyin_server::{AppState, ServerConfig, app};
use tower::util::ServiceExt;
use uuid::Uuid;

fn router(pool: PgPool) -> Router {
    app(
        AppState {
            pool,
            llm: Default::default(),
        },
        &ServerConfig::default(),
    )
}

/// 发一个请求。`bearer` 模拟登录态，`owner` 模拟本机凭证，两者都能省略。
async fn send(
    pool: &PgPool,
    method: &str,
    uri: &str,
    body: Option<Value>,
    bearer: Option<&str>,
    owner: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(t) = bearer {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
    if let Some(o) = owner {
        builder = builder.header("x-owner-token", o);
    }
    let payload = body.map(|v| v.to_string()).unwrap_or_default();

    let resp = router(pool.clone())
        .oneshot(builder.body(Body::from(payload)).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

/// 每个用例用独立邮箱，测试并行跑也不会互相撞唯一索引。
fn unique_email() -> String {
    format!("qin-{}@example.com", Uuid::new_v4())
}

async fn register(pool: &PgPool, email: &str, password: &str) -> (StatusCode, Value) {
    send(
        pool,
        "POST",
        "/api/v1/auth/register",
        Some(json!({"email": email, "password": password, "display_name": "琴友"})),
        None,
        None,
    )
    .await
}

/// 注册并拿到会话 token。
async fn register_token(pool: &PgPool, password: &str) -> (String, String) {
    let email = unique_email();
    let (status, body) = register(pool, &email, password).await;
    assert_eq!(status, StatusCode::OK, "注册应成功：{body}");
    (
        email,
        body["token"].as_str().expect("应返回 token").to_string(),
    )
}

#[tokio::test]
async fn register_then_me_then_logout() {
    let pool = common::test_pool().await;
    let (email, token) = register_token(&pool, "qin-you-2026").await;

    let (status, me) = send(&pool, "GET", "/api/v1/auth/me", None, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["email"], email);
    assert!(
        me.get("password_hash").is_none(),
        "绝不能把口令散列下发：{me}"
    );

    // 登出后立刻失效：会话存库而非自证，正是为了能这样吊销
    let (status, _) = send(
        &pool,
        "POST",
        "/api/v1/auth/logout",
        None,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send(&pool, "GET", "/api/v1/auth/me", None, Some(&token), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(&email)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn duplicate_email_is_rejected() {
    let pool = common::test_pool().await;
    let email = unique_email();
    let (status, _) = register(&pool, &email, "qin-you-2026").await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = register(&pool, &email, "another-password").await;
    assert_eq!(status, StatusCode::CONFLICT, "重复邮箱应 409：{body}");

    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(&email)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn login_failure_does_not_leak_which_part_is_wrong() {
    let pool = common::test_pool().await;
    let (email, _) = register_token(&pool, "qin-you-2026").await;

    // 口令错
    let (status, body) = send(
        &pool,
        "POST",
        "/api/v1/auth/login",
        Some(json!({"email": email, "password": "wrong-password"})),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let wrong_password_msg = body["error"].as_str().unwrap_or_default().to_string();

    // 邮箱不存在：必须是同一句话，否则等于帮人枚举账号
    let (status, body) = send(
        &pool,
        "POST",
        "/api/v1/auth/login",
        Some(json!({"email": "nobody@example.com", "password": "whatever-password"})),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        body["error"].as_str().unwrap_or_default(),
        wrong_password_msg
    );

    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(&email)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn short_password_is_rejected() {
    let pool = common::test_pool().await;
    let (status, _) = register(&pool, &unique_email(), "1234").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn logged_in_user_can_edit_from_another_device() {
    let pool = common::test_pool().await;
    let (email, token) = register_token(&pool, "qin-you-2026").await;

    // 登录态发布：不携带 x-owner-token，也应自动归属到账号
    let (status, created) = send(
        &pool,
        "POST",
        "/api/v1/scores",
        Some(json!({"title": "账号发布的谱", "notes": []})),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    assert!(
        created["owner_user_id"].is_string(),
        "登录发布必须记下归属账号：{created}"
    );
    let id = created["id"].as_str().unwrap().to_string();

    // 换设备：只带登录态、不带本机凭证，依然能改
    let (status, body) = send(
        &pool,
        "PUT",
        &format!("/api/v1/scores/{id}"),
        Some(json!({"title": "换设备后改的标题"})),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "换设备后应仍能改：{body}");

    sqlx::query("DELETE FROM scores WHERE id = $1")
        .bind(Uuid::parse_str(&id).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(&email)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn legacy_owner_token_path_still_works() {
    let pool = common::test_pool().await;

    // 完全不注册，纯本机凭证这条老路径不能被动到
    let (status, created) = send(
        &pool,
        "POST",
        "/api/v1/scores",
        Some(json!({"title": "老路径发布的谱", "notes": []})),
        None,
        Some("legacy-token"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let id = created["id"].as_str().unwrap().to_string();

    let (status, body) = send(
        &pool,
        "PUT",
        &format!("/api/v1/scores/{id}"),
        Some(json!({"title": "老路径改的标题"})),
        None,
        Some("legacy-token"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "老凭证路径必须照旧可用：{body}");

    let (status, _) = send(
        &pool,
        "PUT",
        &format!("/api/v1/scores/{id}"),
        Some(json!({"title": "别人的标题"})),
        None,
        Some("someone-else"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    sqlx::query("DELETE FROM scores WHERE id = $1")
        .bind(Uuid::parse_str(&id).unwrap())
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn claim_binds_old_score_to_account() {
    let pool = common::test_pool().await;

    // 1) 以前没账号，用本机凭证发过一首谱
    let (status, created) = send(
        &pool,
        "POST",
        "/api/v1/scores",
        Some(json!({"title": "待认领的旧谱", "notes": []})),
        None,
        Some("device-token-1"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let id = created["id"].as_str().unwrap().to_string();

    // 2) 现在注册了，但还没认领 —— 光登录不能改别人的（哪怕其实是自己发的）
    let (email, token) = register_token(&pool, "qin-you-2026").await;
    let (status, _) = send(
        &pool,
        "PUT",
        &format!("/api/v1/scores/{id}"),
        Some(json!({"title": "登录了就想改"})),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "未认领前不该能改");

    // 3) 出示原凭证认领
    let (status, claimed) = send(
        &pool,
        "POST",
        &format!("/api/v1/scores/{id}/claim"),
        None,
        Some(&token),
        Some("device-token-1"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{claimed}");
    assert!(claimed["owner_user_id"].is_string(), "认领后应归属账号");

    // 4) 认领之后：不再需要本机凭证，换设备也能改
    let (status, body) = send(
        &pool,
        "PUT",
        &format!("/api/v1/scores/{id}"),
        Some(json!({"title": "认领后换设备改的"})),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "认领后应能凭登录态改：{body}");

    sqlx::query("DELETE FROM scores WHERE id = $1")
        .bind(Uuid::parse_str(&id).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(&email)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn claim_requires_both_login_and_original_token() {
    let pool = common::test_pool().await;
    let (email, token) = register_token(&pool, "qin-you-2026").await;

    let (status, created) = send(
        &pool,
        "POST",
        "/api/v1/scores",
        Some(json!({"title": "别人的谱", "notes": []})),
        None,
        Some("their-token"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let id = created["id"].as_str().unwrap().to_string();

    // 登录了，但拿不出原凭证 → 不能认领（否则注册一下就能把别人的谱认领走）
    let (status, _) = send(
        &pool,
        "POST",
        &format!("/api/v1/scores/{id}/claim"),
        None,
        Some(&token),
        Some("wrong-token"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // 有原凭证，但没登录 → 也不行（认领要挂到具体账号下）
    let (status, _) = send(
        &pool,
        "POST",
        &format!("/api/v1/scores/{id}/claim"),
        None,
        None,
        Some("their-token"),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    sqlx::query("DELETE FROM scores WHERE id = $1")
        .bind(Uuid::parse_str(&id).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(&email)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn another_account_cannot_edit_claimed_score() {
    let pool = common::test_pool().await;
    let (email_a, token_a) = register_token(&pool, "qin-you-2026").await;
    let (email_b, token_b) = register_token(&pool, "qin-you-2026").await;

    let (status, created) = send(
        &pool,
        "POST",
        "/api/v1/scores",
        Some(json!({"title": "A 的谱", "notes": []})),
        Some(&token_a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let id = created["id"].as_str().unwrap().to_string();

    let (status, body) = send(
        &pool,
        "PUT",
        &format!("/api/v1/scores/{id}"),
        Some(json!({"title": "B 想改"})),
        Some(&token_b),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "别人的账号不该能改：{body}");

    let (status, _) = send(
        &pool,
        "DELETE",
        &format!("/api/v1/scores/{id}"),
        None,
        Some(&token_b),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "别人的账号不该能删");

    sqlx::query("DELETE FROM scores WHERE id = $1")
        .bind(Uuid::parse_str(&id).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    for email in [email_a, email_b] {
        sqlx::query("DELETE FROM users WHERE email = $1")
            .bind(&email)
            .execute(&pool)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn expired_session_is_treated_as_logged_out() {
    let pool = common::test_pool().await;
    let (email, token) = register_token(&pool, "qin-you-2026").await;

    let (status, _) = send(&pool, "GET", "/api/v1/auth/me", None, Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);

    // 把会话手动过期：过期会话必须等同于未登录，而不是仍能操作
    sqlx::query("UPDATE sessions SET expires_at = now() - interval '1 day' WHERE token = $1")
        .bind(&token)
        .execute(&pool)
        .await
        .unwrap();

    let (status, _) = send(&pool, "GET", "/api/v1/auth/me", None, Some(&token), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(&email)
        .execute(&pool)
        .await
        .unwrap();
}
