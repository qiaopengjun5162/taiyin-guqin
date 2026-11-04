//! 自助找回口令（邮件令牌）的端到端测试（连真实 Postgres）。
//!
//! 要钉住的是四条**不会报错、只会悄悄失效**的规矩：
//!
//! 1. 找回接口不得泄露「这个邮箱是否注册过」——响应必须一模一样，
//!    否则它就成了批量探测注册用户的工具；
//! 2. 改密必须踢掉该用户**全部**会话——不踢的话，偷到旧 token 的人照样能进；
//! 3. 令牌**一次有效**——邮件可能被转发 / 同步给旁人，链接能反复改口令就是个洞；
//! 4. 令牌未消费（口令太短被拒）时不得作废——用户改个口令重来即可，
//!    不该逼他重新收一遍信。

mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use taiyin_server::accounts::hash_reset_token;
use taiyin_server::mailer::{CaptureHandle, Mailer, OutgoingMail};
use taiyin_server::{AppState, ServerConfig, app};
use tower::util::ServiceExt;
use uuid::Uuid;

/// 测试配置：放宽限流（一个用例连发好几个请求，别让限流先挡住），
/// 发信走捕获后端（默认后端虽也不真发信，但没法断言「发了什么」）。
fn capture_config(mailer: Mailer) -> ServerConfig {
    ServerConfig {
        mailer,
        app_base_url: "https://test.example/taiyin".into(),
        write_per_second: 1000,
        write_burst: 200,
        auth_per_second: 1000,
        auth_burst: 200,
        global_per_second: 1000,
        global_burst: 400,
        ..ServerConfig::default()
    }
}

/// 「捕获发信」的路由 + 取信句柄。
fn capture_router(pool: PgPool) -> (Router, CaptureHandle) {
    let (mailer, handle) = Mailer::capture();
    let config = capture_config(mailer);
    let router = app(
        AppState {
            pool,
            llm: Default::default(),
        },
        &config,
    );
    (router, handle)
}

async fn send(
    router: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    bearer: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        // 限流按客户端 IP 计数，oneshot 拿不到 peer 地址，补 x-forwarded-for
        // 等价于「模拟反代后的请求」。
        .header("x-forwarded-for", "203.0.113.42");
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(t) = bearer {
        builder = builder.header("authorization", format!("Bearer {t}"));
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
    format!("pwreset-{}@example.com", Uuid::new_v4())
}

/// 注册即登录：返回 token。
async fn register(router: &Router, email: &str, password: &str) -> String {
    let (status, body) = send(
        router,
        "POST",
        "/api/v1/auth/register",
        Some(json!({"email": email, "password": password})),
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
    )
    .await;
    assert_eq!(
        status, expect,
        "登录 {email} 期望 {expect}，实际 {status}：{body}"
    );
    body["token"].as_str().map(String::from)
}

/// 申请找回（断言 202），返回捕获到的信。
async fn forgot(router: &Router, handle: &CaptureHandle, email: &str) -> Vec<OutgoingMail> {
    let (status, body) = send(
        router,
        "POST",
        "/api/v1/auth/forgot-password",
        Some(json!({"email": email})),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(body["ok"], json!(true), "{body}");
    handle.take()
}

/// 凭令牌重置口令。
async fn reset(router: &Router, token: &str, new_password: &str) -> (StatusCode, Value) {
    send(
        router,
        "POST",
        "/api/v1/auth/reset-password",
        Some(json!({"token": token, "new_password": new_password})),
        None,
    )
    .await
}

/// 从信的正文里挖出重置令牌（链接形如 `...?reset_token=XXX`）。
fn reset_token_from(mail: &OutgoingMail) -> String {
    let marker = "reset_token=";
    let idx = mail
        .body
        .find(marker)
        .unwrap_or_else(|| panic!("信里没有重置链接：{}", mail.body));
    let rest = &mail.body[idx + marker.len()..];
    rest.split_whitespace()
        .next()
        .expect("令牌非空")
        .to_string()
}

/// 防枚举：注册过与没注册过，响应必须一模一样（同状态码、同字段）。
#[tokio::test]
async fn forgot_password_never_reveals_whether_email_registered() {
    let pool = common::test_pool().await;

    let (r_unknown, handle_unknown) = capture_router(pool.clone());
    let email_unknown = unique_email();
    let (status_unknown, body_unknown) = send(
        &r_unknown,
        "POST",
        "/api/v1/auth/forgot-password",
        Some(json!({"email": email_unknown})),
        None,
    )
    .await;

    let (r_known, handle_known) = capture_router(pool.clone());
    let email_known = unique_email();
    register(&r_known, &email_known, "old-pass-1234").await;
    let (status_known, body_known) = send(
        &r_known,
        "POST",
        "/api/v1/auth/forgot-password",
        Some(json!({"email": email_known})),
        None,
    )
    .await;

    // 状态码与响应体必须一致——这里哪怕差一个字段，接口就成了注册用户探测器
    assert_eq!(status_unknown, status_known, "响应状态码泄露了注册状态");
    assert_eq!(body_unknown, body_known, "响应体泄露了注册状态");
    assert_eq!(status_unknown, StatusCode::ACCEPTED);
    // 没注册过：一封信都不该发
    assert!(handle_unknown.take().is_empty(), "没注册过却发了信");
    // 注册过：恰好一封
    assert_eq!(handle_known.take().len(), 1, "注册过应恰好发一封信");
}

/// 寄出的信里必须带可用的重置链接，且真能拿它改口令。
#[tokio::test]
async fn forgot_email_carries_working_reset_link() {
    let pool = common::test_pool().await;
    let (r, handle) = capture_router(pool.clone());
    let email = unique_email();

    register(&r, &email, "old-pass-1234").await;
    let mails = forgot(&r, &handle, &email).await;
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].to, email, "信要寄给本人");
    assert!(
        mails[0]
            .body
            .contains("https://test.example/taiyin/?reset_token="),
        "链接要指向前端站点并带令牌：{}",
        mails[0].body
    );
    let token = reset_token_from(&mails[0]);

    let (status, body) = reset(&r, &token, "brand-new-5678").await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

/// 核心场景：凭令牌重置 → 旧口令作废、旧会话全踢、新口令能进。
#[tokio::test]
async fn reset_with_token_kills_old_password_and_sessions() {
    let pool = common::test_pool().await;
    let (r, handle) = capture_router(pool.clone());
    let email = unique_email();
    let password = "old-pass-1234";

    let token_old = register(&r, &email, password).await;
    // 第二个会话：踢会话必须是「全部」，只踢一个等于没踢
    let token_old2 = login(&r, &email, password, StatusCode::OK).await.unwrap();

    let mails = forgot(&r, &handle, &email).await;
    let token = reset_token_from(&mails[0]);

    let (status, body) = reset(&r, &token, "brand-new-5678").await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // 旧口令登不进
    assert!(
        login(&r, &email, password, StatusCode::UNAUTHORIZED)
            .await
            .is_none(),
        "旧口令还活着"
    );
    // 新口令能进
    assert!(
        login(&r, &email, "brand-new-5678", StatusCode::OK)
            .await
            .is_some(),
        "新口令登不进"
    );
    // 两个旧会话都必须死——「改密即踢下线」，不然重置白做
    for (label, dead) in [("会话一", &token_old), ("会话二", &token_old2)] {
        let (status, body) = send(&r, "GET", "/api/v1/auth/me", None, Some(dead)).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{label} 在重置后还活着：{body}"
        );
    }
}

