mod common;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use taiyin_server::{AppState, ServerConfig, app};
use tower::util::ServiceExt;

fn router(pool: sqlx::PgPool) -> Router {
    app(
        AppState {
            pool,
            llm: Default::default(),
        },
        &ServerConfig::default(),
    )
}

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
        .header("x-forwarded-for", "203.0.113.9");
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

/// 发布一首谱，返回 id。带凭证发布（无身份发布已是 401）。
async fn create_score(app: &Router, title: &str, author: &str, tuning: &str) -> String {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/scores")
                .header("content-type", "application/json")
                .header("x-owner-token", "search-test-owner")
                .header("x-forwarded-for", "203.0.113.9")
                .body(Body::from(
                    json!({"title": title, "author": author, "tuning": tuning, "notes": []})
                        .to_string(),
                ))
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

fn titles_of(body: &Value) -> Vec<String> {
    body.as_array()
        .unwrap()
        .iter()
        .map(|s| s["title"].as_str().unwrap().to_string())
        .collect()
}

/// 关键词同时匹配标题与署名；过滤后**每一条**都必须真的含关键词。
/// 不依赖全局总数——开发库可能有历史数据，只校验我自己造的谱是否被正确筛出。
#[tokio::test]
async fn search_matches_title_or_author() {
    let pool = common::test_pool().await;
    let app = router(pool.clone());
    let _a = create_score(&app, "PingSha", "Zhang", "zhengdiao").await;
    let _b = create_score(&app, "LiuShui", "Guan", "ruibin").await;
    let _c = create_score(&app, "YuQiao", "Zhang", "manjiao").await;

    // 关键词「Sha」：结果必须**全部**标题或署名含 Sha，且命中 PingSha、不命中 LiuShui
    let (status, body, _) = call(&app, "GET", "/api/v1/scores?q=Sha", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items.iter().all(|s| {
            let t = s["title"].as_str().unwrap().to_lowercase();
            let a = s["author"].as_str().unwrap_or_default().to_lowercase();
            t.contains("sha") || a.contains("sha")
        }),
        "搜索结果必须都含关键词：{body}"
    );
    let titles = titles_of(&body);
    assert!(
        titles.iter().any(|t| t == "PingSha"),
        "应命中 PingSha：{titles:?}"
    );
    assert!(
        !titles.iter().any(|t| t == "LiuShui"),
        "不应命中 LiuShui：{titles:?}"
    );

    // 署名「Zhang」：结果都含 Zhang，且我建的两首都在、Guan 的不在
    let (_, body2, _) = call(&app, "GET", "/api/v1/scores?q=Zhang", None, None).await;
    let items2 = body2.as_array().unwrap();
    assert!(
        items2.iter().all(|s| {
            let t = s["title"].as_str().unwrap().to_lowercase();
            let a = s["author"].as_str().unwrap_or_default().to_lowercase();
            t.contains("zhang") || a.contains("zhang")
        }),
        "署名搜索结果必须都含 Zhang：{body2}"
    );
    let titles2 = titles_of(&body2);
    assert!(titles2.iter().any(|t| t == "PingSha"));
    assert!(titles2.iter().any(|t| t == "YuQiao"));
    assert!(!titles2.iter().any(|t| t == "LiuShui"));

    // 不传 q：我建的三首都应出现（不依赖全局总数，开发库可能有历史数据）
    let (_, body3, _) = call(&app, "GET", "/api/v1/scores", None, None).await;
    let titles3 = titles_of(&body3);
    for t in ["PingSha", "LiuShui", "YuQiao"] {
        assert!(
            titles3.iter().any(|x| x == t),
            "未过滤列表应含 {t}：{titles3:?}"
        );
    }

    // 空关键词（空格）视为「不给」：等同不过滤，三首都还在
    let (_, body4, _) = call(&app, "GET", "/api/v1/scores?q=%20", None, None).await;
    let titles4 = titles_of(&body4);
    for t in ["PingSha", "LiuShui", "YuQiao"] {
        assert!(
            titles4.iter().any(|x| x == t),
            "空关键词应不过滤：{titles4:?}"
        );
    }

    sqlx::query("DELETE FROM scores WHERE title IN ('PingSha','LiuShui','YuQiao')")
        .execute(&pool)
        .await
        .ok();
}

/// 定弦过滤只留等于该值的谱；与关键词可组合；非法定弦直接 400 而非静默空结果。
#[tokio::test]
async fn tuning_filter_and_invalid_is_400() {
    let pool = common::test_pool().await;
    let app = router(pool.clone());
    let _a = create_score(&app, "ZhengDiaoQu", "A", "zhengdiao").await;
    let _b = create_score(&app, "RuiBinQu", "B", "ruibin").await;

    // tuning=ruibin：返回结果**全部**定弦为 ruibin，且我建的 RuiBinQu 在、ZhengDiaoQu 不在
    let (status, body, _) = call(&app, "GET", "/api/v1/scores?tuning=ruibin", None, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .all(|s| s["tuning"].as_str().unwrap() == "ruibin"),
        "定弦过滤必须都返回 ruibin：{body}"
    );
    let titles = titles_of(&body);
    assert!(
        titles.iter().any(|t| t == "RuiBinQu"),
        "应含 RuiBinQu：{titles:?}"
    );
    assert!(
        !titles.iter().any(|t| t == "ZhengDiaoQu"),
        "不应含 ZhengDiaoQu：{titles:?}"
    );

    // 与关键词组合：ruibin + 署名 B，定弦过滤仍正确
    let (_, body2, _) = call(&app, "GET", "/api/v1/scores?tuning=ruibin&q=B", None, None).await;
    let items2 = body2.as_array().unwrap();
    assert!(
        items2
            .iter()
            .all(|s| s["tuning"].as_str().unwrap() == "ruibin"),
        "组合过滤定弦仍正确：{body2}"
    );
    let titles2 = titles_of(&body2);
    assert!(titles2.iter().any(|t| t == "RuiBinQu"));

    // 非法定弦：400，而不是静默返回空（避免「以为筛了其实没筛」）
    let (status_bad, body_bad, _) =
        call(&app, "GET", "/api/v1/scores?tuning=bogus", None, None).await;
    assert_eq!(
        status_bad,
        StatusCode::BAD_REQUEST,
        "非法定弦应 400：{body_bad}"
    );

    sqlx::query("DELETE FROM scores WHERE title IN ('ZhengDiaoQu','RuiBinQu')")
        .execute(&pool)
        .await
        .ok();
}
