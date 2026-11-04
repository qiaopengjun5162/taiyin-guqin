use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, HeaderValue, Method},
    middleware::from_fn_with_state,
    response::IntoResponse,
    routing::{get, post, put},
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

use crate::accounts;
use crate::auth::require_api_key;
use crate::config::ServerConfig;
use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::favorites;
use crate::llm::{
    LlmConfig, RecognizeRequest, RecognizeResponse, RecognizeSheetCell, RecognizeSheetResponse,
    SelectRequest, SelectResponse, heuristic_selections, recognize_jianzi_with_llm,
    recognize_sheet_with_llm, select_with_llm,
};
use crate::models::{
    AdminResetPasswordRequest, CreateScoreRequest, LoginRequest, PublicUser, RegisterRequest,
    ReportedScore, Score, ScoreListItem, UpdateScoreRequest, User,
};
use crate::sheet_segment;
use crate::template_match::{self, RecognizeMode};

const MAX_TITLE_LENGTH: usize = 200;
/// 署名上限：留足「某某琴社·某某」这类写法，又不至于把列表撑爆。
const MAX_AUTHOR_LENGTH: usize = 40;
/// 发布者凭证的请求头。前端首发布时生成，之后改 / 删都要带上同一个值。
const OWNER_TOKEN_HEADER: &str = "x-owner-token";
/// 凭证长度上限：UUID 是 36，留足余量但不接受任意长串（避免把 header 当存储用）。
const MAX_OWNER_TOKEN_LENGTH: usize = 128;
/// 管理员口令的请求头。
const ADMIN_TOKEN_HEADER: &str = "x-admin-token";
/// 列表默认一页条数：一次能滚完、又不至于让首屏拉几百条。
pub(crate) const DEFAULT_PAGE_SIZE: i64 = 50;
/// 单页硬上限：没有它，`?limit=1000000` 就是一条把整库拖出来的捷径。
pub(crate) const MAX_PAGE_SIZE: i64 = 200;
/// 列表总条数的响应头。分页必须同时给出总数，否则「还有几首没显示」无从判断。
pub(crate) const TOTAL_COUNT_HEADER: &str = "x-total-count";

/// 构造 CORS 层。
///
/// - `allowed` 为空：开发态放开（`permissive`），并在 `main` 中记录 warning。
/// - `allowed` 非空：仅允许列出的来源（生产应配置 `ALLOWED_ORIGINS`）。
fn build_cors(allowed: &[String]) -> CorsLayer {
    // 限流响应头必须显式暴露，否则跨域下浏览器会把它们藏起来：
    // 前端只能看到一句英文 "Too Many Requests"，说不出「还要等几秒」，
    // 用户只能盲目重试、越试等得越久。
    let expose = [
        axum::http::HeaderName::from_static("retry-after"),
        axum::http::HeaderName::from_static("x-ratelimit-after"),
        axum::http::HeaderName::from_static("x-ratelimit-limit"),
        axum::http::HeaderName::from_static("x-ratelimit-remaining"),
        // 分页总数：不暴露的话前端读不到，只能「翻到空页才知道到底了」
        axum::http::HeaderName::from_static(TOTAL_COUNT_HEADER),
    ];

    if allowed.is_empty() {
        return CorsLayer::permissive().expose_headers(expose);
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
            // 所有权凭证：不加进白名单的话，浏览器跨域预检会直接拦掉，
            // 表现是「发布能成、改删必失败」，且只报 CORS 错误、看不出真正原因。
            axum::http::HeaderName::from_static(OWNER_TOKEN_HEADER),
            // 管理员口令：目前管理端用 curl 调，但留一个浏览器直调的余地，
            // 否则将来做管理页时会踩同一个「预检被拦」的坑。
            axum::http::HeaderName::from_static(ADMIN_TOKEN_HEADER),
        ]))
        .expose_headers(expose)
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

    // 认证端点：独立严格限流，与全局限流**叠加**（两者都要过）。
    //
    // 全局限流管的是「整体别把服务刷垮」，管不住这一条：口令散列是**故意慢**的
    // （Argon2id 每次数百毫秒），攻击者只要在全局 burst 窗口里连发几十个注册请求，
    // 就能让单核 VPS 的 CPU 满载、正常用户全部超时。这是「用正常功能当放大器」，
    // 开销比普通请求高三个数量级，必须单独设卡。
    //
    // 同时它也是撞库的唯一入口：per-IP 严格限流让在线爆破变得不划算。
    let auth_limiter = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor)
            .per_second(config.auth_per_second)
            .burst_size(config.auth_burst)
            // 刻意不开 `use_headers()`：两层限流同时写 `x-ratelimit-limit` 会互相覆盖，
            // 表现是正常响应里写着「上限 200」（全局的），可实际第 9 次登录就被挡了——
            // 数字自相矛盾比没有数字更让人困惑。`retry-after` 默认就会带，够前端用了。
            .finish()
            .expect("auth rate config must be valid"),
    );

    let auth_routes = Router::new()
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route_layer(GovernorLayer::new(auth_limiter));

    // `/auth/me` 刻意**不进**认证限流组：它是只读的，没有口令散列开销，
    // 却是前端每次打开页面校验登录态要走的接口。一旦它被限流，前端会把它
    // 当成「会话失效」而清掉登录态——用户会莫名其妙被登出，这比被刷几次糟得多。
    let me_route = Router::new().route("/api/v1/auth/me", get(me));

    // 发布端点：独立限流（只挂在 POST 上，读列表不受影响）。
    //
    // 发布是写库操作，是全站唯一「一个请求换一行数据」的口子。没有它，
    // 一台机器循环 `curl -d` 就能把社区列表灌满，正常人翻十页看到的都是垃圾。
    // 挂载方式注意：`route_layer` 只覆盖**当前已注册的** method，所以必须先
    // `post(...)` 再 `route_layer`，最后才 `.get(...)`——顺序反了，GET 列表
    // 会一起进限流池，翻页翻到一半就 429。
    let write_limiter = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor)
            .per_second(config.write_per_second)
            .burst_size(config.write_burst)
            // 与认证层同理：不开 `use_headers()`，避免和全局限流互相覆盖数字。
            .finish()
            .expect("write rate config must be valid"),
    );
    let scores_collection = post(create_score)
        .route_layer(GovernorLayer::new(write_limiter))
        .get(list_scores);

    // 发布配额：与限流互补的**存量**闸门（限流管每秒几次，配额管一共能有几首）。
    let publish_quota = PublishQuota {
        per_account: config.publish_quota_per_account,
        per_device: config.publish_quota_per_device,
    };
    let admin_auth = AdminAuth(config.admin_token.as_deref().map(Arc::from));

    let translate_routes = Router::new()
        .route("/api/v1/translate/select", post(select_candidates))
        .route("/api/v1/jianzi/recognize", post(recognize_jianzi))
        .route("/api/v1/jianzi/recognize-sheet", post(recognize_sheet))
        .route_layer(GovernorLayer::new(translate_limiter))
        .route_layer(from_fn_with_state(translate_key, require_api_key));

    Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/scores", scores_collection)
        .route(
            "/api/v1/scores/{id}",
            get(get_score).put(update_score).delete(delete_score),
        )
        // 认领：把「本机凭证」发布的旧谱挂到账号下（必须出示原凭证）
        .route("/api/v1/scores/{id}/claim", post(claim_score))
        // 举报（需登录）：只记录，不自动下架——理由见 migrations/008
        .route("/api/v1/scores/{id}/report", post(report_score))
        // 管理端：全部走 x-admin-token，未配置 ADMIN_TOKEN 时整体 503
        .route("/api/v1/admin/reported", get(list_reported))
        .route("/api/v1/admin/scores/{id}/hide", post(hide_score))
        .route("/api/v1/admin/scores/{id}/restore", post(restore_score))
        // 过渡版「找回口令」：管理员给指定邮箱设新口令，并踢掉其全部会话
        .route(
            "/api/v1/admin/users/reset-password",
            post(admin_reset_password),
        )
        // 收藏：跟账号走，故三条都要求登录态（见 `favorites.rs`）
        .route(
            "/api/v1/scores/{id}/favorite",
            put(favorites::favorite_score).delete(favorites::unfavorite_score),
        )
        .route("/api/v1/favorites", get(favorites::list_favorites))
        .route("/api/v1/favorites/ids", get(favorites::favorite_ids))
        // 认证端点带自己的限流层；路径与其它组不重叠，merge 不会冲突。
        .merge(auth_routes)
        .merge(me_route)
        .merge(translate_routes)
        .layer(RequestBodyLimitLayer::new(5 * 1024 * 1024)) // 5 MB
        .layer(cors)
        .layer(Extension(publish_quota))
        .layer(Extension(admin_auth))
        .with_state(state)
}

