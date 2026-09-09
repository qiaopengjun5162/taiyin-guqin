use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderValue, Method},
    middleware::from_fn_with_state,
    routing::{get, post},
};
use serde_json::json;
use sqlx::PgPool;
use std::sync::Arc;
use tower_governor::{
    GovernorLayer, governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor,
};
use tower_http::{
    cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
};
use uuid::Uuid;

use crate::auth::require_api_key;
use crate::config::ServerConfig;
use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::llm::{
    RecognizeRequest, RecognizeResponse, RecognizeSheetResponse, SelectRequest, SelectResponse,
    heuristic_selections, recognize_jianzi_with_llm, recognize_sheet_with_llm, select_with_llm,
};
use crate::models::{CreateScoreRequest, Score, ScoreListItem, UpdateScoreRequest};

const MAX_TITLE_LENGTH: usize = 200;

/// 构造 CORS 层。
///
/// - `allowed` 为空：开发态放开（`permissive`），并在 `main` 中记录 warning。
/// - `allowed` 非空：仅允许列出的来源（生产应配置 `ALLOWED_ORIGINS`）。
fn build_cors(allowed: &[String]) -> CorsLayer {
    if allowed.is_empty() {
        return CorsLayer::permissive();
    }
    let origins: Vec<HeaderValue> = allowed
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods(AllowMethods::list([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
        ]))
        .allow_headers(AllowHeaders::list([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::HeaderName::from_static("x-api-key"),
        ]))
}

pub fn app(state: AppState, config: &ServerConfig) -> Router {
    let cors = build_cors(&config.allowed_origins);

    // 翻译端点：独立严格限流（per-IP）+ 可选 API-key 闸门。
    // 该端点直接消耗服务端 Anthropic 额度，是成本敞口最大的地方。
    let translate_limiter = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor)
            .per_second(config.translate_per_second)
            .burst_size(config.translate_burst)
            .use_headers()
            .finish()
            .expect("translate rate config must be valid"),
    );
    let translate_key: Option<Arc<str>> = config.translate_api_key.as_deref().map(Arc::from);

    let translate_routes = Router::new()
        .route("/api/v1/translate/select", post(select_candidates))
        .route("/api/v1/jianzi/recognize", post(recognize_jianzi))
        .route("/api/v1/jianzi/recognize-sheet", post(recognize_sheet))
        .route_layer(GovernorLayer::new(translate_limiter))
        .route_layer(from_fn_with_state(translate_key, require_api_key));

    Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/scores", post(create_score).get(list_scores))
        .route(
            "/api/v1/scores/{id}",
            get(get_score).put(update_score).delete(delete_score),
        )
        .merge(translate_routes)
        .layer(RequestBodyLimitLayer::new(5 * 1024 * 1024)) // 5 MB
        .layer(cors)
        .with_state(state)
}

