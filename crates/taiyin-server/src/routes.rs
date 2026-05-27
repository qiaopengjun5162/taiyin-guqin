use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use serde_json::json;
use sqlx::PgPool;
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer};
use uuid::Uuid;

use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::models::{CreateScoreRequest, Score, ScoreListItem, UpdateScoreRequest};

const MAX_TITLE_LENGTH: usize = 200;

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/scores", post(create_score).get(list_scores))
        .route(
            "/api/v1/scores/{id}",
            get(get_score).put(update_score).delete(delete_score),
        )
        .layer(RequestBodyLimitLayer::new(5 * 1024 * 1024)) // 5 MB
        .layer(CorsLayer::permissive())
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