async fn fetch_score(pool: &PgPool, id: Uuid) -> AppResult<Score> {
    sqlx::query_as::<_, Score>(
        "SELECT id, title, notes, tuning, author, owner_token, owner_user_id, created_at, updated_at, \
                (hidden_at IS NOT NULL) AS hidden \
         FROM scores WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// 从请求头读取发布者凭证。缺失、非法编码、空白或超长都视为「没带」。
fn read_owner_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(OWNER_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty() && v.len() <= MAX_OWNER_TOKEN_LENGTH)
        .map(str::to_string)
}

/// 一次请求里「我是谁」的全部凭据：登录态（可选）+ 本机凭证（可选）。
///
/// 两者是**并列的两条腿**，不是二选一：老用户没注册过，仍靠本机凭证改删；
/// 注册并认领之后，换设备、清缓存都不再失去自己的谱。
#[derive(Debug, Default)]
struct Caller {
    /// 当前登录账号（由 `Authorization: Bearer <session>` 解析而来）。
    user_id: Option<Uuid>,
    /// 本机持有的发布者凭证（`x-owner-token`）。
    owner_token: Option<String>,
}

/// 从请求头还原调用者身份。会话查库（要能吊销），凭证只读头。
async fn read_caller(headers: &HeaderMap, pool: &PgPool) -> AppResult<Caller> {
    let user = accounts::current_user(headers, pool).await?;
    Ok(Caller {
        user_id: user.map(|u| u.id),
        owner_token: read_owner_token(headers),
    })
}

/// 发布配额策略。由 `app()` 从配置塞进请求扩展。
///
/// 用 `Extension` 而不是加进 `AppState`：配额是**策略**，和连接池、LLM 配置
/// 这类资源不是一类东西；而且 `AppState` 一加字段，所有测试里的结构体字面量
/// 都要跟着改一遍——为一个只在一处用到的数改十几个文件不划算。
#[derive(Clone, Copy, Debug)]
struct PublishQuota {
    per_account: i64,
    per_device: i64,
}

/// 数「这个身份已经占了多少行」。
///
/// 两个条件都走占位符，并且刻意合并成**一条**查询：登录用户既数账号名下的谱，
/// 也数这台设备还没认领的谱。分成两条 SQL 容易只更新一条，症状是
/// 「登录之后额度突然翻倍」——不会报错，只会绕开闸门。
///
/// 被数到的集合必须是「这个身份删得掉的集合」的子集。否则有人把额度用满之后
/// 连自己腾地方都做不到，只能等管理员进库删行——那等于把配额做成了封号。
const PUBLISHED_COUNT_SQL: &str = "\
SELECT count(*) FROM scores \
WHERE ($1::uuid IS NOT NULL AND owner_user_id = $1) \
   OR ($2::text IS NOT NULL AND owner_user_id IS NULL AND owner_token = $2)";

/// 在事务里检查并「预留」一个发布位；超额直接 409。
///
/// 必须是事务（`pg_advisory_xact_lock` + 计数 + 插入同进同出）：
/// 只把计数放在插入之前，两个并发请求会同时数到 `limit - 1`，然后一起插进去。
/// 锁的粒度是**身份**，不是全表：两个不同用户发谱互不阻塞。
async fn reserve_publish_slot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    caller: &Caller,
    quota: PublishQuota,
) -> AppResult<()> {
    // 有登录态就按账号算，否则按本机凭证算——与 `ensure_can_edit` 认的两种身份一致。
    let by_account = caller.user_id.is_some();
    let limit = if by_account {
        quota.per_account
    } else {
        quota.per_device
    };

    let lock_key = match (caller.user_id, caller.owner_token.as_deref()) {
        (Some(id), _) => format!("taiyin:quota:user:{id}"),
        (None, Some(token)) => format!("taiyin:quota:device:{token}"),
        // 调用方保证「至少有一条腿」；真走到这里当未授权处理，不 panic。
        (None, None) => {
            return Err(AppError::Unauthorized("发布到社区需要发布者身份".into()));
        }
    };
    // `hashtextextended` 把身份串压成一个 bigint 锁号；第二个参数是种子，固定 0。
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&lock_key)
        .execute(&mut **tx)
        .await?;

    let used: i64 = sqlx::query_scalar(PUBLISHED_COUNT_SQL)
        .bind(caller.user_id)
        .bind(caller.owner_token.as_deref())
        .fetch_one(&mut **tx)
        .await?;

    if used < limit {
        return Ok(());
    }

    // 文案里必须带上「怎么解开」。一句干巴巴的「超出配额」会让人以为服务坏了，
    // 而实际上这是唯一一条**用户自己就能解除**的限制：删掉旧谱即可。
    //
    // 措辞用「已有」而不是「已发布」：这个端点在界面上就是「保存」，
    // 而保存即入库、进而出现在社区列表里。同一句提示要同时读得通。
    Err(AppError::Conflict(if by_account {
        format!(
            "你在社区已有 {used} 首，达到账号上限（{limit} 首）。\
             删掉几首旧谱就能继续。"
        )
    } else {
        format!(
            "这台设备在社区已有 {used} 首，达到未登录上限（{limit} 首）。\
             登录后每个账号可存 {} 首，也可以先删掉几首旧谱。",
            quota.per_account
        )
    }))
}

