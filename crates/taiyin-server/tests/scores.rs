mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use taiyin_server::{AppState, ServerConfig, app};
use tower::util::ServiceExt;

/// 测试用发布者凭证：创建时带上，之后改 / 删必须带同一个值。
const OWNER: &str = "test-owner-token-0001";

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

    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("POST")
                .header("x-owner-token", OWNER)
                .header("x-forwarded-for", "203.0.113.7")
                .uri("/api/v1/scores")
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let resp = app(state, &ServerConfig::default())
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
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("POST")
                .header("x-owner-token", OWNER)
                .header("x-forwarded-for", "203.0.113.7")
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
    let resp = app(state.clone(), &ServerConfig::default())
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
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("PUT")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // 验证更新
    let resp = app(state.clone(), &ServerConfig::default())
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
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // 确认删除
    let resp = app(state, &ServerConfig::default())
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

/// 定弦随谱走：不传落正调、能改成别的调、非法值被拒。
///
/// 这条链断掉的后果很隐蔽——谱子照样打开、照样能弹，
/// 只是接着往里加的音会比实际琴音差半个音。
#[tokio::test]
async fn test_score_tuning_roundtrip() {
    let pool = common::test_pool().await;
    sqlx::query("DELETE FROM scores")
        .execute(&pool)
        .await
        .unwrap();
    let state = AppState {
        pool: pool.clone(),
        llm: Default::default(),
    };

    // 不传 tuning → 落正调（与建表默认值、前端 DEFAULT_TUNING 三处一致）
    let body_str = serde_json::to_string(&json!({"title": "忘机", "notes": []})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("POST")
                .header("x-owner-token", OWNER)
                .header("x-forwarded-for", "203.0.113.7")
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
    assert_eq!(created["tuning"], "zhengdiao");
    let id = created["id"].as_str().unwrap().to_string();

    // 改成蕤宾调（紧五弦）
    let body_str = serde_json::to_string(&json!({"tuning": "ruibin"})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("PUT")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{id}"))
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
    let updated: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(updated["tuning"], "ruibin");

    // 重新读一次：确认是落库了，而不是只把请求回显给前端
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let fetched: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(fetched["tuning"], "ruibin");

    // 列表项也要带定弦，否则加载对话框没得显示
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .uri("/api/v1/scores")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let items: Value = serde_json::from_slice(&body_bytes).unwrap();
    // 三个测试并发共用同一个库，列表里可能夹着别的用例刚写的行，
    // 所以按 id 找自己那条，不能取 items[0]。
    let mine = items
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id.as_str())
        .expect("刚建的曲谱应出现在列表里");
    assert_eq!(mine["tuning"], "ruibin");

    // 前端不认识的定弦不能在库里生根
    let body_str = serde_json::to_string(&json!({"tuning": "youma"})).unwrap();
    let resp = app(state, &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("PUT")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

/// 署名随谱走：不传即匿名、能改、能读回、列表项也带、超长被拒。
///
/// 社区里同一首曲谱有多个打法版本，署名是区分「这是谁打的谱」的唯一线索；
/// 断掉的话列表全变成匿名，分享出去的链接也说不清出处。
#[tokio::test]
async fn test_score_author_roundtrip() {
    let pool = common::test_pool().await;
    sqlx::query("DELETE FROM scores")
        .execute(&pool)
        .await
        .unwrap();
    let state = AppState {
        pool: pool.clone(),
        llm: Default::default(),
    };

    // 不传 author → 匿名（空串，与迁移默认值一致）
    let body_str = serde_json::to_string(&json!({"title": "匿名谱", "notes": []})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("POST")
                .header("x-owner-token", OWNER)
                .header("x-forwarded-for", "203.0.113.7")
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
    assert_eq!(created["author"], "");
    let id = created["id"].as_str().unwrap().to_string();

    // 补上署名（前后空白要去掉，否则列表里会顶着空格显示）
    let body_str = serde_json::to_string(&json!({"author": "  张百忍  "})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("PUT")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{id}"))
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
    let updated: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(updated["author"], "张百忍", "署名应去空白后入库");

    // 重新读：确认落库，而不是只回显请求
    let resp = app(state.clone(), &ServerConfig::default())
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
    let fetched: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(fetched["author"], "张百忍");

    // 列表项也要带署名，否则社区列表没得显示
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .uri("/api/v1/scores")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let items: Value = serde_json::from_slice(&body_bytes).unwrap();
    let mine = items
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id.as_str())
        .expect("刚建的曲谱应出现在列表里");
    assert_eq!(mine["author"], "张百忍");

    // 超长署名（41 个汉字）应被拒，避免把列表撑爆
    let too_long = "琴".repeat(41);
    let body_str = serde_json::to_string(&json!({"author": too_long})).unwrap();
    let resp = app(state, &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("PUT")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

/// 所有权凭证：知道 id 不等于有权改删。
///
/// 分享链接里带着 id，若不加这道闸，任何看到链接的人都能删掉社区里的谱。
#[tokio::test]
async fn test_owner_token_guards_update_and_delete() {
    let pool = common::test_pool().await;
    sqlx::query("DELETE FROM scores")
        .execute(&pool)
        .await
        .unwrap();
    let state = AppState {
        pool: pool.clone(),
        llm: Default::default(),
    };

    // 带凭证创建
    let body_str = serde_json::to_string(&json!({"title": "有主谱", "notes": []})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("POST")
                .header("x-owner-token", OWNER)
                .header("x-forwarded-for", "203.0.113.7")
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
    // 凭证绝不能回传给客户端：拿到它就能改删
    assert!(
        created.get("owner_token").is_none(),
        "响应不得包含 owner_token"
    );

    // 公开可读：社区谱不设访问门槛
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // 换一个凭证改 → 403
    let body_str = serde_json::to_string(&json!({"title": "被篡改"})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("PUT")
                .header("x-owner-token", "someone-else")
                .uri(format!("/api/v1/scores/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 403);

    // 不带凭证改 → 403
    let body_str = serde_json::to_string(&json!({"title": "匿名篡改"})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
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
    assert_eq!(resp.status(), 403);

    // 换一个凭证删 → 403，且谱还在
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .header("x-owner-token", "someone-else")
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 403);

    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200, "被拒绝的删除不能真的删掉谱");

    // 本人凭证：能改、能删
    let body_str = serde_json::to_string(&json!({"title": "本人改名"})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("PUT")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // 不带任何身份发布：现在直接 401，不再产生「谁也删不掉」的无主谱
    let body_str = serde_json::to_string(&json!({"title": "无主谱", "notes": []})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/scores")
                .header("content-type", "application/json")
                .header("x-forwarded-for", "203.0.113.7")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 401, "无身份发布必须被拒绝");
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let err: Value = serde_json::from_slice(&body_bytes).unwrap();
    let msg = err["error"].as_str().unwrap_or_default();
    assert!(
        msg.contains("x-owner-token"),
        "错误信息要告诉调用者怎么补上身份，实际：{msg}"
    );
}

/// 列表分页：默认页大小、上限与下限夹紧、越界页仍给总数。
///
/// 这些断言刻意写成「无论库里已有多少条都成立」，因为它们验证的是**分页参数的处理**，
/// 而不是数据本身——把断言绑在绝对条数上，任何一个并发跑的清表用例都会让它假红。
#[tokio::test]
async fn list_scores_is_paginated() {
    let pool = common::test_pool().await;
    let state = AppState {
        pool: pool.clone(),
        llm: Default::default(),
    };

    // 造三条，用于验证翻页确实能翻到、且不同页不重复
    for title in ["分页测试甲", "分页测试乙", "分页测试丙"] {
        let resp = app(state.clone(), &ServerConfig::default())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/scores")
                    .header("content-type", "application/json")
                    .header("x-owner-token", OWNER)
                    .header("x-forwarded-for", "203.0.113.7")
                    .body(Body::from(
                        serde_json::to_string(&json!({"title": title, "notes": []})).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), 200, "造数据失败：{title}");
    }

    /// 取一页：返回 (该页 id 列表, 总数头)
    async fn page(state: AppState, query: &str) -> (Vec<String>, Option<u64>) {
        let resp = app(state, &ServerConfig::default())
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/scores{query}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), 200, "分页参数 `{query}` 不该报错");
        let total = resp
            .headers()
            .get("x-total-count")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let items: Value = serde_json::from_slice(&bytes).unwrap();
        let ids = items
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["id"].as_str().unwrap_or_default().to_string())
            .collect();
        (ids, total)
    }

    // 默认页大小
    let (ids, total) = page(state.clone(), "").await;
    assert!(
        ids.len() <= 50,
        "默认一页不该超过 50 条，实际 {}",
        ids.len()
    );
    let total = total.expect("分页响应必须带 x-total-count");
    assert!(total >= 3, "刚发布的 3 首必须计入总数，实际 {total}");

    // 上限夹紧：limit 想拉多少就拉多少的话，一条请求就能把整库拖出来
    let (ids, _) = page(state.clone(), "?limit=100000").await;
    assert!(ids.len() <= 200, "单页硬上限 200，实际 {}", ids.len());

    // 下限夹紧：limit=0 应被当成 1，而不是回空页（那看起来像「库里没了」）
    let (ids, _) = page(state.clone(), "?limit=0").await;
    assert_eq!(ids.len(), 1, "limit=0 应夹到 1，实际 {} 条", ids.len());

    // 负数 offset 不能让 SQL 报错
    let (_, neg_total) = page(state.clone(), "?offset=-5").await;
    assert!(neg_total.is_some(), "负数 offset 应被夹到 0");

    // 翻页不重复：相邻两页不能出现同一条
    let (first, _) = page(state.clone(), "?limit=1&offset=0").await;
    let (second, _) = page(state.clone(), "?limit=1&offset=1").await;
    if first.len() == 1 && second.len() == 1 && total >= 2 {
        assert_ne!(
            first[0], second[0],
            "offset 翻页返回了同一条，说明 OFFSET 没生效"
        );
    }

    // 越界页：空数组，但**总数仍在**。前端靠它区分「翻过头了」和「库空了」。
    let (ids, far_total) = page(state.clone(), "?offset=999999").await;
    assert!(
        ids.is_empty(),
        "越界 offset 应当返回空数组，实际 {} 条",
        ids.len()
    );
    assert!(
        far_total.is_some(),
        "越界分页也必须带总数——否则前端会把「翻过头」当成「没有更多了」"
    );

    // 清理自己造的
    sqlx::query("DELETE FROM scores WHERE title LIKE '分页测试%'")
        .execute(&pool)
        .await
        .unwrap();
}

/// 发布限流：**只锁写**，读列表不受牵连，且按 IP 隔离。
///
/// 为什么专门验这三件事：
/// 1. 锁没挂上 = 一台机器刷爆社区列表（这测试会红）；
/// 2. 锁挂错了位置（锁住整个 `/scores`）= 用户翻页翻到一半 429（这测试会红）；
/// 3. 锁做成全站共享 = 一个人刷，全站不能发谱（第三条断言就是防这个）。
#[tokio::test]
async fn create_score_is_rate_limited_but_list_is_not() {
    let pool = common::test_pool().await;
    let config = ServerConfig {
        // 全局放到几乎不生效，才能证明「发布自己带锁」而不是被全局顺带挡住
        global_per_second: 1000,
        global_burst: 1000,
        write_per_second: 1,
        write_burst: 2,
        ..Default::default()
    };

    // 关键：复用**同一个** router。每次新建 app 都会新建限流器、计数归零，
    // 那样这个测试永远绿——却什么都没验到。
    let router = app(
        AppState {
            pool,
            llm: Default::default(),
        },
        &config,
    );

    let mut codes = Vec::new();
    for i in 0..4 {
        let body =
            serde_json::to_string(&json!({"title": format!("限流测试{i}"), "notes": []})).unwrap();
        let resp = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/scores")
                    .header("content-type", "application/json")
                    .header("x-owner-token", OWNER)
                    .header("x-forwarded-for", "198.51.100.31")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        codes.push(resp.status());
    }
    assert_eq!(codes[0], StatusCode::OK, "突发额度内应放行");
    assert_eq!(codes[1], StatusCode::OK, "突发额度内应放行");
    assert!(
        codes[2..]
            .iter()
            .all(|s| *s == StatusCode::TOO_MANY_REQUESTS),
        "突发额度用完后应 429，实际：{codes:?}"
    );

    // 换个 IP 立刻恢复：限流按 IP 记账，不是全站共享一个桶
    let body = serde_json::to_string(&json!({"title": "限流测试-换IP", "notes": []})).unwrap();
    let resp = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/scores")
                .header("content-type", "application/json")
                .header("x-owner-token", OWNER)
                .header("x-forwarded-for", "198.51.100.77")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "限流按 IP 记账，别的 IP 不该被牵连"
    );

    // 读列表不进这把锁：真实场景里「发布失败的人」往往正在反复刷新列表
    let resp = router
        .oneshot(
            Request::builder()
                .uri("/api/v1/scores?limit=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "发布限流不该牵连列表读取（挂错位置会让翻页 429）"
    );
}
