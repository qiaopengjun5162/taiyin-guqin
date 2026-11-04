//! 管理端「重置口令」（过渡版找回）的端到端测试（连真实 Postgres）。
//!
//! 要钉住的是三条**不会报错、只会悄悄失效**的规矩：
//!
//! 1. 改密必须踢掉该用户**全部**会话——不踢的话，偷到旧 token 的人照样能进，
//!    「重置」就只是给本人添堵；
//! 2. 管理端没配口令时这个接口是关着的（503），不是「谁都能改谁的口令」；
//! 3. 服务端生成的一次性口令必须**真的能登录**——生成出来登不进去，
//!    比没有这个功能更糟（管理员以为办完了，用户还是进不来）。

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

const ADMIN: &str = "test-admin-reset-token";

fn admin_config() -> ServerConfig {
    ServerConfig {
        admin_token: Some(ADMIN.into()),
        // 一个用例要连发注册 / 登录 / 重置好几个请求，别让限流先挡住，
        // 否则测的就不是重置逻辑而是限流逻辑了。
        write_per_second: 1000,
        write_burst: 200,
        auth_per_second: 1000,
        auth_burst: 200,
        global_per_second: 1000,
        global_burst: 400,
        ..ServerConfig::default()
    }
}

fn router(pool: PgPool, config: &ServerConfig) -> Router {
    app(
        AppState {
            pool,
            llm: Default::default(),
        },
        config,
    )
}

