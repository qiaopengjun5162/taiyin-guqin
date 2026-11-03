mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use taiyin_server::{AppState, ServerConfig, app};
use tower::util::ServiceExt;

/// 建一个 router。**同一个测试里必须复用这一个**：
/// 每次新建 `app()` 都会新建限流器、计数归零，跨 IP 的用例会假绿。
fn router(pool: sqlx::PgPool) -> Router {
    app(
        AppState {
            pool,
            llm: Default::default(),
        },
        &ServerConfig::default(),
    )
}

/// 发请求并取回 (状态码, JSON 体, x-total-count)。
///
/// `x-forwarded-for` 恒定给一个测试用 IP：限流层靠它取 key，
/// 缺了会 500 而不是 429——那种失败会把人引向完全错误的方向。
async fn call(
    app: &Router,
    method: &str,
    uri: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value, Option<String>) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-forwarded-for", "203.0.113.7");
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let req = match body {
        Some(v) => builder
            .header("content-type", "application/json")
            .body(Body::from(v.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let total = resp
        .headers()
        .get("x-total-count")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value, total)
}

async fn register(app: &Router, email: &str) -> String {
    let (status, body, _) = call(
        app,
        "POST",
        "/api/v1/auth/register",
        None,
        Some(json!({"email": email, "password": "pass-1234", "display_name": "收藏测试"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "注册应成功，实际：{body}");
    body["token"]
        .as_str()
        .expect("注册响应缺 token")
        .to_string()
}

/// 发布一首谱，返回 id。带凭证发布（新规则下无身份发布已经是 401）。
async fn create_score(app: &Router, title: &str) -> String {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/scores")
                .header("content-type", "application/json")
                .header("x-owner-token", "fav-test-owner")
                .header("x-forwarded-for", "203.0.113.7")
                .body(Body::from(json!({"title": title, "notes": []}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(status, StatusCode::OK, "造谱失败：{body}");
    body["id"].as_str().unwrap().to_string()
}

/// 三处收藏接口都必须登录：收藏跟人走，不跟设备走。
///
/// 这条不只是「有没有锁」——错误信息还得说明原因。只写「未授权」，
/// 用户会以为登录过期，重新登录一遍再试还是失败。
#[tokio::test]
async fn all_favorite_endpoints_require_login() {
    let pool = common::test_pool().await;
    let app = router(pool.clone());
    let id = create_score(&app, "收藏鉴权测试").await;

    let (status, body, _) = call(
        &app,
        "PUT",
        &format!("/api/v1/scores/{id}/favorite"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "没登录不该能收藏");
    let msg = body["error"].as_str().unwrap_or_default();
    assert!(
        msg.contains("登录"),
        "错误信息要说明「收藏需要登录」，实际：{msg}"
    );

    let (status, _, _) = call(
        &app,
        "DELETE",
        &format!("/api/v1/scores/{id}/favorite"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "没登录不该能取消收藏");

    let (status, _, _) = call(&app, "GET", "/api/v1/favorites", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "没登录不该能读收藏列表");

    let (status, _, _) = call(&app, "GET", "/api/v1/favorites/ids", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "没登录不该能读收藏 id");

    // 清掉造的数据
    sqlx::query("DELETE FROM scores WHERE title = '收藏鉴权测试'")
        .execute(&pool)
        .await
        .ok();
}

/// 收藏 → 出现在列表与 id 集合 → 取消 → 消失；重复收藏不产生重复行。
#[tokio::test]
async fn favorite_roundtrip_is_idempotent() {
    let pool = common::test_pool().await;
    let app = router(pool.clone());
    let email = format!("fav-{}@example.com", uuid::Uuid::new_v4());
    let token = register(&app, &email).await;
    let id = create_score(&app, "收藏往返测试").await;

    let (status, body, _) = call(
        &app,
        "PUT",
        &format!("/api/v1/scores/{id}/favorite"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "收藏失败：{body}");
    assert_eq!(body["favorited"], true);

    // 再收一次：幂等，不该报错也不该出现两条
    let (status, _, _) = call(
        &app,
        "PUT",
        &format!("/api/v1/scores/{id}/favorite"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "重复收藏应当幂等");

    let (status, body, total) = call(&app, "GET", "/api/v1/favorites", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("收藏列表应是数组");
    assert_eq!(items.len(), 1, "重复收藏不该产生两条记录：{body}");
    assert_eq!(items[0]["id"], id.as_str());
    assert_eq!(total.as_deref(), Some("1"), "总数头要跟着收藏数走");

    let (_, body, _) = call(&app, "GET", "/api/v1/favorites/ids", Some(&token), None).await;
    assert_eq!(body["ids"], json!([id]));

    // 取消：再取消一次也应当成功（双击不会报错）
    for attempt in 0..2 {
        let (status, body, _) = call(
            &app,
            "DELETE",
            &format!("/api/v1/scores/{id}/favorite"),
            Some(&token),
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "第 {} 次取消收藏失败：{body}",
            attempt + 1
        );
        assert_eq!(body["favorited"], false);
    }

    let (_, body, total) = call(&app, "GET", "/api/v1/favorites", Some(&token), None).await;
    assert_eq!(body.as_array().unwrap().len(), 0, "取消后列表应为空");
    assert_eq!(total.as_deref(), Some("0"));

    sqlx::query("DELETE FROM scores WHERE title = '收藏往返测试'")
        .execute(&pool)
        .await
        .ok();
}

/// 收藏是私人的：A 收藏的谱不该出现在 B 的收藏里。
#[tokio::test]
async fn favorites_are_per_account() {
    let pool = common::test_pool().await;
    let app = router(pool.clone());
    let a = register(&app, &format!("fav-a-{}@example.com", uuid::Uuid::new_v4())).await;
    let b = register(&app, &format!("fav-b-{}@example.com", uuid::Uuid::new_v4())).await;
    let id = create_score(&app, "收藏隔离测试").await;

    let (status, _, _) = call(
        &app,
        "PUT",
        &format!("/api/v1/scores/{id}/favorite"),
        Some(&a),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, body, total) = call(&app, "GET", "/api/v1/favorites", Some(&b), None).await;
    assert_eq!(body.as_array().unwrap().len(), 0, "B 不该看到 A 的收藏");
    assert_eq!(total.as_deref(), Some("0"));

    let (_, body, _) = call(&app, "GET", "/api/v1/favorites/ids", Some(&b), None).await;
    assert_eq!(body["ids"], json!([]));

    sqlx::query("DELETE FROM scores WHERE title = '收藏隔离测试'")
        .execute(&pool)
        .await
        .ok();
}

/// 收藏一首不存在的谱：404，而不是「看起来成功」。
///
/// 若放行，前端会显示「已收藏」，但收藏列表里永远没有它——
/// 用户会以为收藏功能坏了，或以为自己记错了。
#[tokio::test]
async fn favoriting_missing_score_is_404() {
    let pool = common::test_pool().await;
    let app = router(pool);
    let token = register(
        &app,
        &format!("fav-miss-{}@example.com", uuid::Uuid::new_v4()),
    )
    .await;
    let ghost = uuid::Uuid::new_v4();

    let (status, body, _) = call(
        &app,
        "PUT",
        &format!("/api/v1/scores/{ghost}/favorite"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "不存在的谱应 404，实际：{body}"
    );
}

/// 谱被删掉后，收藏记录要跟着消失（外键 CASCADE）。
///
/// 少了级联，收藏列表会留下点开就 404 的死行，
/// 而且总数会一直偏大——「已显示 3 / 4 首」却只翻得出 3 首。
#[tokio::test]
async fn deleting_score_removes_favorite_row() {
    let pool = common::test_pool().await;
    let app = router(pool.clone());
    let token = register(
        &app,
        &format!("fav-del-{}@example.com", uuid::Uuid::new_v4()),
    )
    .await;
    let id = create_score(&app, "收藏级联测试").await;

    call(
        &app,
        "PUT",
        &format!("/api/v1/scores/{id}/favorite"),
        Some(&token),
        None,
    )
    .await;

    // 用发布者凭证删谱（账号没认领过它，只能走凭证）
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/scores/{id}"))
                .header("x-owner-token", "fav-test-owner")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "删谱应成功");

    let (_, body, total) = call(&app, "GET", "/api/v1/favorites", Some(&token), None).await;
    assert!(
        body.as_array().unwrap().is_empty(),
        "谱删了收藏不该留下：{body}"
    );
    assert_eq!(total.as_deref(), Some("0"), "总数也要跟着归零");
}

/// 收藏列表分页：按「收藏时间倒序」，且分页不重复不遗漏。
#[tokio::test]
async fn favorites_are_paginated_newest_first() {
    let pool = common::test_pool().await;
    let app = router(pool.clone());
    let token = register(
        &app,
        &format!("fav-page-{}@example.com", uuid::Uuid::new_v4()),
    )
    .await;

    // 依次收三首：后收的应当排在前面
    let mut ids = Vec::new();
    for title in ["收藏分页甲", "收藏分页乙", "收藏分页丙"] {
        let id = create_score(&app, title).await;
        let (status, _, _) = call(
            &app,
            "PUT",
            &format!("/api/v1/scores/{id}/favorite"),
            Some(&token),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "收藏 {title} 失败");
        ids.push(id);
    }

    let (_, body, total) = call(
        &app,
        "GET",
        "/api/v1/favorites?limit=2&offset=0",
        Some(&token),
        None,
    )
    .await;
    let first = body.as_array().unwrap();
    assert_eq!(first.len(), 2);
    assert_eq!(
        total.as_deref(),
        Some("3"),
        "总数头要报全部收藏数，不是本页条数"
    );
    // 最新收的（丙）在最前
    assert_eq!(first[0]["id"], ids[2].as_str(), "最近收藏应排最前：{body}");

    let (_, body, _) = call(
        &app,
        "GET",
        "/api/v1/favorites?limit=2&offset=2",
        Some(&token),
        None,
    )
    .await;
    let second = body.as_array().unwrap();
    assert_eq!(second.len(), 1);
    assert_eq!(second[0]["id"], ids[0].as_str(), "第二页应当是最后收的那首");

    // 越界页：空数组但仍带总数——前端靠它区分「翻过头」和「没有收藏」
    let (status, body, total) = call(
        &app,
        "GET",
        "/api/v1/favorites?offset=999",
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());
    assert_eq!(total.as_deref(), Some("3"), "越界页也必须给总数");

    sqlx::query("DELETE FROM scores WHERE title LIKE '收藏分页%'")
        .execute(&pool)
        .await
        .ok();
}