/// 管理员口令（从配置塞进请求扩展）。`None` = 管理端未启用。
#[derive(Clone, Debug)]
struct AdminAuth(Option<Arc<str>>);

/// 常数时间比较，避免「按字节提前返回」泄露口令前缀。
///
/// 一次 HTTP 往返的抖动远大于单字节比较的差异，理论上这条攻击很难真跑通；
/// 但常数时间比较只多几行代码，没有理由留一个「理论上」。
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    diff == 0
}

/// 这次请求是不是管理员。
fn is_admin(headers: &HeaderMap, admin: &AdminAuth) -> bool {
    let Some(expected) = admin.0.as_deref() else {
        return false;
    };
    headers
        .get(ADMIN_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|provided| constant_time_eq(provided.trim(), expected))
}

/// 管理端闸门。
///
/// 未配置口令时返回 503 而不是 404：这台机器就是**没有**管理入口，
/// 与其让维护者以为「路径写错了」翻半天，不如直说没开。
fn require_admin(headers: &HeaderMap, admin: &AdminAuth) -> AppResult<()> {
    if admin.0.is_none() {
        return Err(AppError::ServiceUnavailable(
            "管理端未启用：请设置 ADMIN_TOKEN 环境变量后重启服务".into(),
        ));
    }
    if !is_admin(headers, admin) {
        return Err(AppError::Unauthorized("管理员口令不正确".into()));
    }
    Ok(())
}

/// 举报一首谱（需登录）。
///
/// 只记「谁举报了什么」，**不自动下架**——理由见迁移 008：注册不需要邮箱验证，
/// 自动下架等于给攻击者一个「三个小号删任何谱」的开关。
async fn report_score(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    // 举报必须登录：本机凭证是设备钥匙，存进举报表等于把改删凭据多存一份（见迁移注释）。
    let Some(user) = accounts::current_user(&headers, &state.pool).await? else {
        return Err(AppError::Unauthorized(
            "举报需要登录：匿名举报无法去重，也无法追溯".into(),
        ));
    };

    let score = fetch_score(&state.pool, id).await?;
    // 已下架的谱不再接受举报：已经处理过了，再报只是往表里灌重复数据。
    if score.hidden {
        return Err(AppError::NotFound);
    }
    if score.owner_user_id == Some(user.id) {
        return Err(AppError::Validation(
            "这是你自己的谱。想删除请用「删除」，不必举报".into(),
        ));
    }

    // `ON CONFLICT DO NOTHING` + 检查 rows_affected 一次搞定「是否重复举报」：
    // 不用先 SELECT 再 INSERT，也就没有「查的时候没有、插的时候有了」的竞态。
    let inserted = sqlx::query(
        "INSERT INTO score_reports (user_id, score_id) VALUES ($1, $2) \
         ON CONFLICT (user_id, score_id) DO NOTHING",
    )
    .bind(user.id)
    .bind(id)
    .execute(&state.pool)
    .await?
    .rows_affected()
        > 0;

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM score_reports WHERE score_id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(json!({"reported": inserted, "reports_count": count})))
}

/// 管理端：按被举报数排序的曲谱列表。
async fn list_reported(
    State(state): State<AppState>,
    Extension(admin): Extension<AdminAuth>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<ReportedScore>>> {
    require_admin(&headers, &admin)?;

    let rows = sqlx::query_as::<_, ReportedScore>(
        "SELECT s.id, s.title, s.author, count(r.user_id) AS reports_count, \
                s.hidden_at, s.updated_at \
         FROM scores s JOIN score_reports r ON r.score_id = s.id \
         GROUP BY s.id \
         ORDER BY reports_count DESC, s.updated_at DESC \
         LIMIT 100",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

/// 管理端：下架 / 恢复。
///
/// 两个动作合成一个函数：它们只差 `hidden_at` 的取值，分开写会多出一份
/// 「取行、判断存在、更新」的重复代码——而重复代码最怕的就是只改了一处。
async fn set_hidden(pool: &PgPool, id: Uuid, hidden: bool) -> AppResult<Json<serde_json::Value>> {
    // `hidden_at = CASE WHEN $2 THEN COALESCE(hidden_at, now()) ELSE NULL END`：
    // 重复下架不刷新时间戳（保留「第一次下架」的时刻），恢复则清零。
    let result = sqlx::query(
        "UPDATE scores SET hidden_at = CASE WHEN $2 THEN COALESCE(hidden_at, now()) \
                ELSE NULL END \
         WHERE id = $1",
    )
    .bind(id)
    .bind(hidden)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({"id": id, "hidden": hidden})))
}

async fn hide_score(
    State(state): State<AppState>,
    Extension(admin): Extension<AdminAuth>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    require_admin(&headers, &admin)?;
    set_hidden(&state.pool, id, true).await
}

async fn restore_score(
    State(state): State<AppState>,
    Extension(admin): Extension<AdminAuth>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    require_admin(&headers, &admin)?;
    set_hidden(&state.pool, id, false).await
}

/// 管理端：重置指定邮箱的口令（过渡版「找回」）。
///
/// 自助找回要等邮件通道；在那之前「忘口令 = 废号」是不可接受的，
/// 所以先给管理员一条正路：一条请求换新口令，不用手进数据库算 Argon2 散列。
///
/// **改密即吊销该用户全部会话**：重置的语义就是「从现在起只有新口令算数」。
/// 不踢会话的话，偷到旧会话 token 的人照样能进——改密改了个寂寞。
async fn admin_reset_password(
    State(state): State<AppState>,
    Extension(admin): Extension<AdminAuth>,
    headers: HeaderMap,
    Json(req): Json<AdminResetPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    require_admin(&headers, &admin)?;

    let email = accounts::normalize_email(&req.email)?;
    // 服务端生成的口令回显**一次**（只存散列，过了这村没这店）；
    // 管理员自己指定的不回显——回显等于把明文又抄一份到聊天记录里。
    let (password, temporary) = match req.new_password {
        Some(p) => {
            accounts::validate_password(&p)?;
            (p, false)
        }
        None => (accounts::generate_temporary_password(), true),
    };
    let password_hash = accounts::hash_password(&password)?;

    // 改密与踢会话放一个事务：分开做的话，中间崩一下会留下
    // 「口令已是新的、旧会话还活着」的窗口——那正是重置要堵的洞。
    let mut tx = state.pool.begin().await?;
    let user_id: Uuid = match sqlx::query_scalar::<_, Uuid>(
        "UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id",
    )
    .bind(&password_hash)
    .bind(&email)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        // 查无此人给 404：这是管理端，管理员需要知道是不是邮箱写错了
        //（不是登录接口，不必防账号枚举）。
        Err(sqlx::Error::RowNotFound) => return Err(AppError::NotFound),
        Err(e) => return Err(e.into()),
    };
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let mut body = json!({"email": email, "user_id": user_id, "temporary": temporary});
    if temporary {
        body["temporary_password"] = json!(password);
    }
    Ok(Json(body))
}