/// 发一个请求。`admin` 传管理口令；与 bearer / owner 分开，避免把「哪种身份」写死。
async fn send(
    router: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    bearer: Option<&str>,
    admin: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        // 限流按客户端 IP 计数，oneshot 拿不到 peer 地址，补 x-forwarded-for
        // 等价于「模拟反代后的请求」（见 auth.rs 里的说明）。
        .header("x-forwarded-for", "203.0.113.42");
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(t) = bearer {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
    if let Some(t) = admin {
        builder = builder.header("x-admin-token", t);
    }
    let payload = body.map(|v| v.to_string()).unwrap_or_default();

    let resp = router
        .clone()
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

fn unique_email() -> String {
    format!("reset-{}@example.com", Uuid::new_v4())
}

/// 注册即登录：返回 token。
async fn register(router: &Router, email: &str, password: &str) -> String {
    let (status, body) = send(
        router,
        "POST",
        "/api/v1/auth/register",
        Some(json!({"email": email, "password": password})),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "注册应成功：{body}");
    body["token"]
        .as_str()
        .expect("注册响应带 token")
        .to_string()
}

/// 登录并断言状态码，返回 token（仅成功时有值）。
async fn login(router: &Router, email: &str, password: &str, expect: StatusCode) -> Option<String> {
    let (status, body) = send(
        router,
        "POST",
        "/api/v1/auth/login",
        Some(json!({"email": email, "password": password})),
        None,
        None,
    )
    .await;
    assert_eq!(
        status, expect,
        "登录 {email} 期望 {expect}，实际 {status}：{body}"
    );
    body["token"].as_str().map(String::from)
}

#[tokio::test]
async fn admin_endpoint_closed_when_token_not_configured() {
    let pool = common::test_pool().await;
    let email = unique_email();
    // 没配 ADMIN_TOKEN 的机器：接口整个是关的（503），且报错要说人话。
    let closed = router(pool.clone(), &ServerConfig::default());
    let (status, body) = send(
        &closed,
        "POST",
        "/api/v1/admin/users/reset-password",
        Some(json!({"email": email, "new_password": "whatever-1234"})),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert!(
        body["error"]
            .as_str()
            .unwrap_or_default()
            .contains("ADMIN_TOKEN"),
        "未配置时要直说缺什么，而不是含糊的 Not found：{body}"
    );
}

#[tokio::test]
async fn wrong_admin_token_is_rejected() {
    let pool = common::test_pool().await;
    let r = router(pool, &admin_config());
    let (status, _) = send(
        &r,
        "POST",
        "/api/v1/admin/users/reset-password",
        Some(json!({"email": unique_email(), "new_password": "whatever-1234"})),
        None,
        Some("not-the-admin-token"),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// 核心场景：管理员指定新口令 → 旧口令作废、旧会话全踢、新口令能进。
#[tokio::test]
async fn reset_with_new_password_kills_old_password_and_sessions() {
    let pool = common::test_pool().await;
    let r = router(pool.clone(), &admin_config());
    let email = unique_email();

    let token_old = register(&r, &email, "old-pass-1234").await;
    // 第二个会话：踢会话必须是「全部」，只踢一个等于没踢。
    let token_old2 = login(&r, &email, "old-pass-1234", StatusCode::OK)
        .await
        .unwrap();

    let (status, body) = send(
        &r,
        "POST",
        "/api/v1/admin/users/reset-password",
        Some(json!({"email": email, "new_password": "brand-new-5678"})),
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // 管理员自己给的口令不回显（回显等于又抄一份明文）
    assert_eq!(body["temporary"], json!(false), "{body}");
    assert!(
        body["temporary_password"].is_null(),
        "管理员指定的口令不该回显：{body}"
    );

    // 旧口令登不进
    assert!(
        login(&r, &email, "old-pass-1234", StatusCode::UNAUTHORIZED)
            .await
            .is_none()
    );
    // 新口令能进
    assert!(
        login(&r, &email, "brand-new-5678", StatusCode::OK)
            .await
            .is_some()
    );

    // 两个旧会话都必须死——「改密即踢下线」，不然重置白做
    for (label, dead) in [("会话一", &token_old), ("会话二", &token_old2)] {
        let (status, body) = send(&r, "GET", "/api/v1/auth/me", None, Some(dead), None).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{label} 在重置后还活着：{body}"
        );
    }
}

/// 服务端生成的一次性口令：只回显一次、真的能登、旧会话同样作废。
#[tokio::test]
async fn generated_temporary_password_is_usable_and_revokes_sessions() {
    let pool = common::test_pool().await;
    let r = router(pool.clone(), &admin_config());
    let email = unique_email();

    let token_old = register(&r, &email, "old-pass-1234").await;

    let (status, body) = send(
        &r,
        "POST",
        "/api/v1/admin/users/reset-password",
        Some(json!({"email": email})),
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["temporary"], json!(true), "{body}");
    let temp = body["temporary_password"]
        .as_str()
        .expect("生成模式必须回显一次性口令")
        .to_string();
    assert!(
        temp.chars().count() >= 8,
        "一次性口令太短，过不了登录长度规则：{temp}"
    );

    // 旧口令作废
    assert!(
        login(&r, &email, "old-pass-1234", StatusCode::UNAUTHORIZED)
            .await
            .is_none()
    );
    // 一次性口令真的能登——这是「生成出来登不进去」的防线
    assert!(login(&r, &email, &temp, StatusCode::OK).await.is_some());
    // 旧会话同样被踢
    let (status, _) = send(&r, "GET", "/api/v1/auth/me", None, Some(&token_old), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unknown_email_is_not_found() {
    let pool = common::test_pool().await;
    let r = router(pool, &admin_config());
    let (status, body) = send(
        &r,
        "POST",
        "/api/v1/admin/users/reset-password",
        Some(json!({"email": unique_email(), "new_password": "whatever-1234"})),
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
}

/// 新口令太短要当场拒绝，且**不能**把旧口令弄失效——半途失败最怕改了一半。
#[tokio::test]
async fn short_new_password_is_rejected_and_old_password_survives() {
    let pool = common::test_pool().await;
    let r = router(pool.clone(), &admin_config());
    let email = unique_email();
    register(&r, &email, "old-pass-1234").await;

    let (status, body) = send(
        &r,
        "POST",
        "/api/v1/admin/users/reset-password",
        Some(json!({"email": email, "new_password": "short"})),
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    // 校验没过 → 口令没动、会话没踢，一切照旧
    assert!(
        login(&r, &email, "old-pass-1234", StatusCode::OK)
            .await
            .is_some()
    );
}
