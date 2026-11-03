mod common;

use axum::{body::Body, http::Request};
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

    // 未带凭证创建的谱是「无主谱」：谁也改不了，只能管理员清理
    let body_str = serde_json::to_string(&json!({"title": "无主谱", "notes": []})).unwrap();
    let resp = app(state.clone(), &ServerConfig::default())
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
    let orphan: Value = serde_json::from_slice(&body_bytes).unwrap();
    let orphan_id = orphan["id"].as_str().unwrap().to_string();

    let resp = app(state, &ServerConfig::default())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .header("x-owner-token", OWNER)
                .uri(format!("/api/v1/scores/{orphan_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 403, "无主谱不能被任何凭证认领删除");
}