///
/// 校验「这个调用者能否改 / 删这首谱」。
///
/// 满足**任意一条**即可：账号匹配，或出示了匹配的本机凭证。
/// 两条都不满足时一律拒绝——包括「无主谱」（迁移前老数据）与匿名请求，
/// 宁可让管理员手工清理，也不留一个「谁都能删」的口子。
fn ensure_can_edit(caller: &Caller, score: &Score) -> AppResult<()> {
    let by_account = matches!(
        (score.owner_user_id, caller.user_id),
        (Some(owner), Some(me)) if owner == me
    );
    let by_token = matches!(
        (score.owner_token.as_deref(), caller.owner_token.as_deref()),
        (Some(stored), Some(provided)) if stored == provided
    );

    if by_account || by_token {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "这不是你发布到社区的曲谱，无法修改或删除".into(),
        ))
    }
}

/// 合法定弦标识，与前端 `apps/web/src/lib/tuning.ts` 的 `TuningId` 一一对应。
/// 两处要一起改，否则后端收下前端不认识的定弦，前端反推音高时只能退回正调。
const VALID_TUNINGS: [&str; 3] = ["zhengdiao", "ruibin", "manjiao"];
const DEFAULT_TUNING: &str = "zhengdiao";

fn validate_tuning(tuning: &str) -> AppResult<()> {
    if VALID_TUNINGS.contains(&tuning) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "未知定弦：{tuning}（可用：{}）",
            VALID_TUNINGS.join(" / ")
        )))
    }
}

/// 校验标题长度。
///
/// 用 `chars().count()` 而非 `len()`：`len()` 数的是 UTF-8 **字节**，
/// 一个汉字占 3 字节，会让「200 字」实际只允许 66 个汉字，与提示文案不符
/// （英文标题则刚好卡在 200 字符）。按字符数才是用户感知的长度。
fn validate_title(title: &str) -> AppResult<()> {
    if title.chars().count() > MAX_TITLE_LENGTH {
        Err(AppError::Validation(format!(
            "标题不能超过 {MAX_TITLE_LENGTH} 字"
        )))
    } else {
        Ok(())
    }
}

