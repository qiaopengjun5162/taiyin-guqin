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

    /// 无权修改 / 删除（不属于本凭证发布的曲谱）。
    #[error("{0}")]
    Forbidden(String),

    /// 需要登录（会话缺失 / 已过期 / 口令不对）。
    #[error("{0}")]
    Unauthorized(String),

    /// 资源冲突（如邮箱已被注册）。
    #[error("{0}")]
    Conflict(String),

    #[error("Service unavailable: {0}")]
    ServiceUnavailable(String),
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
            Self::Forbidden(msg) => (StatusCode::FORBIDDEN, msg),
            Self::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
            Self::Conflict(msg) => (StatusCode::CONFLICT, msg),
            Self::ServiceUnavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg),
        };

        (status, Json(json!({"error": message}))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