/// 令牌一次有效：同一链接不能改两次口令。
#[tokio::test]
async fn reset_token_is_single_use() {
    let pool = common::test_pool().await;
    let (r, handle) = capture_router(pool.clone());
    let email = unique_email();

    register(&r, &email, "old-pass-1234").await;
    let mails = forgot(&r, &handle, &email).await;
    let token = reset_token_from(&mails[0]);

    let (status, _) = reset(&r, &token, "brand-new-5678").await;
    assert_eq!(status, StatusCode::OK, "第一次用令牌应成功");

    // 同一令牌第二次必须被拒
    let (status, body) = reset(&r, &token, "another-one-9999").await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "令牌竟然能用第二次：{body}"
    );
}

/// 过期令牌一律拒绝。
#[tokio::test]
async fn expired_token_is_rejected() {
    let pool = common::test_pool().await;
    let (r, handle) = capture_router(pool.clone());
    let email = unique_email();

    register(&r, &email, "old-pass-1234").await;
    let mails = forgot(&r, &handle, &email).await;
    let token = reset_token_from(&mails[0]);

    // 直接把库里那行改成「一小时前过期」（等 30 分钟不现实）
    sqlx::query(
        "UPDATE password_reset_tokens SET expires_at = now() - interval '1 hour' \
         WHERE token_hash = $1",
    )
    .bind(hash_reset_token(&token))
    .execute(&pool)
    .await
    .expect("改过期时间");

    let (status, body) = reset(&r, &token, "brand-new-5678").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "过期令牌竟被接受：{body}");
}

/// 口令太短被拒时**不得**烧掉令牌——用户改个口令重来即可，别逼他重新收信。
#[tokio::test]
async fn short_password_does_not_burn_token() {
    let pool = common::test_pool().await;
    let (r, handle) = capture_router(pool.clone());
    let email = unique_email();

    register(&r, &email, "old-pass-1234").await;
    let mails = forgot(&r, &handle, &email).await;
    let token = reset_token_from(&mails[0]);

    let (status, _) = reset(&r, &token, "short").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "太短的口令该被拒");

    // 同一令牌换合规口令重来，必须仍然有效
    let (status, body) = reset(&r, &token, "brand-new-5678").await;
    assert_eq!(status, StatusCode::OK, "口令太短不该烧掉令牌：{body}");
}

/// 重新申请找回后，旧令牌一并作废（「哪封信算数」不能是糊涂账）。
#[tokio::test]
async fn new_forgot_request_invalidates_previous_token() {
    let pool = common::test_pool().await;
    let (r, handle) = capture_router(pool.clone());
    let email = unique_email();

    register(&r, &email, "old-pass-1234").await;
    let mails1 = forgot(&r, &handle, &email).await;
    let mails2 = forgot(&r, &handle, &email).await;
    let old_token = reset_token_from(&mails1[0]);
    let new_token = reset_token_from(&mails2[0]);

    // 旧令牌必须失效
    let (status, body) = reset(&r, &old_token, "brand-new-5678").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "旧令牌还活着：{body}");

    // 新令牌算数
    let (status, body) = reset(&r, &new_token, "brand-new-5678").await;
    assert_eq!(status, StatusCode::OK, "新令牌不该被误伤：{body}");
}

/// 乱写的令牌一律拒绝（同一个 400，不给「猜对没有」的预言机）。
#[tokio::test]
async fn garbage_token_is_rejected() {
    let pool = common::test_pool().await;
    let (r, _handle) = capture_router(pool);
    let (status, body) = reset(&r, "not-a-real-token", "brand-new-5678").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}
