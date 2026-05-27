use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Not found")]
    NotFound,

    #[error("{0}")]
    Validation(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::Database(e) => {
                tracing::error!(error = %e, "database error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".into(),
                )
            }
            Self::NotFound => (StatusCode::NOT_FOUND, "Not found".into()),
            Self::Validation(msg) => (StatusCode::BAD_REQUEST, msg),
        };

        (status, Json(json!({"error": message}))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
