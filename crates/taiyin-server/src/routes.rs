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
    LlmConfig, RecognizeRequest, RecognizeResponse, RecognizeSheetCell, RecognizeSheetResponse,
    SelectRequest, SelectResponse, heuristic_selections, recognize_jianzi_with_llm,
    recognize_sheet_with_llm, select_with_llm,
};
use crate::models::{CreateScoreRequest, Score, ScoreListItem, UpdateScoreRequest};
use crate::sheet_segment;
use crate::template_match::{self, RecognizeMode};

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::template_match::{INDEX, RecognizeStrategy};

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
