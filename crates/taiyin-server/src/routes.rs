use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Method},
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

use crate::accounts;
use crate::auth::require_api_key;
use crate::config::ServerConfig;
use crate::db::AppState;
use crate::error::{AppError, AppResult};
use crate::llm::{
    LlmConfig, RecognizeRequest, RecognizeResponse, RecognizeSheetCell, RecognizeSheetResponse,
    SelectRequest, SelectResponse, heuristic_selections, recognize_jianzi_with_llm,
    recognize_sheet_with_llm, select_with_llm,
};
use crate::models::{
    CreateScoreRequest, LoginRequest, PublicUser, RegisterRequest, Score, ScoreListItem,
    UpdateScoreRequest, User,
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
            // 所有权凭证：不加进白名单的话，浏览器跨域预检会直接拦掉，
            // 表现是「发布能成、改删必失败」，且只报 CORS 错误、看不出真正原因。
            axum::http::HeaderName::from_static(OWNER_TOKEN_HEADER),
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
        // 认领：把「本机凭证」发布的旧谱挂到账号下（必须出示原凭证）
        .route("/api/v1/scores/{id}/claim", post(claim_score))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/me", get(me))
        .merge(translate_routes)
        .layer(RequestBodyLimitLayer::new(5 * 1024 * 1024)) // 5 MB
        .layer(cors)
        .with_state(state)
}

async fn fetch_score(pool: &PgPool, id: Uuid) -> AppResult<Score> {
    sqlx::query_as::<_, Score>(
        "SELECT id, title, notes, tuning, author, owner_token, owner_user_id, created_at, updated_at \
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
    // 没带凭证也允许发布，但这条谱从此无主（谁也改不了、删不了），
    // 由管理员直接操作数据库清理。比「随便谁都能删」安全得多。
    let caller = read_caller(&headers, &state.pool).await?;

    let score = sqlx::query_as::<_, Score>(
        "INSERT INTO scores (title, notes, tuning, author, owner_token, owner_user_id) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         RETURNING id, title, notes, tuning, author, owner_token, owner_user_id, \
                   created_at, updated_at",
    )
    .bind(&title)
    .bind(&req.notes)
    .bind(&tuning)
    .bind(&author)
    .bind(&caller.owner_token)
    .bind(caller.user_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(score))
}

async fn list_scores(State(state): State<AppState>) -> AppResult<Json<Vec<ScoreListItem>>> {
    let scores = sqlx::query_as::<_, ScoreListItem>(
        "SELECT id, title, tuning, author, owner_user_id, created_at, updated_at \
         FROM scores ORDER BY updated_at DESC",
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
                   created_at, updated_at",
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
                   created_at, updated_at",
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