/// 校验署名长度。空串合法（等价于匿名），不做必填。
fn validate_author(author: &str) -> AppResult<()> {
    if author.chars().count() > MAX_AUTHOR_LENGTH {
        Err(AppError::Validation(format!(
            "署名不能超过 {MAX_AUTHOR_LENGTH} 字"
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

/// 模板匹配结果 → 识别响应。
fn template_response(m: &template_match::TemplateMatch) -> RecognizeResponse {
    RecognizeResponse {
        method: "template",
        glyph: Some(m.text.clone()),
        explanation: Some(format!(
            "模板匹配（字形 {}）：距离 {:.3}，与次优差 {:.3}，置信度 {:.0}%",
            m.name,
            m.distance,
            m.margin,
            m.confidence() * 100.0
        )),
        confidence: Some(m.confidence()),
    }
}

/// 减字谱单字图像识别。
///
/// 识别路径（`RECOGNIZE_MODE` 控制，默认 `auto`）：
/// 1. **模板匹配**（`template_match`）：对电子谱面（本项目字体渲染的干净减字图）
///    确定性命中，exact_match 100%，零成本、毫秒级；
/// 2. **LLM 视觉识别**：拍照/扫描件等模板覆盖不了的分布，或模板置信度不足时。
///
/// auto 模式下模板置信度（top-2 margin 比）≥ `RECOGNIZE_TEMPLATE_MIN_MARGIN`
/// （默认 0.3）直接采用模板结果；否则落 LLM。LLM 未配置时用模板结果兜底，
/// 不再直接 503。
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

    let strategy = template_match::RecognizeStrategy::from_env();

    // 模板路径需要解码像素；解码失败（如超大图/损坏图）时安静降级到 LLM。
    let tpl = if strategy.mode != RecognizeMode::Llm {
        base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            req.image_base64.trim(),
        )
        .ok()
        .and_then(|bytes| template_match::match_image_bytes(&bytes).ok())
    } else {
        None
    };

    if let Some(m) = &tpl
        && template_match::prefer_template(&strategy, m.confidence())
    {
        return Ok(Json(template_response(m)));
    }

    match recognize_jianzi_with_llm(&state.llm, &req.image_base64, media_type).await {
        Ok(Some(resp)) => Ok(Json(resp)),
        Ok(None) => {
            // LLM 未配置：auto/template 模式下用模板兜底（即便置信度不高，
            // 也比直接 503 有用）；显式 llm 模式维持原 503 语义。
            if strategy.mode != RecognizeMode::Llm
                && let Some(m) = &tpl
            {
                return Ok(Json(template_response(m)));
            }
            Err(AppError::ServiceUnavailable(
                "LLM 未配置（缺少 ANTHROPIC_API_KEY）".into(),
            ))
        }
        Err(e) => {
            tracing::warn!("jianzi recognition failed: {e}");
            Err(AppError::ServiceUnavailable(format!("识别失败：{e}")))
        }
    }
}

/// 整页模板匹配结果 → 识别响应（`method = "template"`）。
fn sheet_template_response(cells: &[sheet_segment::SheetCellMatch]) -> RecognizeSheetResponse {
    RecognizeSheetResponse {
        method: "template",
        cells: cells
            .iter()
            .map(|c| RecognizeSheetCell {
                row: c.row,
                col: c.col,
                glyph: Some(c.m.text.clone()),
                explanation: Some(format!(
                    "模板匹配（字形 {}）：距离 {:.3}，与次优差 {:.3}，置信度 {:.0}%",
                    c.m.name,
                    c.m.distance,
                    c.m.margin,
                    c.m.confidence() * 100.0
                )),
                confidence: Some(c.m.confidence()),
            })
            .collect(),
    }
}

/// 整页减字谱图像识别（策略核心，测试直调；路由只做校验 + 取环境策略）。
///
/// 识别路径（`RECOGNIZE_MODE` 控制，默认 `auto`）：
/// 1. **模板切分 + 逐格匹配**（`sheet_segment`）：电子谱面确定性路径，
///    字高 ≥72px 时逐格 exact 100%、间隙 ≥0.2×字高切分全对，毫秒级零成本；
/// 2. **LLM 视觉识别**：拍照/扫描件等模板覆盖不了的分布，或整页置信度不足时。
///
/// auto 模式下全页平均置信度（top-2 margin 比）≥ `RECOGNIZE_TEMPLATE_MIN_MARGIN`
/// （默认 0.3）直接采用模板结果；否则落 LLM。LLM 未配置时用模板结果兜底
/// （含「一个字都没切出来」的空结果，前端据此提示换图），不再直接 503；
/// 显式 `llm` 模式维持 503 语义。
async fn recognize_sheet_auto(
    llm: &LlmConfig,
    req: &RecognizeRequest,
    strategy: template_match::RecognizeStrategy,
) -> AppResult<RecognizeSheetResponse> {
    // 模板路径需要解码像素；解码失败（损坏图/超大图）安静降级到 LLM。
    let tpl_cells = if strategy.mode != RecognizeMode::Llm {
        base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            req.image_base64.trim(),
        )
        .ok()
        .and_then(|bytes| {
            sheet_segment::recognize_sheet_image_bytes(&template_match::INDEX, &bytes).ok()
        })
    } else {
        None
    };

    if let Some(cells) = &tpl_cells
        && !cells.is_empty()
        && template_match::prefer_template(&strategy, sheet_segment::mean_margin_ratio(cells))
    {
        return Ok(sheet_template_response(cells));
    }

    match recognize_sheet_with_llm(llm, &req.image_base64, &req.media_type).await {
        Ok(Some(resp)) => Ok(resp),
        Ok(None) => {
            // LLM 未配置：auto/template 模式下用模板兜底（空结果也是有效
            // 答案——「没切出字」比 503 对用户更有用）；显式 llm 模式维持 503。
            if strategy.mode != RecognizeMode::Llm
                && let Some(cells) = &tpl_cells
            {
                return Ok(sheet_template_response(cells));
            }
            Err(AppError::ServiceUnavailable(
                "LLM 未配置（缺少 ANTHROPIC_API_KEY）".into(),
            ))
        }
        Err(e) => {
            tracing::warn!("jianzi sheet recognition failed: {e}");
            Err(AppError::ServiceUnavailable(format!("识别失败：{e}")))
        }
    }
}

/// 整页减字谱图像识别：电子谱面走模板切分（`method = "template"`），
/// 其余落 LLM 多模态识别（`method = "llm"`）；LLM 未配置且无模板结果时 503。
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
    let strategy = template_match::RecognizeStrategy::from_env();
    Ok(Json(
        recognize_sheet_auto(&state.llm, &req, strategy).await?,
    ))
}

async fn create_score(
    State(state): State<AppState>,
    Extension(quota): Extension<PublishQuota>,
    headers: HeaderMap,
    Json(req): Json<CreateScoreRequest>,
) -> AppResult<Json<Score>> {
    let title = req.title.unwrap_or_else(|| "未命名曲谱".to_string());
    validate_title(&title)?;
    let tuning = req.tuning.unwrap_or_else(|| DEFAULT_TUNING.to_string());
    validate_tuning(&tuning)?;
    // 去空白后校验：只有一个空格的署名等于匿名，不该占满长度配额。
    let author = req.author.unwrap_or_default().trim().to_string();
    validate_author(&author)?;
    // 发布必须带着「我是谁」：登录态或本机凭证，二者有其一即可。
    //
    // 以前没带也放行，代价是出现**无主谱**——谁也改不了、删不了，只能管理员
    // 进数据库手工清。脚本灌库时每一行都是这种死数据，事后清理比事前拦下贵得多。
    // 现在改成「至少有一条腿」：浏览器端 `getOwnerToken()` 首次调用就会生成并
    // 持久化凭证，用户完全感觉不到；而一个裸 `curl` 会被挡在门外。
    //
    // 注意这不等于反垃圾的全部：脚本随手造一个 UUID 也能算「有主」。真正治本
    // 靠三样东西合力——发布限流（`write_limiter`）管速率，发布配额
    // （`reserve_publish_slot`）管存量，账号体系让代价落到具体的人身上。
    let caller = read_caller(&headers, &state.pool).await?;
    if caller.user_id.is_none() && caller.owner_token.is_none() {
        return Err(AppError::Unauthorized(
            "发布到社区需要发布者身份：页面会自动带上本机凭证，\
             脚本请加 x-owner-token 请求头（或带上登录态的 Authorization）"
                .into(),
        ));
    }

    // 配额检查与插入必须同处一个事务：中间隔开，两个并发请求就都能通过检查。
    let mut tx = state.pool.begin().await?;
    reserve_publish_slot(&mut tx, &caller, quota).await?;

    let score = sqlx::query_as::<_, Score>(
        "INSERT INTO scores (title, notes, tuning, author, owner_token, owner_user_id) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING id, title, notes, tuning, author, owner_token, owner_user_id, \
                   created_at, updated_at, (hidden_at IS NOT NULL) AS hidden",
    )
    .bind(&title)
    .bind(&req.notes)
    .bind(&tuning)
    .bind(&author)
    .bind(&caller.owner_token)
    .bind(caller.user_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(score))
}

/// 列表查询参数。都省略时按 `DEFAULT_PAGE_SIZE` 返回第一页。
#[derive(Debug, serde::Deserialize)]
struct ListScoresQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    /// `recent`（默认）= 按更新时间倒序；`popular` = 按收藏数倒序（热度）。
    /// 只认这两个值，其它一律当 `recent`——不把任意字符串塞进 SQL（排序子句无法参数化）。
    sort: Option<String>,
    /// 关键词：同时匹配标题与署名（ILIKE，大小写不敏感）。空 / 纯空白视为「不给」。
    /// 拼进 SQL 的是**占位符 `$1`**，实际值走 bind——绝不把用户输入当 SQL 片段拼。
    q: Option<String>,
    /// 定弦过滤：只留等于该值的谱。非法值直接 400（而非静默忽略），
    /// 否则「我以为筛了其实没筛」比不提供筛选更让人困惑。
    tuning: Option<String>,
}