async fn fetch_score(pool: &PgPool, id: Uuid) -> AppResult<Score> {
    sqlx::query_as::<_, Score>(
        "SELECT id, title, notes, created_at, updated_at FROM scores WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

fn validate_title(title: &str) -> AppResult<()> {
    if title.len() > MAX_TITLE_LENGTH {
        Err(AppError::Validation(format!(
            "标题不能超过 {MAX_TITLE_LENGTH} 字"
        )))
    } else {
        Ok(())
    }
}

async fn health_check() -> &'static str {
    "🪕 taiyin ok"
}

/// AI 候选选择：生成各音候选后交 LLM 择优；未配置或失败时回退启发式 top1。
async fn select_candidates(
    State(state): State<AppState>,
    Json(req): Json<SelectRequest>,
) -> AppResult<Json<SelectResponse>> {
    let tuning = req.tuning.unwrap_or(taiyin_core::jianpu::Tuning::ZhengDiao);
    let candidates = taiyin_core::jianpu::translate_jianpu_sequence(&req.notes, tuning);

    let (method, selections) =
        match select_with_llm(&state.llm, &req.notes, tuning, &candidates).await {
            Ok(Some(sels)) => ("llm", sels),
            Ok(None) => ("heuristic", heuristic_selections(&candidates)),
            Err(e) => {
                tracing::warn!("llm selection failed, falling back to heuristic: {e}");
                ("heuristic", heuristic_selections(&candidates))
            }
        };

    Ok(Json(SelectResponse { method, selections }))
}

/// 减字谱单字图像识别：图片经 Claude 多模态识别为规范减字文本；未配置密钥时返回 503。
async fn recognize_jianzi(
    State(state): State<AppState>,
    Json(req): Json<RecognizeRequest>,
) -> AppResult<Json<RecognizeResponse>> {
    // 仅放行常见图片类型，避免向 Anthropic 透传任意 media_type。
    let media_type = req.media_type.as_str();
    if !matches!(media_type, "image/jpeg" | "image/png" | "image/webp") {
        return Err(AppError::Validation(
            "不支持的图片类型，仅支持 jpeg/png/webp".into(),
        ));
    }
    if req.image_base64.is_empty() {
        return Err(AppError::Validation("缺少图片数据".into()));
    }

    match recognize_jianzi_with_llm(&state.llm, &req.image_base64, media_type).await {
        Ok(Some(resp)) => Ok(Json(resp)),
        Ok(None) => Err(AppError::ServiceUnavailable(
            "LLM 未配置（缺少 ANTHROPIC_API_KEY）".into(),
        )),
        Err(e) => {
            tracing::warn!("jianzi recognition failed: {e}");
            Err(AppError::ServiceUnavailable(format!("识别失败：{e}")))
        }
    }
}

/// 整页减字谱图像识别：图片经 Claude 多模态识别为若干减字文本（按网格坐标排布）；未配置密钥时返回 503。
async fn recognize_sheet(
    State(state): State<AppState>,
    Json(req): Json<RecognizeRequest>,
) -> AppResult<Json<RecognizeSheetResponse>> {
    // 与单字识别一致的媒体类型/空数据校验
    let media_type = req.media_type.as_str();
    if !matches!(media_type, "image/jpeg" | "image/png" | "image/webp") {
        return Err(AppError::Validation(
            "不支持的图片类型，仅支持 jpeg/png/webp".into(),
        ));
    }
    if req.image_base64.is_empty() {
        return Err(AppError::Validation("缺少图片数据".into()));
    }

    match recognize_sheet_with_llm(&state.llm, &req.image_base64, media_type).await {
        Ok(Some(resp)) => Ok(Json(resp)),
        Ok(None) => Err(AppError::ServiceUnavailable(
            "LLM 未配置（缺少 ANTHROPIC_API_KEY）".into(),
        )),
        Err(e) => {
            tracing::warn!("jianzi sheet recognition failed: {e}");
            Err(AppError::ServiceUnavailable(format!("识别失败：{e}")))
        }
    }
}

async fn create_score(
    State(state): State<AppState>,
    Json(req): Json<CreateScoreRequest>,
) -> AppResult<Json<Score>> {
    let title = req.title.unwrap_or_else(|| "未命名曲谱".to_string());
    validate_title(&title)?;

    let score = sqlx::query_as::<_, Score>(
        "INSERT INTO scores (title, notes) VALUES ($1, $2) \
         RETURNING id, title, notes, created_at, updated_at",
    )
    .bind(&title)
    .bind(&req.notes)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(score))
}

async fn list_scores(State(state): State<AppState>) -> AppResult<Json<Vec<ScoreListItem>>> {
    let scores = sqlx::query_as::<_, ScoreListItem>(
        "SELECT id, title, created_at, updated_at FROM scores ORDER BY updated_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(scores))
}

async fn get_score(State(state): State<AppState>, Path(id): Path<Uuid>) -> AppResult<Json<Score>> {
    let score = fetch_score(&state.pool, id).await?;
    Ok(Json(score))
}

async fn update_score(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateScoreRequest>,
) -> AppResult<Json<Score>> {
    let existing = fetch_score(&state.pool, id).await?;

    let title = req.title.unwrap_or(existing.title);
    validate_title(&title)?;
    let notes = req.notes.unwrap_or(existing.notes);

    let score = sqlx::query_as::<_, Score>(
        "UPDATE scores SET title = $1, notes = $2, updated_at = now() WHERE id = $3 \
         RETURNING id, title, notes, created_at, updated_at",
    )
    .bind(&title)
    .bind(&notes)
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(score))
}

async fn delete_score(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let result = sqlx::query("DELETE FROM scores WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(json!({"deleted": true})))
}
