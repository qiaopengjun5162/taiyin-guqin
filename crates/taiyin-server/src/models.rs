use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// 数据库行——一封存储的曲谱。
/// `notes` 以 JSONB 存储前端 `NoteColumn[]` 格式。
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Score {
    pub id: Uuid,
    pub title: String,
    pub notes: serde_json::Value,
    /// 定弦标识（`zhengdiao` / `ruibin` / `manjiao`）。
    /// 与 `notes` 里的减字一起才完整：减字只写「几弦几徽」，音高由定弦决定。
    pub tuning: String,
    /// 打谱人昵称；空串表示匿名（迁移前的老数据一律为空）。
    pub author: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 列表项——不包含 notes 全文以节省带宽。
#[derive(Debug, Serialize, FromRow)]
pub struct ScoreListItem {
    pub id: Uuid,
    pub title: String,
    pub tuning: String,
    /// 打谱人昵称；空串表示匿名。列表页要用它显示「某人的某谱」。
    pub author: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 创建曲谱请求。
#[derive(Debug, Deserialize)]
pub struct CreateScoreRequest {
    pub title: Option<String>,
    pub notes: serde_json::Value,
    /// 省略时落默认正调（与建表默认值一致）。
    pub tuning: Option<String>,
    /// 打谱人昵称；省略视为匿名发布。
    pub author: Option<String>,
}

/// 更新曲谱请求（所有字段可选，只更新提供项）。
#[derive(Debug, Deserialize)]
pub struct UpdateScoreRequest {
    pub title: Option<String>,
    pub notes: Option<serde_json::Value>,
    pub tuning: Option<String>,
    /// 省略则保留原署名；显式传空串等价于改回匿名。
    pub author: Option<String>,
}