/// 社区曲谱列表（分页）。
///
/// 以前是全表返回：谱少时看不出问题，谱一多就是「打开加载框卡三秒、滚不动」，
/// 而且每次翻页都要重传整个库。现在按页取，并在响应头里给出总条数。
///
/// `limit` / `offset` 都做了夹紧，不接受任意值：负数 offset 是 SQL 错误，
/// 超大的 limit 是把库一次性拖出来的捷径。
async fn list_scores(
    State(state): State<AppState>,
    Query(q): Query<ListScoresQuery>,
) -> AppResult<impl IntoResponse> {
    let limit = q.limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    let offset = q.offset.unwrap_or(0).max(0);

    // 排序方向由 Rust 选中常量后再拼进 SQL：sort 只可能取两个写死的字面量之一，
    // 用户传的任何其它字符串都会被 `match` 落到 `recent` 分支，绝不会进语句。
    let order_by = match q.sort.as_deref() {
        Some("popular") => "ORDER BY favorites_count DESC, updated_at DESC",
        _ => "ORDER BY updated_at DESC",
    };

    // 关键词：同时匹配标题与署名（ILIKE，大小写不敏感）。空 / 纯空白视为「不给」。
    // 拼进 SQL 的是**占位符 `$1`**，实际值走 bind——绝不把用户输入当 SQL 片段拼。
    let q_param: Option<String> =
        q.q.as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| format!("%{s}%"));
    // 定弦过滤：只留等于该值的谱。非法值直接 400（而非静默忽略），
    // 否则「我以为筛了其实没筛」比不提供筛选更让人困惑。
    let tuning_param: Option<String> = match q.tuning.as_deref() {
        None => None,
        Some(t) => {
            validate_tuning(t)?;
            Some(t.to_string())
        }
    };

    let scores = sqlx::query_as::<_, ScoreListItem>(&format!(
        "SELECT id, title, tuning, author, owner_user_id, favorites_count, created_at, updated_at \
         FROM scores \
         WHERE hidden_at IS NULL \
           AND ($1::text IS NULL OR title ILIKE $1 OR author ILIKE $1) \
           AND ($2::text IS NULL OR tuning = $2) \
         {order_by} LIMIT $3 OFFSET $4"
    ))
    .bind(q_param.clone())
    .bind(tuning_param.clone())
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    // 单独查一次总数，而不是在同一条 SQL 里用 `count(*) OVER ()`：
    // 后者在 offset 超出总数时**一行都不返回**，总数也跟着丢了——
    // 而「这里已经没有更多了」恰恰是前端最需要判断的事。
    // 这里用**同样的过滤条件**，否则「已显示 N / 总数」会与列表内容对不上。
    let total: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM scores \
         WHERE hidden_at IS NULL \
           AND ($1::text IS NULL OR title ILIKE $1 OR author ILIKE $1) \
           AND ($2::text IS NULL OR tuning = $2)",
    )
    .bind(q_param.clone())
    .bind(tuning_param.clone())
    .fetch_one(&state.pool)
    .await?;

    let mut headers = HeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(&total.to_string()) {
        headers.insert(TOTAL_COUNT_HEADER, value);
    }

    Ok((headers, Json(scores)))
}

/// 读单首谱。
///
/// 已下架的谱对**外人一律 404**（否则下架只是从列表里消失，分享链接照样能打开，
/// 等于没下架）；但对**谱主和管理员**仍然可见——谱主要知道自己的谱被下架了、
/// 才有机会改好再申请恢复，管理员要能读内容才能判断该不该恢复。
async fn get_score(
    State(state): State<AppState>,
    Extension(admin): Extension<AdminAuth>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<Score>> {
    let score = fetch_score(&state.pool, id).await?;
    if score.hidden {
        let caller = read_caller(&headers, &state.pool).await?;
        let may_see = ensure_can_edit(&caller, &score).is_ok() || is_admin(&headers, &admin);
        if !may_see {
            // 用 404 而不是 403：403 等于告诉对方「这首确实存在，只是被下架了」，
            // 与「不存在」区分开没有好处，只会让人反复试探。
            return Err(AppError::NotFound);
        }
    }
    Ok(Json(score))
}

async fn update_score(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<UpdateScoreRequest>,
) -> AppResult<Json<Score>> {
    let existing = fetch_score(&state.pool, id).await?;
    // 先校验所有权再动任何字段：否则别人能改掉你的谱面内容（比删更隐蔽）
    let caller = read_caller(&headers, &state.pool).await?;
    ensure_can_edit(&caller, &existing)?;

    let title = req.title.unwrap_or(existing.title);
    validate_title(&title)?;
    let notes = req.notes.unwrap_or(existing.notes);
    let tuning = req.tuning.unwrap_or(existing.tuning);
    validate_tuning(&tuning)?;
    let author = req
        .author
        .map(|a| a.trim().to_string())
        .unwrap_or(existing.author);
    validate_author(&author)?;

    let score = sqlx::query_as::<_, Score>(
        "UPDATE scores SET title = $1, notes = $2, tuning = $3, author = $4, updated_at = now() \
         WHERE id = $5 \
         RETURNING id, title, notes, tuning, author, owner_token, owner_user_id, \
                   created_at, updated_at, (hidden_at IS NOT NULL) AS hidden",
    )
    .bind(&title)
    .bind(&notes)
    .bind(&tuning)
    .bind(&author)
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(score))
}

