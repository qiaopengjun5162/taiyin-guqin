//! 内容治理（举报 + 人工下架）的端到端测试。
//!
//! 要钉住的是三条**不会报错、只会悄悄失效**的规矩：
//!
//! 1. 下架必须真的下架——从列表消失**且**分享链接打不开（只做前者等于没做）；
//! 2. 举报按人去重，同一个人重复举报不能把数字刷上去；
//! 3. 管理端没配口令时是关着的，不是「谁都能进」。

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

const ADMIN: &str = "test-admin-token-0";

fn admin_config() -> ServerConfig {
    ServerConfig {
        admin_token: Some(ADMIN.into()),
        // 用例里一秒要发好几个请求，别让限流先挡住——否则测的就不是治理逻辑了。
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

fn unique_token() -> String {
    format!("mod-test-{}", Uuid::new_v4())
}

/// 发一个请求。四个可选凭据分开传，避免把「哪种身份」写死在辅助函数里。
async fn send(
    router: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    bearer: Option<&str>,
    owner: Option<&str>,
    admin: Option<&str>,
) -> (StatusCode, Value, Option<i64>) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-forwarded-for", "203.0.113.11");
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(t) = bearer {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
    if let Some(t) = owner {
        builder = builder.header("x-owner-token", t);
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
    let total = resp
        .headers()
        .get("x-total-count")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok());
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json, total)
}

async fn register(router: &Router) -> (String, String) {
    let email = format!("mod-{}@example.com", Uuid::new_v4());
    let (status, body, _) = send(
        router,
        "POST",
        "/api/v1/auth/register",
        Some(json!({"email": email, "password": "qin-you-2026", "display_name": "琴友"})),
        None,
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "注册应成功：{body}");
    (
        email,
        body["token"].as_str().expect("应返回 token").to_string(),
    )
}

/// 发布一首谱，返回 id。标题用唯一前缀，方便用 `q` 精确捞出这一首。
async fn publish(router: &Router, token: &str, title: &str, bearer: Option<&str>) -> String {
    let (status, body, _) = send(
        router,
        "POST",
        "/api/v1/scores",
        Some(json!({"title": title, "notes": [{"id": "1"}]})),
        bearer,
        Some(token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "发布应成功：{body}");
    body["id"].as_str().expect("应返回 id").to_string()
}

/// 在社区列表里用关键词搜，返回命中的 id。
async fn search_ids(router: &Router, q: &str) -> (Vec<String>, Option<i64>) {
    let uri = format!("/api/v1/scores?q={q}");
    let (status, body, total) = send(router, "GET", &uri, None, None, None, None).await;
    assert_eq!(status, StatusCode::OK);
    let ids = body
        .as_array()
        .expect("列表应是数组")
        .iter()
        .filter_map(|s| s["id"].as_str().map(str::to_string))
        .collect();
    (ids, total)
}

async fn cleanup(pool: &PgPool, token: &str, emails: &[String]) {
    // 先按凭证删谱（举报行随外键 CASCADE 一起走），再删账号。
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

/// 举报必须登录：本机凭证是设备钥匙，为一条举报多存一份凭据不划算。
#[tokio::test]
async fn report_requires_login() {
    let pool = common::test_pool().await;
    let token = unique_token();
    let router = router(pool.clone(), &admin_config());
    let id = publish(
        &router,
        &token,
        &format!("举报登录-{}", Uuid::new_v4()),
        None,
    )
    .await;

    let (status, body, _) = send(
        &router,
        "POST",
        &format!("/api/v1/scores/{id}/report"),
        None,
        None,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "匿名举报应被拒：{body}");

    cleanup(&pool, &token, &[]).await;
}

/// 同一人重复举报只算一次；谱主不能举报自己。
#[tokio::test]
async fn report_is_deduped_and_own_score_is_rejected() {
    let pool = common::test_pool().await;
    let owner_token = unique_token();
    let router = router(pool.clone(), &admin_config());
    let (email_a, bearer_a) = register(&router).await;
    let (email_b, bearer_b) = register(&router).await;

    // A 以登录态发布（同时带本机凭证，与前端行为一致）
    let title = format!("被举报的谱-{}", Uuid::new_v4());
    let id = publish(&router, &owner_token, &title, Some(&bearer_a)).await;

    // A 举报自己的谱 → 400（这是操作失误，不是攻击，给解释而不是冷冰冰的 403）
    let (status, body, _) = send(
        &router,
        "POST",
        &format!("/api/v1/scores/{id}/report"),
        None,
        Some(&bearer_a),
        None,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "谱主举报自己应被拒：{body}"
    );

    // B 举报两次：第一次计入，第二次幂等
    let (status, body, _) = send(
        &router,
        "POST",
        &format!("/api/v1/scores/{id}/report"),
        None,
        Some(&bearer_b),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["reported"], true);
    assert_eq!(body["reports_count"], 1);

    let (status, body, _) = send(
        &router,
        "POST",
        &format!("/api/v1/scores/{id}/report"),
        None,
        Some(&bearer_b),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["reported"], false,
        "重复举报应被主键去重，不能把数字刷上去"
    );
    assert_eq!(body["reports_count"], 1);

    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM score_reports WHERE score_id = $1")
        .bind(Uuid::parse_str(&id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 1, "库里也只该有一行举报记录");

    cleanup(&pool, &owner_token, &[email_a, email_b]).await;
}

/// 下架要**真的**下架：列表里没有、分享链接对外 404；
/// 但谱主与管理员仍能读到（否则谱主不知道发生了什么，也没法改好再申请恢复）。
#[tokio::test]
async fn hidden_score_leaves_list_and_404s_for_outsiders() {
    let pool = common::test_pool().await;
    let token = unique_token();
    let router = router(pool.clone(), &admin_config());
    let title = format!("待下架-{}", Uuid::new_v4());
    let id = publish(&router, &token, &title, None).await;

    let (ids, total) = search_ids(&router, &title).await;
    assert_eq!(ids, vec![id.clone()], "下架前应能在列表里搜到");
    assert_eq!(total, Some(1));

    // 下架
    let (status, body, _) = send(
        &router,
        "POST",
        &format!("/api/v1/admin/scores/{id}/hide"),
        None,
        None,
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "管理员下架应成功：{body}");
    assert_eq!(body["hidden"], true);

    // 列表里消失（列表与总数是两条 SQL，必须都带上 hidden_at IS NULL）
    let (ids, total) = search_ids(&router, &title).await;
    assert!(ids.is_empty(), "下架后不该再出现在列表里：{ids:?}");
    assert_eq!(
        total,
        Some(0),
        "总数也必须跟着变，否则「还有 N 首」永远清不掉"
    );

    // 外人拿到 id 也打不开——只从列表消失等于没下架
    let (status, _, _) = send(
        &router,
        "GET",
        &format!("/api/v1/scores/{id}"),
        None,
        None,
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "外人应看到 404");

    // 谱主自己能读到，并看到 hidden 标记
    let (status, body, _) = send(
        &router,
        "GET",
        &format!("/api/v1/scores/{id}"),
        None,
        None,
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "谱主应仍能打开自己的谱：{body}");
    assert_eq!(body["hidden"], true, "谱主需要知道「已被下架」");

    // 管理员也能读到（要读内容才能判断该不该恢复）
    let (status, _, _) = send(
        &router,
        "GET",
        &format!("/api/v1/scores/{id}"),
        None,
        None,
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "管理员应能读到已下架的谱");

    // 恢复后一切复原
    let (status, body, _) = send(
        &router,
        "POST",
        &format!("/api/v1/admin/scores/{id}/restore"),
        None,
        None,
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "恢复应成功：{body}");
    let (ids, total) = search_ids(&router, &title).await;
    assert_eq!(ids, vec![id.clone()], "恢复后应重新出现在列表里");
    assert_eq!(total, Some(1));

    let (status, _, _) = send(
        &router,
        "GET",
        &format!("/api/v1/scores/{id}"),
        None,
        None,
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "恢复后外人也能打开");

    cleanup(&pool, &token, &[]).await;
}

/// 管理端默认是关着的；口令不对也进不去。
#[tokio::test]
async fn admin_endpoints_are_closed_without_token() {
    let pool = common::test_pool().await;

    // ① 没配 ADMIN_TOKEN：整体 503（不是 404，避免维护者以为是路径写错）
    let disabled = router(pool.clone(), &ServerConfig::default());
    let (status, body, _) = send(
        &disabled,
        "GET",
        "/api/v1/admin/reported",
        None,
        None,
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::SERVICE_UNAVAILABLE,
        "未配置口令时管理端应关闭：{body}"
    );

    // ② 配了但没带 / 带错：401
    let router = router(pool.clone(), &admin_config());
    let (status, _, _) = send(
        &router,
        "GET",
        "/api/v1/admin/reported",
        None,
        None,
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, _, _) = send(
        &router,
        "GET",
        "/api/v1/admin/reported",
        None,
        None,
        None,
        Some("wrong-token"),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "口令错误应 401");
}

/// 管理端按「被举报人数」倒序：先看被举报最多的。
#[tokio::test]
async fn reported_list_is_sorted_by_report_count() {
    let pool = common::test_pool().await;
    let token = unique_token();
    let router = router(pool.clone(), &admin_config());
    let (email_a, bearer_a) = register(&router).await;
    let (email_b, bearer_b) = register(&router).await;

    let quiet = format!("少举报-{}", Uuid::new_v4());
    let noisy = format!("多举报-{}", Uuid::new_v4());
    let quiet_id = publish(&router, &token, &quiet, None).await;
    let noisy_id = publish(&router, &token, &noisy, None).await;

    for (id, bearer) in [
        (&noisy_id, &bearer_a),
        (&noisy_id, &bearer_b),
        (&quiet_id, &bearer_a),
    ] {
        let (status, _, _) = send(
            &router,
            "POST",
            &format!("/api/v1/scores/{id}/report"),
            None,
            Some(bearer),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    let (status, body, _) = send(
        &router,
        "GET",
        "/api/v1/admin/reported",
        None,
        None,
        None,
        Some(ADMIN),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let rows = body.as_array().expect("应是数组");
    // 开发库里可能有别的历史举报行，所以只断言「这首排在那首之前」，不假设下标。
    let pos_noisy = rows
        .iter()
        .position(|r| r["id"] == noisy_id)
        .expect("应含多举报那首");
    let pos_quiet = rows
        .iter()
        .position(|r| r["id"] == quiet_id)
        .expect("应含少举报那首");
    assert!(
        pos_noisy < pos_quiet,
        "被举报人数多的应排在前面：{pos_noisy} vs {pos_quiet}"
    );
    assert_eq!(rows[pos_noisy]["reports_count"], 2);
    assert_eq!(
        rows[pos_noisy]["hidden_at"],
        Value::Null,
        "没处理过的应当是 null"
    );

    cleanup(&pool, &token, &[email_a, email_b]).await;
}
