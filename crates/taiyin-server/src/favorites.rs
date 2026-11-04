//! # 收藏夹
//!
//! ## 为什么需要它
//!
//! 社区此前只有「列表 + 按曲名搜索」：谱一多，找到一首好谱之后下次还得重新翻——
//! 搜索要记得标题，翻页要记得大概位置。收藏给的是一条**稳定的短列表**，
//! 也是注册账号之后第一个能立刻感受到的好处（而不只是「换设备还能改删自己的谱」）。
//!
//! ## 为什么必须有账号
//!
//! 本机凭证（`x-owner-token`）是「这台设备的钥匙」，不是人。拿它当收藏主体，
//! 等于清个缓存收藏就全丢——与收藏的语义正好相反。所以这里的每条接口都要求
//! 登录态；没登录一律 401，而不是退化成「只存在本地」。
//!
//! ## 幂等
//!
//! 收藏 = `INSERT ... ON CONFLICT DO NOTHING`，取消 = `DELETE`。
//! 两者对重复调用都返回成功：用户双击、网络重试都不会看到「已经收藏过了」这种
//! 让人困惑的报错。取消收藏对没收藏过的谱也返回成功，同理。

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue},
    response::IntoResponse,
};
use serde::Serialize;
use uuid::Uuid;

use crate::accounts;
use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::models::ScoreListItem;
use crate::routes::{DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, TOTAL_COUNT_HEADER};

/// 分页参数。与社区列表同一套夹紧规则（负数 offset 夹到 0、limit 夹进 [1, 200]）。
#[derive(Debug, serde::Deserialize)]
pub struct PageQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

/// 单条收藏状态。
#[derive(Debug, Serialize)]
pub struct FavoriteState {
    pub favorited: bool,
}

/// 当前用户收藏的全部曲谱 id。
#[derive(Debug, Serialize)]
pub struct FavoriteIds {
    pub ids: Vec<Uuid>,
}

/// 要求登录，返回当前用户 id。
///
/// 错误信息要解释**为什么**要登录：只写「Unauthorized」的话，
/// 用户会以为是登录过期了，跑去重新登录一遍还是失败。
async fn require_user(headers: &HeaderMap, pool: &sqlx::PgPool) -> AppResult<Uuid> {
    accounts::current_user(headers, pool)
        .await?
        .map(|u| u.id)
        .ok_or_else(|| AppError::Unauthorized("收藏需要登录：收藏跟着账号走，换设备也在".into()))
}

/// 收藏一首谱（幂等）。
pub async fn favorite_score(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<FavoriteState>> {
    let user_id = require_user(&headers, &state.pool).await?;

    // 谱不存在时给 404，而不是让它「收藏成功」：外键会把不存在的 id 拒掉，
    // 但那样报出来的是 500 数据库错误；而且前端更需要知道「这首谱没了」。
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM scores WHERE id = $1)")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    if !exists {
        return Err(AppError::NotFound);
    }

    // 收 / 取消时在同一条语句里维护计数器：用 CTE 把「本次到底插没插进去」
    // 记下来，再按这个实际增量去改 scores.favorites_count。
    // ON CONFLICT DO NOTHING 命中时不插、计数 +0（已收过也是 +0），
    // 幂等性天然成立，不会因重复点击把计数撑大。
    sqlx::query(
        "WITH ins AS (
            INSERT INTO favorites (user_id, score_id) VALUES ($1, $2)
            ON CONFLICT (user_id, score_id) DO NOTHING
            RETURNING 1
         )
         UPDATE scores SET favorites_count = favorites_count + (SELECT count(*) FROM ins)
         WHERE id = $2",
    )
    .bind(user_id)
    .bind(id)
    .execute(&state.pool)
    .await?;

    Ok(Json(FavoriteState { favorited: true }))
}

/// 取消收藏（幂等）。没收藏过也返回成功。
pub async fn unfavorite_score(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<FavoriteState>> {
    let user_id = require_user(&headers, &state.pool).await?;

    // 与收藏对称：用 CTE 把「本次到底删没删掉」记下来，再按实际减量改计数器。
    // GREATEST(0, ...) 兜底，防并发竞态下计数变负（理论上不会，但宁可保守）。
    // 谱已不存在时 DELETE/UPDATE 都影响 0 行，.execute 不报错，仍返回成功——
    // 取消一个没收藏过的谱本就该是幂等的。
    sqlx::query(
        "WITH del AS (
            DELETE FROM favorites WHERE user_id = $1 AND score_id = $2
            RETURNING 1
         )
         UPDATE scores SET favorites_count = GREATEST(0, favorites_count - (SELECT count(*) FROM del))
         WHERE id = $2",
    )
    .bind(user_id)
    .bind(id)
    .execute(&state.pool)
    .await?;

    Ok(Json(FavoriteState { favorited: false }))
}

/// 我的收藏（分页，按收藏时间倒序）。
///
/// 排序用 `f.created_at DESC` 而不是 `s.updated_at`：用户心里的顺序是
/// 「我什么时候收的」，不是「作者什么时候改的」——刚收的应该在最上面。
/// 末尾补 `s.id` 做稳定的并列次序，否则同一毫秒收的几条在翻页时可能重复或漏掉。
pub async fn list_favorites(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<PageQuery>,
) -> AppResult<impl IntoResponse> {
    let user_id = require_user(&headers, &state.pool).await?;
    let limit = q.limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    let offset = q.offset.unwrap_or(0).max(0);

    let scores = sqlx::query_as::<_, ScoreListItem>(
        "SELECT s.id, s.title, s.tuning, s.author, s.owner_user_id, s.favorites_count, s.created_at, s.updated_at \
         FROM favorites f JOIN scores s ON s.id = f.score_id \
         WHERE f.user_id = $1 \
         ORDER BY f.created_at DESC, s.id \
         LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    // 总数单独查：`count(*) OVER ()` 在越界页会随「零行」一起消失，
    // 而前端正是靠总数判断「还有没有下一批」。
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM favorites WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;

    let mut out = HeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(&total.to_string()) {
        out.insert(TOTAL_COUNT_HEADER, value);
    }

    Ok((out, Json(scores)))
}

/// 当前用户收藏的 id 集合。
///
/// 列表页要给每行画「已收藏 / 未收藏」的星标，逐行去问会变成 N 次请求；
/// 一次拿全量 id 在客户端比对最省事。只返回 id，不含标题等内容，
/// 几百条也就十几 KB，比再设计一个「批量查状态」的接口简单得多。
pub async fn favorite_ids(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<FavoriteIds>> {
    let user_id = require_user(&headers, &state.pool).await?;

    let ids = sqlx::query_scalar::<_, Uuid>("SELECT score_id FROM favorites WHERE user_id = $1")
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;

    Ok(Json(FavoriteIds { ids }))
}