async fn delete_score(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    // 先取一次做所有权校验：无主谱 / 凭证不符一律 403，
    // 不能让「知道 id」等价于「有权删除」——分享链接里正好带着 id。
    let existing = fetch_score(&state.pool, id).await?;
    let caller = read_caller(&headers, &state.pool).await?;
    ensure_can_edit(&caller, &existing)?;

    let result = sqlx::query("DELETE FROM scores WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(json!({"deleted": true})))
}

/// 注册。返回账号信息 + 会话 token（注册即登录，省一步）。
///
/// 邮箱只做形状校验、不验证真实性：没有邮件通道，假装验证了更糟。
/// 这条要在界面上写清楚，别让人以为注册过就能找回口令。
async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<Json<accounts::AuthResponse>> {
    let email = accounts::normalize_email(&req.email)?;
    accounts::validate_password(&req.password)?;
    let display_name = accounts::normalize_display_name(req.display_name.as_deref())?;
    let password_hash = accounts::hash_password(&req.password)?;

    let inserted = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, password_hash, display_name) \
         VALUES ($1, $2, $3) \
         RETURNING id, email, password_hash, display_name, created_at",
    )
    .bind(&email)
    .bind(&password_hash)
    .bind(&display_name)
    .fetch_one(&state.pool)
    .await;

    // 并发下唯一索引才是权威：先到先得，后到的收到「已注册」而不是 500。
    let user = match inserted {
        Ok(user) => user,
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505") => {
            return Err(AppError::Conflict("这个邮箱已经注册过了".into()));
        }
        Err(e) => return Err(e.into()),
    };

    let token = accounts::create_session(&state.pool, user.id).await?;
    Ok(Json(accounts::AuthResponse {
        user: accounts::public_user(&user),
        token,
    }))
}

/// 登录。
async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<accounts::AuthResponse>> {
    let email = accounts::normalize_email(&req.email)?;

    let user = sqlx::query_as::<_, User>(
        "SELECT id, email, password_hash, display_name, created_at \
         FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    // 「邮箱不存在」与「口令不对」返回同一句话：区分了等于帮人枚举账号。
    let Some(user) = user else {
        return Err(AppError::Unauthorized("邮箱或口令不对".into()));
    };
    if !accounts::verify_password(&req.password, &user.password_hash) {
        return Err(AppError::Unauthorized("邮箱或口令不对".into()));
    }

    let token = accounts::create_session(&state.pool, user.id).await?;
    Ok(Json(accounts::AuthResponse {
        user: accounts::public_user(&user),
        token,
    }))
}

/// 登出：删掉会话行。会话存库而非自证，正是为了能这样立刻吊销。
async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    if let Some(token) = accounts::bearer_token(&headers) {
        accounts::revoke_session(&state.pool, token).await?;
    }
    Ok(Json(json!({"ok": true})))
}

