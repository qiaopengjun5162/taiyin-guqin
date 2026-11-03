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

/// 用指定配置构建 app：测限流要能把阈值压到很小，default 的阈值会把用例拖慢。
fn router_with(pool: PgPool, config: &ServerConfig) -> Router {
    app(
        AppState {
            pool,
            llm: Default::default(),
        },
        config,
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
    // 限流按客户端 IP 计数，而 `oneshot` 没有真实连接、拿不到 peer 地址，
    // 提取失败会让限流层直接回 500（"Unable To Extract Key"）。
    // 真实部署经反向代理时也是靠这个头识别来源，这里补上等价于「模拟反代后的请求」。
    // 用 TEST-NET-3 段（203.0.113.0/24，专供文档示例）而不是环回地址，
    // 避免与「本机直连」的语义混淆。
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-forwarded-for", "203.0.113.7");
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

/// 认证端点必须有**独立于全局**的限流。
///
/// 这不是「防刷」而是「防 CPU 放大器」：口令散列是故意慢的（Argon2id 每次数百毫秒），
/// 一个不限流的注册 / 登录接口等于给攻击者一个把单核打满的开关——正常请求几十毫秒，
/// 这个接口几百毫秒，同一份带宽能造成的伤害差三个数量级。
///
/// 把全局限流放到几乎不生效（1000/s），仍然能在认证端点上看到 429，
/// 才能证明**认证自己带锁**，而不是被全局顺带挡住。
#[tokio::test]
async fn auth_endpoints_rate_limited_independently_of_global() {
    let pool = common::test_pool().await;

    let config = ServerConfig {
        // 全局放到几乎不生效，才能证明「认证自己带锁」而不是被全局顺带挡住
        global_per_second: 1000,
        global_burst: 1000,
        auth_per_second: 1,
        auth_burst: 2,
        ..Default::default()
    };

    // 关键：复用**同一个** router。每次新建 app 都会新建限流器、计数归零，
    // 那样无论发多少次都不会 429，测试会假绿。
    let app = router_with(pool, &config);
    let body = json!({"email": "nobody@example.com", "password": "whatever-123"}).to_string();

    let mut codes = Vec::new();
    for _ in 0..6 {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .header("x-forwarded-for", "198.51.100.9")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        codes.push(resp.status());
    }

    // 前半句：第一次必须真的打到了处理器。否则「被限流」可能只是路由或提取 key 出了错，
    // 那种情况下每个请求都 500/404，断言「出现 429」则会因为别的原因失败得莫名其妙。
    assert_ne!(
        codes[0],
        StatusCode::TOO_MANY_REQUESTS,
        "第一次请求不该被限流：{codes:?}"
    );
    assert_eq!(
        codes[0],
        StatusCode::UNAUTHORIZED,
        "第一次登录应当真的走到处理器（账号不存在 → 401）：{codes:?}"
    );
    // 后半句：持续请求必须被挡住。
    assert!(
        codes.contains(&StatusCode::TOO_MANY_REQUESTS),
        "认证端点应当在若干次后被限流，实际：{codes:?}"
    );
}

/// `/auth/me` 不受认证限流约束。
///
/// 它是前端每次打开页面校验登录态要走的接口，被限流会被误当成「会话失效」而登出用户。
/// 只读、无散列开销，没有理由和登录共用一把锁。
#[tokio::test]
async fn me_endpoint_is_not_throttled_with_login() {
    let pool = common::test_pool().await;

    let config = ServerConfig {
        global_per_second: 1000,
        global_burst: 1000,
        auth_per_second: 1,
        auth_burst: 1,
        ..Default::default()
    };

    let app = router_with(pool, &config);

    // 先把登录那把锁打满
    let body = json!({"email": "nobody@example.com", "password": "whatever-123"}).to_string();
    for _ in 0..4 {
        let _ = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/login")
                    .header("content-type", "application/json")
                    .header("x-forwarded-for", "198.51.100.10")
                    .body(Body::from(body.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
    }

    // 同一来源查 /me：应当是 401（未带 token），不是 429
    let resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/auth/me")
                .header("x-forwarded-for", "198.51.100.10")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "/auth/me 不该与登录共用限流，否则登录态会被误判为失效"
    );
}
