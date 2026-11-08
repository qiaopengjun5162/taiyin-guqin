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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    async fn unpack(err: AppError) -> (StatusCode, serde_json::Value) {
        let resp = err.into_response();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn database_error_maps_to_500_without_leaking_details() {
        let db = sqlx::Error::RowNotFound;
        let (status, body) = unpack(AppError::Database(db)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        // 对外只给固定文案，不把 SQL/连接串细节带出去
        assert_eq!(body, serde_json::json!({"error": "Internal server error"}));
    }

    #[tokio::test]
    async fn not_found_maps_to_404() {
        let (status, body) = unpack(AppError::NotFound).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, serde_json::json!({"error": "Not found"}));
    }

    #[tokio::test]
    async fn client_errors_carry_their_messages() {
        // JSON body 给裸消息（状态码已表达语义）；Display 的前缀只用于日志
        let cases = [
            (
                AppError::Validation("bad input".into()),
                StatusCode::BAD_REQUEST,
                "bad input",
            ),
            (
                AppError::Forbidden("not yours".into()),
                StatusCode::FORBIDDEN,
                "not yours",
            ),
            (
                AppError::Unauthorized("login first".into()),
                StatusCode::UNAUTHORIZED,
                "login first",
            ),
            (
                AppError::Conflict("email taken".into()),
                StatusCode::CONFLICT,
                "email taken",
            ),
            (
                AppError::ServiceUnavailable("try later".into()),
                StatusCode::SERVICE_UNAVAILABLE,
                "try later",
            ),
        ];
        for (err, want_status, want_msg) in cases {
            assert!(
                err.to_string().ends_with(want_msg),
                "Display 尾部应含原始消息，方便日志检索"
            );
            let (status, body) = unpack(err).await;
            assert_eq!(status, want_status);
            assert_eq!(body, serde_json::json!({"error": want_msg}));
        }
    }

    #[test]
    fn app_error_is_send_so_handlers_can_await_across_it() {
        fn assert_send<T: Send>() {}
        assert_send::<AppError>();
        assert_send::<AppResult<u8>>();
    }
}