/// 当前登录者。会话缺失 / 过期都返回 401，前端据此清掉本地登录态。
async fn me(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<PublicUser>> {
    let user = accounts::current_user(&headers, &state.pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("未登录或登录已过期".into()))?;
    Ok(Json(accounts::public_user(&user)))
}

/// 认领旧谱：把「本机凭证」发布的谱挂到账号下。
///
/// **必须出示原凭证**，只登录不行——否则任何人注册一下就能把别人的谱认领走。
/// 成功之后这首谱就同时拥有账号归属，换设备、清缓存都不会再失去它。
async fn claim_score(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> AppResult<Json<Score>> {
    let caller = read_caller(&headers, &state.pool).await?;
    let Some(_user_id) = caller.user_id else {
        return Err(AppError::Unauthorized("请先登录再认领曲谱".into()));
    };
    let score = fetch_score(&state.pool, id).await?;

    // 认领走的是「原凭证」这条腿：故意不用 ensure_can_edit，
    // 因为账号那条腿此刻必然不匹配（这首谱还没归我）。
    let by_token = matches!(
        (score.owner_token.as_deref(), caller.owner_token.as_deref()),
        (Some(stored), Some(provided)) if stored == provided
    );
    if !by_token {
        return Err(AppError::Forbidden(
            "只有当初发布这首谱的那台设备能认领它".into(),
        ));
    }

    // 不动 updated_at：认领不是内容变更，不该把旧谱顶到列表最前面。
    let updated = sqlx::query_as::<_, Score>(
        "UPDATE scores SET owner_user_id = $1 \
         WHERE id = $2 \
         RETURNING id, title, notes, tuning, author, owner_token, owner_user_id, \
                   created_at, updated_at, (hidden_at IS NOT NULL) AS hidden",
    )
    .bind(caller.user_id)
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(updated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::template_match::{INDEX, RecognizeStrategy};

    #[test]
    fn title_limit_counts_chars_not_bytes() {
        // 200 个汉字 = 600 字节，按 `len()` 会被误拒；按字符数应放行。
        let ok = "琴".repeat(MAX_TITLE_LENGTH);
        assert!(validate_title(&ok).is_ok(), "200 个汉字应合法");

        let too_long = "琴".repeat(MAX_TITLE_LENGTH + 1);
        assert!(validate_title(&too_long).is_err(), "201 个汉字应拒绝");
    }

    #[test]
    fn author_validation_allows_empty_and_caps_chars() {
        assert!(validate_author("").is_ok(), "匿名发布（空署名）应合法");
        assert!(validate_author("张百忍").is_ok());

        let ok = "琴".repeat(MAX_AUTHOR_LENGTH);
        assert!(validate_author(&ok).is_ok(), "40 个汉字应合法");

        let too_long = "琴".repeat(MAX_AUTHOR_LENGTH + 1);
        let err = validate_author(&too_long).expect_err("41 个汉字应拒绝");
        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    }

    fn score_with(owner_token: Option<&str>, owner_user_id: Option<Uuid>) -> Score {
        Score {
            id: Uuid::nil(),
            title: "测试谱".into(),
            notes: json!([]),
            tuning: "zhengdiao".into(),
            author: String::new(),
            owner_token: owner_token.map(str::to_string),
            owner_user_id,
            created_at: chrono::DateTime::<chrono::Utc>::UNIX_EPOCH,
            updated_at: chrono::DateTime::<chrono::Utc>::UNIX_EPOCH,
            hidden: false,
        }
    }

    #[test]
    fn editing_needs_either_account_or_token() {
        let me = Uuid::new_v4();
        let other = Uuid::new_v4();

        // 认领到账号的谱：本人可改，别人不行
        let mine = score_with(None, Some(me));
        assert!(
            ensure_can_edit(
                &Caller {
                    user_id: Some(me),
                    owner_token: None
                },
                &mine
            )
            .is_ok()
        );
        assert!(
            ensure_can_edit(
                &Caller {
                    user_id: Some(other),
                    owner_token: None
                },
                &mine
            )
            .is_err()
        );

        // 老路径仍然有效：没登录，出示本机凭证也能改
        let by_token = score_with(Some("t"), None);
        assert!(
            ensure_can_edit(
                &Caller {
                    user_id: None,
                    owner_token: Some("t".into())
                },
                &by_token
            )
            .is_ok()
        );
        assert!(
            ensure_can_edit(
                &Caller {
                    user_id: None,
                    owner_token: Some("x".into())
                },
                &by_token
            )
            .is_err()
        );

        // 无主谱：谁都改不了，登录了也不行
        let orphan = score_with(None, None);
        assert!(
            ensure_can_edit(
                &Caller {
                    user_id: Some(me),
                    owner_token: Some("t".into())
                },
                &orphan
            )
            .is_err()
        );
    }

    #[test]
    fn owner_token_header_is_read_safely() {
        let mut headers = HeaderMap::new();
        assert_eq!(read_owner_token(&headers), None, "缺失即没有");

        headers.insert(OWNER_TOKEN_HEADER, HeaderValue::from_static("  abc  "));
        assert_eq!(read_owner_token(&headers).as_deref(), Some("abc"), "去空白");

        headers.insert(OWNER_TOKEN_HEADER, HeaderValue::from_static("   "));
        assert_eq!(read_owner_token(&headers), None, "纯空白视为没带");

        // 超长串不接受，避免有人把 header 当存储用
        let long = "a".repeat(MAX_OWNER_TOKEN_LENGTH + 1);
        headers.insert(OWNER_TOKEN_HEADER, HeaderValue::from_str(&long).unwrap());
        assert_eq!(read_owner_token(&headers), None);
    }

    /// 用索引模板拼一张 2x2 合成整页（墨=0 白底），编码为 PNG base64 ——
    /// 与 sheet_segment 回环测试同一构造，端到端验证「切分→匹配→响应」接线。
    fn synthetic_sheet_b64() -> (String, [&'static str; 4]) {
        use image::ImageEncoder;

        let picks = [0usize, 1, 2, 3];
        let scale = 2usize;
        let gap = 24usize;
        let margin = 12usize;
        let cell = template_match::SIZE * scale;
        let w = margin * 2 + cell * 2 + gap;
        let h = margin * 2 + cell * 2 + gap;
        let mut img = vec![255u8; w * h];
        let mut names = [""; 4];
        for (i, &pi) in picks.iter().enumerate() {
            names[i] = INDEX.entries[pi].name.as_str();
            let (r, c) = (i / 2, i % 2);
            let ox = margin + c * (cell + gap);
            let oy = margin + r * (cell + gap);
            let src = &INDEX.entries[pi].pixels;
            for y in 0..cell {
                for x in 0..cell {
                    let v = src[(y / scale) * template_match::SIZE + (x / scale)];
                    img[(oy + y) * w + (ox + x)] = 255 - v;
                }
            }
        }
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&img, w as u32, h as u32, image::ExtendedColorType::L8)
            .expect("encode png");
        (
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png),
            names,
        )
    }

    fn req(b64: &str) -> RecognizeRequest {
        RecognizeRequest {
            image_base64: b64.to_string(),
            media_type: "image/png".into(),
        }
    }

    #[tokio::test]
    async fn sheet_auto_prefers_template_on_clean_page() {
        let (b64, names) = synthetic_sheet_b64();
        let resp = recognize_sheet_auto(
            &LlmConfig::default(),
            &req(&b64),
            RecognizeStrategy {
                mode: RecognizeMode::Auto,
                min_margin_ratio: 0.3,
            },
        )
        .await
        .expect("模板路径不应失败");
        assert_eq!(resp.method, "template");
        assert_eq!(resp.cells.len(), 4);
        for (i, cell) in resp.cells.iter().enumerate() {
            assert_eq!((cell.row, cell.col), (i / 2, i % 2), "坐标顺序");
            let glyph = cell.glyph.as_deref().unwrap_or_default();
            let truth = INDEX
                .entries
                .iter()
                .find(|e| e.name == names[i])
                .map(|e| e.truths.clone())
                .unwrap_or_default();
            assert!(
                truth.iter().any(|t| t.as_str() == glyph),
                "第 {i} 格应是 {} 的等价写法之一，got {glyph}",
                names[i]
            );
            assert!(cell.confidence.unwrap_or(0.0) >= 0.3, "干净页面置信度应高");
        }
    }

    #[tokio::test]
    async fn sheet_template_mode_works_without_llm() {
        let (b64, _) = synthetic_sheet_b64();
        let resp = recognize_sheet_auto(
            &LlmConfig::default(),
            &req(&b64),
            RecognizeStrategy {
                mode: RecognizeMode::Template,
                min_margin_ratio: 0.99, // 显式 template 模式不看阈值
            },
        )
        .await
        .expect("template 模式应直出");
        assert_eq!(resp.method, "template");
        assert_eq!(resp.cells.len(), 4);
    }

    #[tokio::test]
    async fn sheet_llm_mode_without_key_is_503() {
        let (b64, _) = synthetic_sheet_b64();
        let err = recognize_sheet_auto(
            &LlmConfig::default(),
            &req(&b64),
            RecognizeStrategy {
                mode: RecognizeMode::Llm,
                min_margin_ratio: 0.3,
            },
        )
        .await
        .expect_err("显式 llm 模式且未配置应 503");
        assert!(matches!(err, AppError::ServiceUnavailable(_)), "{err:?}");
    }

    #[tokio::test]
    async fn sheet_auto_blank_page_falls_back_to_empty_template() {
        // 空白图切不出字格 → auto 应兜底返回空 cells（前端提示换图），而非 503
        use image::ImageEncoder;
        let img = vec![255u8; 64 * 64];
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&img, 64, 64, image::ExtendedColorType::L8)
            .expect("encode png");
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png);
        let resp = recognize_sheet_auto(
            &LlmConfig::default(),
            &req(&b64),
            RecognizeStrategy {
                mode: RecognizeMode::Auto,
                min_margin_ratio: 0.3,
            },
        )
        .await
        .expect("空白页应回空结果而不是错误");
        assert_eq!(resp.method, "template");
        assert!(resp.cells.is_empty());
    }
}
