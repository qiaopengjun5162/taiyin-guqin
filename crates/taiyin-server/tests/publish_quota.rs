//! 发布配额的端到端测试（连真实 Postgres）。
//!
//! 这里要证明的不是「能不能发」，而是**闸门真的拦得住**：
//!
//! 1. 达到上限后确实 409，且文案告诉人怎么自己解开；
//! 2. 删掉旧谱后额度真的回来了（配额是「存量」而不是「发过就不许再发」）；
//! 3. 登录用户的额度把「这台设备之前发的谱」也算进去（否则登录一下额度就翻倍）；
//! 4. 并发请求也超不过上限——这条最重要，因为「先数后插」的天真写法在串行测试里
//!    永远是对的，只有并发才暴露。
//!
//! 每个用例都用**独立的凭证 / 邮箱**：这套测试跑在共享的开发库上，
//! 库里可能已经有别人的行，按全局条数断言会莫名其妙地红。

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

/// 造一个配额很小的配置。限流阈值同时放大，免得先被 429 挡住、
/// 把「配额」的失败误判成「限流」的失败。
fn quota_config(per_account: i64, per_device: i64) -> ServerConfig {
    ServerConfig {
        publish_quota_per_account: per_account,
        publish_quota_per_device: per_device,
        write_per_second: 1000,
        write_burst: 200,
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

/// 每个用例一把独有凭证，互不干扰，也方便收尾时按它清干净。
fn unique_token() -> String {
    format!("quota-test-{}", Uuid::new_v4())
}

fn publish_request(token: &str, bearer: Option<&str>, title: &str) -> Request<Body> {
    let body = json!({"title": title, "notes": [{"id": "1"}]}).to_string();
    let mut builder = Request::builder()
        .method("POST")
        .uri("/api/v1/scores")
        .header("content-type", "application/json")
        // 限流按 IP 计数，`oneshot` 拿不到 peer 地址，补一个等价于「反代之后」的头。
        .header("x-forwarded-for", "203.0.113.9")
        .header("x-owner-token", token);
    if let Some(t) = bearer {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
    builder.body(Body::from(body)).unwrap()
}

async fn send(router: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

/// 注册并拿到会话 token。
async fn register_token(router: &Router) -> (String, String) {
    let email = format!("quota-{}@example.com", Uuid::new_v4());
    let body = json!({"email": email, "password": "qin-you-2026", "display_name": "琴友"});
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register")
        .header("content-type", "application/json")
        .header("x-forwarded-for", "203.0.113.9")
        .body(Body::from(body.to_string()))
        .unwrap();
    let (status, json) = send(router, req).await;
    assert_eq!(status, StatusCode::OK, "注册应成功：{json}");
    (
        email,
        json["token"].as_str().expect("应返回 token").to_string(),
    )
}

/// 收尾：按凭证清掉本次造的行，按邮箱清掉账号。
async fn cleanup(pool: &PgPool, token: &str, emails: &[String]) {
    sqlx::query("DELETE FROM scores WHERE owner_token = $1")
        .bind(token)
        .execute(pool)
        .await
        .unwrap();
    for email in emails {
        sqlx::query("DELETE FROM users WHERE email = $1")
            .bind(email)
            .execute(pool)
            .await
            .unwrap();
    }
}

/// 未登录额度：用满即拦，删掉一首立刻恢复。
///
/// 第二条断言是配额的**可用性底线**：如果删了谱额度还不回来，这个限制就成了
/// 「发满一次就永久封号」，正常用户会被无声无息地锁死。
#[tokio::test]
async fn device_quota_blocks_then_delete_frees_a_slot() {
    let pool = common::test_pool().await;
    let token = unique_token();
    let router = router(pool.clone(), &quota_config(100, 2));

    let (status, first) = send(&router, publish_request(&token, None, "配额一")).await;
    assert_eq!(status, StatusCode::OK, "第一首应成功：{first}");
    let (status, _) = send(&router, publish_request(&token, None, "配额二")).await;
    assert_eq!(status, StatusCode::OK, "第二首应成功（上限 2）");

    let (status, body) = send(&router, publish_request(&token, None, "配额三")).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "第三首应被配额拦下，实际：{status} {body}"
    );
    let message = body["error"].as_str().unwrap_or_default();
    assert!(
        message.contains("未登录上限"),
        "文案要说清是哪条上限：{message}"
    );
    assert!(
        message.contains("2 首"),
        "文案要给出具体上限数字：{message}"
    );

    // 删掉第一首，额度应当立刻回来。
    let id = first["id"].as_str().expect("应返回 id");
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/scores/{id}"))
        .header("x-forwarded-for", "203.0.113.9")
        .header("x-owner-token", &token)
        .body(Body::empty())
        .unwrap();
    let (status, body) = send(&router, req).await;
    assert_eq!(status, StatusCode::OK, "删自己的谱应成功：{body}");

    let (status, body) = send(&router, publish_request(&token, None, "配额四")).await;
    assert_eq!(status, StatusCode::OK, "腾出位置后应能继续发布：{body}");

    cleanup(&pool, &token, &[]).await;
}

/// 登录后额度把「这台设备之前匿名发的谱」也算进来。
///
/// 漏掉这一条的症状很隐蔽：`owner_user_id` 为空的老谱不计入账号，
/// 用户只要「匿名发满 → 注册 → 再发」就能无限续杯，闸门形同虚设。
#[tokio::test]
async fn account_quota_also_counts_unclaimed_device_rows() {
    let pool = common::test_pool().await;
    let token = unique_token();
    // 未登录额度给得很高，确保拦住第三次的一定是「账号上限」而不是别的。
    let router = router(pool.clone(), &quota_config(2, 100));
    let (email, bearer) = register_token(&router).await;

    // ① 先以本机凭证（未登录）发一首：这行的 owner_user_id 是 NULL
    let (status, _) = send(&router, publish_request(&token, None, "匿名发的")).await;
    assert_eq!(status, StatusCode::OK);

    // ② 登录后带着同一把凭证再发一首：这一行同时有账号与凭证
    let (status, _) = send(&router, publish_request(&token, Some(&bearer), "登录发的")).await;
    assert_eq!(status, StatusCode::OK);

    // ③ 账上已经是 2 首（1 首匿名 + 1 首登录），第三次必须被账号上限挡住
    let (status, body) = send(&router, publish_request(&token, Some(&bearer), "第三首")).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "账号额度应把匿名老谱算进去，实际：{status} {body}"
    );
    assert!(
        body["error"]
            .as_str()
            .unwrap_or_default()
            .contains("账号上限"),
        "文案应指明是账号上限：{body}"
    );

    cleanup(&pool, &token, &[email]).await;
}

/// 配额是**按身份**算的，不是全站一个池子。
///
/// 这条防的是「一个人发满，所有人都发不了」——把全局限流和配额搞混很容易写成这样。
#[tokio::test]
async fn quota_is_per_identity_not_global() {
    let pool = common::test_pool().await;
    let full_token = unique_token();
    let other_token = unique_token();
    let router = router(pool.clone(), &quota_config(100, 1));

    let (status, _) = send(&router, publish_request(&full_token, None, "占满额度")).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send(&router, publish_request(&full_token, None, "超额")).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // 换一个身份（模拟另一台设备）应当照发不误。
    let (status, body) = send(&router, publish_request(&other_token, None, "别人发的")).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "别的身份不该被牵连：{status} {body}"
    );

    cleanup(&pool, &full_token, &[]).await;
    cleanup(&pool, &other_token, &[]).await;
}

/// 并发也超不过上限。
///
/// 「先 count 再 insert」在串行测试里永远是对的：请求一个个来，每次数到的都是
/// 上一次插完的结果。只有真正并发才会露出破绽——8 个请求同时数到 `limit - 1`，
/// 然后一起插进去。这条用例就是用来钉住那把身份级建议锁的。
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_publishes_cannot_exceed_quota() {
    const LIMIT: i64 = 3;
    const CONCURRENCY: usize = 8;

    // 连接数要够多，否则连接池先把并发压成串行，锁根本没机会正面相撞。
    let pool = common::test_pool_with(CONCURRENCY as u32).await;
    let token = unique_token();
    let router = router(pool.clone(), &quota_config(100, LIMIT));

    let mut handles = Vec::new();
    for i in 0..CONCURRENCY {
        let router = router.clone();
        let token = token.clone();
        handles.push(tokio::spawn(async move {
            let req = publish_request(&token, None, &format!("并发 {i}"));
            send(&router, req).await.0
        }));
    }
    let mut ok = 0;
    let mut conflict = 0;
    for handle in handles {
        match handle.await.expect("并发任务不应 panic") {
            StatusCode::OK => ok += 1,
            StatusCode::CONFLICT => conflict += 1,
            other => panic!("意外的状态码：{other}"),
        }
    }
    assert_eq!(ok, LIMIT as usize, "成功数应正好等于上限");
    assert_eq!(ok + conflict, CONCURRENCY, "其余请求都应被配额挡下");

    // 以库里的真实行数为准，别只信响应码：万一插入失败却回了 200，这里能抓住。
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM scores WHERE owner_token = $1")
        .bind(&token)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, LIMIT, "库里不该出现超过上限的行");

    cleanup(&pool, &token, &[]).await;
}
