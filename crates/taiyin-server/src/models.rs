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
    /// 发布者凭证。**绝不序列化给客户端**：拿到它就能改 / 删这首谱，
    /// 泄露等于把关链接的人变成管理员。只在服务端校验时使用。
    #[serde(skip_serializing)]
    pub owner_token: Option<String>,
    /// 归属账号（登录用户发布或认领后写入）。与 `owner_token` 并存：
    /// 老凭证路径完全不受影响，登录用户凭登录态即可跨设备改删自己的谱。
    pub owner_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// 是否已被管理员下架（库里存的是 `hidden_at` 时间戳，这里只暴露布尔）。
    ///
    /// 下架的谱**不进公开列表**；单条读接口仍对「谱主」和「管理员」可见，
    /// 否则谱主只会看到自己的谱凭空消失，既不知道为什么，也没法改好再申请恢复。
    pub hidden: bool,
}

/// 列表项——不包含 notes 全文以节省带宽。
#[derive(Debug, Serialize, FromRow)]
pub struct ScoreListItem {
    pub id: Uuid,
    pub title: String,
    pub tuning: String,
    /// 打谱人昵称；空串表示匿名。列表页要用它显示「某人的某谱」。
    pub author: String,
    /// 归属账号；前端拿它与「我」比对，决定要不要显示改 / 删按钮。
    pub owner_user_id: Option<Uuid>,
    /// 收藏数（热度）。列表「按热度排序」直接读这一列，不实时 COUNT。
    pub favorites_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 管理端「被举报的谱」行。
///
/// 只给管理员看，所以带上 `reports_count` 与 `hidden_at`：
/// 先看谁被举报得最多，再看是否已经处理过（已下架的仍在列表里，避免重复处理）。
#[derive(Debug, Serialize, FromRow)]
pub struct ReportedScore {
    pub id: Uuid,
    pub title: String,
    pub author: String,
    /// 不同举报者人数（主键去重后的行数，不是举报次数）。
    pub reports_count: i64,
    /// 已下架的时间；`null` 表示还没处理。
    pub hidden_at: Option<DateTime<Utc>>,
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

/// 账号（数据库行）。`password_hash` 绝不序列化给客户端。
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    /// Argon2id 散列串（含盐）。**不序列化**：泄露即等于交出入口令验证能力。
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
}

/// 可安全下发的账号信息。
#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
}

/// 注册请求。
#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    /// 省略即匿名（空昵称）。
    pub display_name: Option<String>,
}

/// 登录请求。
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

/// 管理端：给指定邮箱重置口令（过渡版「找回」——自助找回要等邮件通道）。
#[derive(Debug, Deserialize)]
pub struct AdminResetPasswordRequest {
    pub email: String,
    /// 省略则服务端生成一次性口令并在响应里回显**一次**，由管理员转告本人。
    /// 回显一次是刻意的：服务端只存 Argon2 散列，明文口令过了这村没这店。
    pub new_password: Option<String>,
}
