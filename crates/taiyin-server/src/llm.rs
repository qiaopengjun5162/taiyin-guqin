//! # LLM 候选选择
//!
//! 将简谱序列与各音候选减字交给 Anthropic Messages API，让模型按演奏
//! 合理性为每音选择一个候选。未配置 `ANTHROPIC_API_KEY` 或调用失败时，
//! 调用方回退到启发式 top1。

use serde::{Deserialize, Serialize};
use taiyin_core::jianpu::{JianpuNote, JianziCandidate, Tuning};
use taiyin_core::{GuqinNote, LeftFinger, NoteType, RightAction};

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL: &str = "claude-haiku-4-5-20251001";

/// LLM 后端风格。
///
/// - `Anthropic`（默认）：调用 Anthropic Messages API（多模态），鉴权用 `x-api-key`。
/// - `OpenAi`：调用 OpenAI 兼容的 chat/completions（多模态），鉴权用
///   `Authorization: Bearer`。便于复用第三方便捷/自建网关（如 DeepSeek、
///   OpenRouter、各类 Claude 兼容代理），而无需 Anthropic 官方 key。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ApiStyle {
    #[default]
    Anthropic,
    OpenAi,
}

/// LLM 配置（注入 AppState）。
#[derive(Clone)]
pub struct LlmConfig {
    pub api_key: Option<String>,
    pub model: String,
    /// Anthropic Messages API 端点。默认官方地址，可用 `ANTHROPIC_BASE_URL`
    /// 覆盖为兼容的代理（如自建 / 第三方 Claude 兼容网关）。
    pub base_url: String,
    pub client: reqwest::Client,
    /// 后端风格：`anthropic`（默认）或 `openai`。由 `LLM_API_STYLE` 控制。
    pub api_style: ApiStyle,
    /// OpenAI 兼容模式下的 key（Bearer 鉴权）。
    pub openai_api_key: Option<String>,
    /// OpenAI 兼容端点（完整 chat/completions URL）。默认 DeepSeek。
    pub openai_base_url: String,
    /// OpenAI 兼容模式下的模型名。默认 `deepseek-flash`。
    ///
    /// ⚠️ 必须选 `input_modalities` 含 `image` 的型号。DeepSeek 端点上
    /// `deepseek-flash` 支持图文输入，而 `deepseek-v4-pro` **只支持文本**——
    /// 选错不会报错，只会得到「看不到这张图」的空识别，是典型的静默失败。
    pub openai_model: String,
    /// 是否在请求里显式关闭「思考」（`thinking: {"type":"disabled"}`）。
    ///
    /// 推理型模型（如 `deepseek-flash`）默认会把 `max_tokens` 全烧在思考上，
    /// 导致 `content` 为空、`finish_reason=length`。关闭思考后可稳定拿到 JSON。
    /// 由 `OPENAI_DISABLE_THINKING` 控制，默认 `true`；遇到不认识该字段的网关
    /// 会自动去掉字段重试一次。
    pub openai_disable_thinking: bool,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            model: DEFAULT_MODEL.into(),
            base_url: ANTHROPIC_URL.into(),
            client: reqwest::Client::new(),
            api_style: ApiStyle::Anthropic,
            openai_api_key: None,
            openai_base_url: "https://api.deepseek.com/v1/chat/completions".into(),
            openai_model: "deepseek-flash".into(),
            openai_disable_thinking: true,
        }
    }
}

impl LlmConfig {
    /// 从环境变量读取配置；相关 key 缺省或为空则对应能力禁用（识别回退 / 编配回退启发式）。
    pub fn from_env() -> Self {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .filter(|k| !k.is_empty());
        let model = std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.into());
        let base_url = std::env::var("ANTHROPIC_BASE_URL").unwrap_or_else(|_| ANTHROPIC_URL.into());
        let api_style = match std::env::var("LLM_API_STYLE").as_deref() {
            Ok("openai") => ApiStyle::OpenAi,
            _ => ApiStyle::Anthropic,
        };
        let openai_api_key = std::env::var("OPENAI_API_KEY")
            .ok()
            .filter(|k| !k.is_empty());
        let openai_base_url = std::env::var("OPENAI_BASE_URL")
            .unwrap_or_else(|_| "https://api.deepseek.com/v1/chat/completions".into());
        let openai_model =
            std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "deepseek-flash".into());
        // 默认关闭思考：推理型视觉模型若开着思考，会把 token 全烧在推理上、
        // content 恒为空（实测 finish_reason=length）。显式设 0/false 可恢复。
        let openai_disable_thinking = std::env::var("OPENAI_DISABLE_THINKING")
            .map(|v| !matches!(v.as_str(), "0" | "false" | "no" | "off"))
            .unwrap_or(true);
        Self {
            api_key,
            model,
            base_url,
            api_style,
            openai_api_key,
            openai_base_url,
            openai_model,
            openai_disable_thinking,
            ..Default::default()
        }
    }
}

/// 每个音符的选择结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Selection {
    pub note_index: usize,
    pub candidate_index: usize,
    pub reason: String,
}

/// `POST /api/v1/translate/select` 请求体。
#[derive(Debug, Deserialize)]
pub struct SelectRequest {
    pub notes: Vec<JianpuNote>,
    #[serde(default)]
    pub tuning: Option<Tuning>,
}

/// `POST /api/v1/translate/select` 响应体。
///
/// `method` 为 `"llm"` 或 `"heuristic"`（未配置密钥或调用失败的回退）。
#[derive(Debug, Serialize)]
pub struct SelectResponse {
    pub method: &'static str,
    pub selections: Vec<Selection>,
}

/// 启发式回退：每音取 top1（候选已按评分降序排列）。
pub fn heuristic_selections(candidates_per_note: &[Vec<JianziCandidate>]) -> Vec<Selection> {
    candidates_per_note
        .iter()
        .enumerate()
        .map(|(i, c)| Selection {
            note_index: i,
            candidate_index: 0,
            reason: if c.is_empty() {
                "无候选"
            } else {
                "启发式最高分"
            }
            .into(),
        })
        .collect()
}

fn tone_text(t: &NoteType) -> &'static str {
    // 按音为默认音色不加前缀，与前端 jianziToText 约定一致
    match t {
        NoteType::SanYin => "散",
        NoteType::FanYin => "泛",
        NoteType::AnYin => "",
    }
}

fn finger_text(f: &LeftFinger) -> &'static str {
    match f {
        LeftFinger::Da => "大",
        LeftFinger::Ming => "名",
        LeftFinger::Zhong => "中",
        LeftFinger::Shi => "食",
        LeftFinger::Gui => "跪",
    }
}

fn action_text(a: &RightAction) -> &'static str {
    match a {
        RightAction::Tiao => "挑",
        RightAction::Gou => "勾",
        RightAction::Mo => "抹",
        RightAction::Ti => "剔",
        RightAction::Tuo => "托",
        RightAction::Bo => "擘",
        RightAction::Da => "打",
        RightAction::Zhai => "摘",
    }
}

const DIGITS: [&str; 8] = ["", "一", "二", "三", "四", "五", "六", "七"];

/// 将候选减字渲染为专家可读的文本（如「散挑一」「泛名十挑五」「大九勾三」）。
fn describe(note: &GuqinNote) -> String {
    let tone = tone_text(&note.note_type);
    let mut s = String::new();
    if let Some(ref f) = note.left_finger {
        s.push_str(finger_text(f));
    }
    if let Some(h) = note.hui {
        s.push_str(&h.hui.get().to_string());
        if let Some(fen) = h.fen {
            s.push_str(&format!(".{fen}"));
        }
    }
    s.push_str(action_text(&note.right_action));
    // `StringNumber` 已在类型层保证弦序 ∈ 1..=7，索引 `DIGITS[1..=7]` 必命中。
    // 此处用 `expect` 而非静默 `"?"`：一旦类型约束被绕过，错误应当显式暴露、可定位，
    // 而不是被一个误导性的占位符悄悄掩盖（旧实现正是如此藏 bug）。
    s.push_str(
        DIGITS
            .get(note.string_number.get() as usize)
            .expect("StringNumber 保证弦序 1..=7，索引必命中 DIGITS"),
    );
    format!("{tone}{s}")
}

fn tuning_text(t: Tuning) -> &'static str {
    match t {
        Tuning::ZhengDiao => "正调",
        Tuning::RuiBin => "蕤宾调（紧五弦）",
        Tuning::ManJiao => "慢角调（慢三弦）",
    }
}

fn octave_text(octave: i8) -> &'static str {
    match octave {
        1 => "（高八度）",
        -1 => "（低八度）",
        _ => "",
    }
}

/// 构造 system / user 提示词。
pub fn build_prompt(
    notes: &[JianpuNote],
    tuning: Tuning,
    candidates_per_note: &[Vec<JianziCandidate>],
) -> (String, String) {
    let system =
        "你是古琴减字谱编配专家。为简谱旋律中的每个音从给定候选中选择演奏上最合理的减字指法。\
        考量：相邻音的把位连贯（同弦或邻弦、徽位移动小）、常用指法优先、泛音与按音的音色布局。\
        只输出 JSON，不要输出其他任何文字。"
            .to_string();

    let note_list: Vec<serde_json::Value> = notes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            serde_json::json!({
                "note_index": i,
                "jianpu": format!("{}{}", n.number, octave_text(n.octave)),
            })
        })
        .collect();

    let cand_list: Vec<serde_json::Value> = candidates_per_note
        .iter()
        .enumerate()
        .map(|(i, cands)| {
            serde_json::json!({
                "note_index": i,
                "options": cands.iter().enumerate().map(|(j, c)| {
                    serde_json::json!({
                        "candidate_index": j,
                        "jianzi": describe(&c.note),
                        "heuristic_score": c.score,
                    })
                }).collect::<Vec<_>>(),
            })
        })
        .collect();

    let user = serde_json::json!({
        "tuning": tuning_text(tuning),
        "notes": note_list,
        "candidates": cand_list,
        "output_format": {"selections": [{"note_index": 0, "candidate_index": 0, "reason": "简要理由"}]},
    })
    .to_string();

    (system, user)
}

#[derive(Deserialize)]
struct LlmReply {
    selections: Vec<RawSelection>,
}

#[derive(Deserialize)]
struct RawSelection {
    note_index: usize,
    candidate_index: usize,
    #[serde(default)]
    reason: String,
}

/// 解析模型输出：容忍 ```json 代码围栏，越界索引回退 top1，缺失音符补齐。
pub fn parse_selections(
    text: &str,
    notes_len: usize,
    candidates_per_note: &[Vec<JianziCandidate>],
) -> Vec<Selection> {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let reply: LlmReply = serde_json::from_str(cleaned).unwrap_or(LlmReply {
        selections: Vec::new(),
    });

    (0..notes_len)
        .map(|i| {
            let found = reply.selections.iter().find(|s| s.note_index == i);
            match found {
                Some(s)
                    if candidates_per_note
                        .get(i)
                        .is_some_and(|c| s.candidate_index < c.len()) =>
                {
                    Selection {
                        note_index: i,
                        candidate_index: s.candidate_index,
                        reason: s.reason.clone(),
                    }
                }
                _ => Selection {
                    note_index: i,
                    candidate_index: 0,
                    reason: "启发式最高分".into(),
                },
            }
        })
        .collect()
}

#[derive(Serialize)]
struct ApiRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: [ApiMessage<'a>; 1],
}

#[derive(Serialize)]
struct ApiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

// ── 减字谱单字图像识别（多模态） ───────────────────────────────
//
// 复用 Anthropic Messages API，但 content 改为多块数组：一张 base64 图片
// + 一段文本指令。下面这组结构即对应官方多模态消息格式。

#[derive(Serialize)]
struct ImageSource<'a> {
    #[serde(rename = "type")]
    source_type: &'static str, // "base64"
    media_type: &'a str,
    data: &'a str,
}

#[derive(Serialize)]
struct ContentBlock<'a> {
    #[serde(rename = "type")]
    block_type: &'static str, // "image" | "text"
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<ImageSource<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<&'a str>,
}

#[derive(Serialize)]
struct RecognizeMessage<'a> {
    role: &'static str,
    content: Vec<ContentBlock<'a>>,
}

#[derive(Serialize)]
struct RecognizeApiRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<RecognizeMessage<'a>>,
}

/// `POST /api/v1/jianzi/recognize` 请求体。
#[derive(Debug, Deserialize)]
pub struct RecognizeRequest {
    /// 图片原始 base64（不含 data URL 前缀）。
    pub image_base64: String,
    /// 图片 MIME 类型，仅允许 image/jpeg|png|webp，否则路由层拒绝。
    #[serde(default = "default_media_type")]
    pub media_type: String,
}

fn default_media_type() -> String {
    "image/jpeg".to_string()
}

/// `POST /api/v1/jianzi/recognize` 响应体。
///
/// `method` 为 `"llm"`（识别成功）或 `"unavailable"`（未配置密钥）。
/// `glyph` 为模型给出的规范减字文本（如「散挑一」「大九勾四」），
/// 前端再用 `parseJianziText` 解析为可视化状态；`explanation` 提供识别依据，
/// 对应白皮书强调的"可解释性"。
#[derive(Debug, Serialize)]
pub struct RecognizeResponse {
    pub method: &'static str,
    pub glyph: Option<String>,
    pub explanation: Option<String>,
    pub confidence: Option<f32>,
}

/// 构造识别系统提示词。
pub fn build_recognize_system() -> String {
    "你是古琴减字谱识别专家。给定一张古琴减字谱单字图片，识别其减字（指法谱字）并输出规范文本。\
     减字从左到右/上到下的组成顺序为：音色前缀（散/泛/按，按音常省略不写）、左手指法（大/名/中/食/跪，可用偏旁亻/夕）、\
     徽位（一~十三，可带分如三分）、右手指法（勾/挑/抹/托/剔/打/摘/劈/擘，复合如勾剔/抹挑/打摘/抹勾）、弦序（一~七）。\
     只输出 JSON，不要输出其他任何文字。"
        .to_string()
}

/// 构造识别用户指令（含图片块，由调用方拼入）。
pub fn build_recognize_user() -> String {
    "请识别这张减字谱单字图片，输出 JSON：\
     {\"glyph\": \"规范减字文本，如 散挑一 / 大九勾四\", \
      \"explanation\": \"识别依据（哪部分对应哪个部件）\", \
      \"confidence\": 0到1的置信度}"
        .to_string()
}

/// 解析模型输出：容忍 ```json 代码围栏；空 glyph 归为 None。
pub fn parse_recognition(text: &str) -> RecognizeResponse {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    #[derive(Deserialize)]
    struct RawRecognition {
        glyph: Option<String>,
        #[serde(default)]
        explanation: Option<String>,
        #[serde(default)]
        confidence: Option<f32>,
    }

    let raw: RawRecognition = serde_json::from_str(cleaned).unwrap_or(RawRecognition {
        glyph: None,
        explanation: None,
        confidence: None,
    });

    RecognizeResponse {
        method: "llm",
        glyph: raw.glyph.filter(|g| !g.trim().is_empty()),
        explanation: raw.explanation,
        confidence: raw.confidence,
    }
}

/// 调用 Anthropic Messages API 做多模态减字谱识别；未配置密钥时返回 `Ok(None)`。
pub async fn recognize_jianzi_with_llm(
    config: &LlmConfig,
    image_base64: &str,
    media_type: &str,
) -> anyhow::Result<Option<RecognizeResponse>> {
    if let ApiStyle::OpenAi = config.api_style {
        return recognize_jianzi_openai(config, image_base64, media_type).await;
    }
    let Some(api_key) = config.api_key.as_deref() else {
        return Ok(None);
    };

    let system = build_recognize_system();
    let user = build_recognize_user();
    let body = RecognizeApiRequest {
        model: &config.model,
        max_tokens: 512,
        system: &system,
        messages: vec![RecognizeMessage {
            role: "user",
            content: vec![
                ContentBlock {
                    block_type: "image",
                    source: Some(ImageSource {
                        source_type: "base64",
                        media_type,
                        data: image_base64,
                    }),
                    text: None,
                },
                ContentBlock {
                    block_type: "text",
                    source: None,
                    text: Some(&user),
                },
            ],
        }],
    };

    let resp = config
        .client
        .post(&config.base_url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("anthropic api {status}: {text}");
    }

    let api_resp: ApiResponse = resp.json().await?;
    let text = api_resp
        .content
        .first()
        .map(|c| c.text.as_str())
        .unwrap_or("");

    Ok(Some(parse_recognition(text)))
}

/// OpenAI 兼容模式下的单字识别：把图片作为 `image_url` 多模态消息发出，
/// 解析 `choices[].message.content` 后复用与 Anthropic 相同的 `parse_recognition`。
async fn recognize_jianzi_openai(
    config: &LlmConfig,
    image_base64: &str,
    media_type: &str,
) -> anyhow::Result<Option<RecognizeResponse>> {
    if config.openai_api_key.is_none() {
        return Ok(None);
    }
    let system = build_recognize_system();
    let user = build_recognize_user();
    // 单字输出虽短，但推理型模型思考很费 token；给足预算避免 finish_reason=length。
    let text = call_openai_vision(config, &system, &user, image_base64, media_type, 2048).await?;
    Ok(Some(parse_recognition(&text)))
}

/// 调用 OpenAI 兼容的多模态 chat/completions，返回助手文本。
///
/// 与 Anthropic 路径的区别仅在请求/响应信封：图片走 `image_url` 内容块、
/// 鉴权走 `Authorization: Bearer`、文本取自 `choices[0].message.content`。
///
/// 两处刻意的「不静默」处理：
/// 1. 默认带 `thinking: {"type": "disabled"}`——推理型模型开着思考会把
///    `max_tokens` 全烧在推理上，`content` 恒为空；网关不认识该字段则去掉重试。
/// 2. `content` 为空直接报错，而不是让上游 `parse_recognition` 把它悄悄
///    解析成 `glyph: null`（那会得到一个假的 HTTP 200 绿灯）。
async fn call_openai_vision(
    config: &LlmConfig,
    system: &str,
    user_text: &str,
    image_base64: &str,
    media_type: &str,
    max_tokens: u32,
) -> anyhow::Result<String> {
    let key = config.openai_api_key.clone().unwrap_or_default();
    let data_url = format!("data:{media_type};base64,{image_base64}");
    let mut body = serde_json::json!({
        "model": config.openai_model,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                {"type": "text", "text": user_text},
            ]},
        ],
    });
    if config.openai_disable_thinking {
        body["thinking"] = serde_json::json!({"type": "disabled"});
    }

    let mut resp = send_openai_request(config, &key, &body).await?;

    // 少数 OpenAI 兼容网关不认识 `thinking` 会直接 400；去掉该字段重试一次，
    // 让「关思考」成为零成本的默认增强，而不是兼容性负担。
    if resp.status().as_u16() == 400 && config.openai_disable_thinking {
        let text = resp.text().await.unwrap_or_default();
        let lower = text.to_lowercase();
        if !(lower.contains("thinking") || lower.contains("unrecognized")) {
            anyhow::bail!("openai api 400: {text}");
        }
        if let Some(obj) = body.as_object_mut() {
            obj.remove("thinking");
        }
        resp = send_openai_request(config, &key, &body).await?;
    }

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("openai api {status}: {text}");
    }

    let api: OpenAIChatResponse = resp.json().await?;
    let (content, finish) = match api.choices.into_iter().next() {
        Some(c) => (c.message.content.unwrap_or_default(), c.finish_reason),
        None => (String::new(), None),
    };

    if content.trim().is_empty() {
        anyhow::bail!(
            "模型返回空内容（finish_reason={finish:?}）。\
             常见原因：推理型模型把 max_tokens 耗尽在思考上 —— 设 \
             OPENAI_DISABLE_THINKING=true，或换用非推理的视觉模型 / 调大 max_tokens"
        );
    }
    Ok(content)
}

async fn send_openai_request(
    config: &LlmConfig,
    key: &str,
    body: &serde_json::Value,
) -> anyhow::Result<reqwest::Response> {
    Ok(config
        .client
        .post(&config.openai_base_url)
        .bearer_auth(key)
        .json(body)
        .send()
        .await?)
}

#[derive(Deserialize)]
struct OpenAIChatResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIMessageContent,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIMessageContent {
    content: Option<String>,
}

/// 整页减字谱识别：单个字格的识别结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecognizeSheetCell {
    /// 行号：从上到下，首行 = 0
    pub row: usize,
    /// 列号：从左到右，最左列 = 0（减字谱实际阅读顺序为同排从右到左，前端导入时按此换算）
    pub col: usize,
    /// 规范减字文本；看不清为 null
    pub glyph: Option<String>,
    /// 识别依据（可解释性）
    pub explanation: Option<String>,
    /// 0~1 置信度
    pub confidence: Option<f32>,
}

/// `POST /api/v1/jianzi/recognize-sheet` 响应体。
///
/// `method` 为 `"llm"`（识别成功）或 `"unavailable"`（未配置密钥）。
#[derive(Debug, Serialize)]
pub struct RecognizeSheetResponse {
    pub method: &'static str,
    pub cells: Vec<RecognizeSheetCell>,
}

/// 构造整页识别系统提示词。
pub fn build_recognize_sheet_system() -> String {
    "你是古琴减字谱识别专家。给定一张整页减字谱图片（可能含多行多列的字格），\
     识别其中每一个减字谱字。减字谱传统上从右往左、自上而下阅读。\
     请输出每个字格的网格坐标：row 为从上到下的行号（首行=0），col 为从左到右的列号（最左列=0）。\
     减字组成同单字：音色前缀（散/泛/按）+ 左手指法（大/名/中/食/跪）+ 徽位（一~十三，可带分）\
     + 右手指法（勾/挑/抹/托/剔/打/摘/劈/擘，复合如勾剔/抹挑/打摘/抹勾）+ 弦序（一~七）。\
     只输出 JSON，不要输出其他任何文字。"
        .to_string()
}

/// 构造整页识别用户指令（含图片块，由调用方拼入）。
pub fn build_recognize_sheet_user() -> String {
    "请识别这张整页减字谱，输出 JSON 数组，每个元素：\
     {\"row\": 行号(从0起，上→下), \"col\": 列号(从0起，左→右), \
      \"glyph\": \"规范减字文本如 散挑一/大九勾四\", \
      \"explanation\": \"识别依据\", \"confidence\": 0到1}。\
     若某字格看不清，glyph 设为 null。请尽量给出准确坐标。"
        .to_string()
}

/// 解析整页识别模型输出：容忍 ```json 围栏；接受顶层数组或 `{"cells":[...]}`；
/// 越界坐标归零、空 glyph 归为 None。
pub fn parse_sheet_recognition(text: &str) -> RecognizeSheetResponse {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    #[derive(Deserialize)]
    struct RawCell {
        row: Option<usize>,
        col: Option<usize>,
        glyph: Option<String>,
        #[serde(default)]
        explanation: Option<String>,
        #[serde(default)]
        confidence: Option<f32>,
    }

    #[derive(Deserialize)]
    struct RawSheet {
        cells: Option<Vec<RawCell>>,
    }

    let raw_cells: Vec<RawCell> = if let Ok(arr) = serde_json::from_str::<Vec<RawCell>>(cleaned) {
        arr
    } else if let Ok(obj) = serde_json::from_str::<RawSheet>(cleaned) {
        obj.cells.unwrap_or_default()
    } else {
        Vec::new()
    };

    let cells = raw_cells
        .into_iter()
        .map(|c| RecognizeSheetCell {
            row: c.row.unwrap_or(0),
            col: c.col.unwrap_or(0),
            glyph: c.glyph.filter(|g| !g.trim().is_empty()),
            explanation: c.explanation,
            confidence: c.confidence,
        })
        .collect();

    RecognizeSheetResponse {
        method: "llm",
        cells,
    }
}

/// 调用 Anthropic Messages API 做整页减字谱识别；未配置密钥时返回 `Ok(None)`。
pub async fn recognize_sheet_with_llm(
    config: &LlmConfig,
    image_base64: &str,
    media_type: &str,
) -> anyhow::Result<Option<RecognizeSheetResponse>> {
    if let ApiStyle::OpenAi = config.api_style {
        return recognize_sheet_openai(config, image_base64, media_type).await;
    }
    let Some(api_key) = config.api_key.as_deref() else {
        return Ok(None);
    };

    let system = build_recognize_sheet_system();
    let user = build_recognize_sheet_user();
    let body = RecognizeApiRequest {
        model: &config.model,
        // 整页可能含数十个减字，给足输出预算
        max_tokens: 4096,
        system: &system,
        messages: vec![RecognizeMessage {
            role: "user",
            content: vec![
                ContentBlock {
                    block_type: "image",
                    source: Some(ImageSource {
                        source_type: "base64",
                        media_type,
                        data: image_base64,
                    }),
                    text: None,
                },
                ContentBlock {
                    block_type: "text",
                    source: None,
                    text: Some(&user),
                },
            ],
        }],
    };

    let resp = config
        .client
        .post(&config.base_url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("anthropic api {status}: {text}");
    }

    let api_resp: ApiResponse = resp.json().await?;
    let text = api_resp
        .content
        .first()
        .map(|c| c.text.as_str())
        .unwrap_or("");

    Ok(Some(parse_sheet_recognition(text)))
}

/// OpenAI 兼容模式下的整页识别：与单字同样走 `call_openai_vision`，
/// 仅 system/user 提示词与输出预算不同，解析复用 `parse_sheet_recognition`。
async fn recognize_sheet_openai(
    config: &LlmConfig,
    image_base64: &str,
    media_type: &str,
) -> anyhow::Result<Option<RecognizeSheetResponse>> {
    if config.openai_api_key.is_none() {
        return Ok(None);
    }
    let system = build_recognize_sheet_system();
    let user = build_recognize_sheet_user();
    // 整页可能含数十个减字，给足输出预算
    let text = call_openai_vision(config, &system, &user, image_base64, media_type, 4096).await?;
    Ok(Some(parse_sheet_recognition(&text)))
}

#[derive(Deserialize)]
struct ApiResponse {
    content: Vec<ApiContent>,
}

#[derive(Deserialize)]
struct ApiContent {
    text: String,
}

/// 调用 Anthropic Messages API 选择候选；未配置密钥时返回 `Ok(None)`。
pub async fn select_with_llm(
    config: &LlmConfig,
    notes: &[JianpuNote],
    tuning: Tuning,
    candidates_per_note: &[Vec<JianziCandidate>],
) -> anyhow::Result<Option<Vec<Selection>>> {
    let Some(api_key) = config.api_key.as_deref() else {
        return Ok(None);
    };

    let (system, user) = build_prompt(notes, tuning, candidates_per_note);
    let body = ApiRequest {
        model: &config.model,
        max_tokens: 1024,
        system: &system,
        messages: [ApiMessage {
            role: "user",
            content: &user,
        }],
    };

    let resp = config
        .client
        .post(&config.base_url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("anthropic api {status}: {text}");
    }

    let api_resp: ApiResponse = resp.json().await?;
    let text = api_resp
        .content
        .first()
        .map(|c| c.text.as_str())
        .unwrap_or("");

    Ok(Some(parse_selections(
        text,
        notes.len(),
        candidates_per_note,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use taiyin_core::{Hui, HuiPosition, LeftFinger, RightAction, StringNumber};

    fn open(string: u8) -> JianziCandidate {
        JianziCandidate {
            score: 150,
            note: GuqinNote::open_string(RightAction::Tiao, StringNumber::new(string).unwrap()),
        }
    }

    fn pressed(string: u8) -> JianziCandidate {
        JianziCandidate {
            score: 100,
            note: GuqinNote::pressed(
                LeftFinger::Da,
                HuiPosition {
                    hui: Hui::new(9).unwrap(),
                    fen: None,
                },
                RightAction::Gou,
                StringNumber::new(string).unwrap(),
            ),
        }
    }

    #[test]
    fn test_describe_candidate() {
        assert_eq!(describe(&open(1).note), "散挑一");
        assert_eq!(describe(&pressed(3).note), "大9勾三");
    }

    #[test]
    fn test_build_prompt_includes_notes_and_candidates() {
        let notes = [JianpuNote::new(5, 0), JianpuNote::new(6, 1)];
        let cands = vec![vec![open(1)], vec![pressed(5)]];
        let (system, user) = build_prompt(&notes, Tuning::ZhengDiao, &cands);
        assert!(system.contains("减字谱编配专家"));
        assert!(user.contains("正调"));
        assert!(user.contains("5"));
        assert!(user.contains("6（高八度）"));
        assert!(user.contains("散挑一"));
        assert!(user.contains("大9勾五"));
    }

    #[test]
    fn test_parse_selections_strips_code_fences() {
        let cands = vec![vec![open(1), pressed(2)]];
        let text = "```json\n{\"selections\":[{\"note_index\":0,\"candidate_index\":1,\"reason\":\"把位连贯\"}]}\n```";
        let sels = parse_selections(text, 1, &cands);
        assert_eq!(sels[0].candidate_index, 1);
        assert_eq!(sels[0].reason, "把位连贯");
    }

    #[test]
    fn test_parse_selections_clamps_and_fills() {
        let cands = vec![vec![open(1)], vec![pressed(2)]];
        // note 0 索引越界 → 回退 top1；note 1 缺失 → 补齐
        let text = r#"{"selections":[{"note_index":0,"candidate_index":9,"reason":"x"}]}"#;
        let sels = parse_selections(text, 2, &cands);
        assert_eq!(sels.len(), 2);
        assert_eq!(sels[0].candidate_index, 0);
        assert_eq!(sels[1].candidate_index, 0);
    }

    #[test]
    fn test_parse_selections_invalid_json_falls_back() {
        let cands = vec![vec![open(1)]];
        let sels = parse_selections("模型说胡话", 1, &cands);
        assert_eq!(sels[0].candidate_index, 0);
    }

    #[test]
    fn test_heuristic_top1() {
        let cands = vec![vec![open(1), pressed(2)], vec![pressed(5)]];
        let sels = heuristic_selections(&cands);
        assert_eq!(sels.len(), 2);
        assert!(sels.iter().all(|s| s.candidate_index == 0));
    }

    #[tokio::test]
    async fn test_select_with_llm_without_key_returns_none() {
        let config = LlmConfig::default();
        let notes = [JianpuNote::new(5, 0)];
        let cands = vec![vec![open(1)]];
        let result = select_with_llm(&config, &notes, Tuning::ZhengDiao, &cands)
            .await
            .unwrap();
        assert!(result.is_none());
    }

    // ── 减字谱图像识别（多模态） ──

    #[test]
    fn test_build_recognize_prompt_covers_parts() {
        let system = build_recognize_system();
        let user = build_recognize_user();
        assert!(system.contains("古琴减字谱识别专家"));
        assert!(system.contains("徽位"));
        assert!(system.contains("弦序"));
        assert!(system.contains("只输出 JSON"));
        assert!(user.contains("glyph"));
        assert!(user.contains("confidence"));
    }

    #[test]
    fn test_parse_recognition_strips_fences_and_parses() {
        let text = "```json\n{\"glyph\":\"大九勾四\",\"explanation\":\"左手指大、徽位九、右手指勾、弦四\",\"confidence\":0.82}\n```";
        let r = parse_recognition(text);
        assert_eq!(r.method, "llm");
        assert_eq!(r.glyph.as_deref(), Some("大九勾四"));
        assert!(r.explanation.as_deref().unwrap().contains("徽位九"));
        assert_eq!(r.confidence, Some(0.82));
    }

    #[test]
    fn test_parse_recognition_empty_glyph_becomes_none() {
        let r =
            parse_recognition("{\"glyph\":\"  \",\"explanation\":\"看不清\",\"confidence\":0.1}");
        assert_eq!(r.glyph, None);
        assert_eq!(r.explanation.as_deref(), Some("看不清"));
    }

    #[test]
    fn test_parse_recognition_invalid_json_falls_back() {
        let r = parse_recognition("模型拒绝回答");
        assert_eq!(r.glyph, None);
        assert_eq!(r.method, "llm");
    }

    #[tokio::test]
    async fn test_recognize_without_key_returns_none() {
        let config = LlmConfig::default();
        let result = recognize_jianzi_with_llm(&config, "AAAA", "image/jpeg")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    // ── 整页减字谱图像识别（多模态） ──

    #[test]
    fn test_build_recognize_sheet_prompt_covers_grid() {
        let system = build_recognize_sheet_system();
        let user = build_recognize_sheet_user();
        assert!(system.contains("整页减字谱"));
        assert!(system.contains("从右往左"));
        assert!(user.contains("\"row\""));
        assert!(user.contains("\"col\""));
        assert!(user.contains("glyph"));
    }

    #[test]
    fn test_parse_sheet_recognition_strips_fences() {
        let text = "```json\n[{\"row\":0,\"col\":2,\"glyph\":\"散挑一\",\"confidence\":0.9},{\"row\":0,\"col\":1,\"glyph\":\"大九勾四\"}]\n```";
        let r = parse_sheet_recognition(text);
        assert_eq!(r.method, "llm");
        assert_eq!(r.cells.len(), 2);
        assert_eq!(r.cells[0].row, 0);
        assert_eq!(r.cells[0].col, 2);
        assert_eq!(r.cells[0].glyph.as_deref(), Some("散挑一"));
        assert_eq!(r.cells[1].glyph.as_deref(), Some("大九勾四"));
    }

    #[test]
    fn test_parse_sheet_recognition_accepts_cells_object() {
        let text = "{\"cells\":[{\"row\":1,\"col\":0,\"glyph\":null,\"explanation\":\"看不清\"}]}";
        let r = parse_sheet_recognition(text);
        assert_eq!(r.cells.len(), 1);
        assert_eq!(r.cells[0].row, 1);
        assert_eq!(r.cells[0].glyph, None);
        assert_eq!(r.cells[0].explanation.as_deref(), Some("看不清"));
    }

    #[test]
    fn test_parse_sheet_recognition_empty_glyph_becomes_none() {
        let text = "[{\"row\":0,\"col\":0,\"glyph\":\"  \",\"confidence\":0.1}]";
        let r = parse_sheet_recognition(text);
        assert_eq!(r.cells.len(), 1);
        assert_eq!(r.cells[0].glyph, None);
    }

    #[test]
    fn test_parse_sheet_recognition_invalid_json_empty() {
        let r = parse_sheet_recognition("模型拒绝回答");
        assert_eq!(r.method, "llm");
        assert!(r.cells.is_empty());
    }

    #[tokio::test]
    async fn test_recognize_sheet_without_key_returns_none() {
        let config = LlmConfig::default();
        let result = recognize_sheet_with_llm(&config, "AAAA", "image/jpeg")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    // ------------------------------------------------------------------
    // OpenAI 兼容路径：用本地假端点验证「真实发出什么、收到什么」。
    // 这些分支（thinking 重试 / 空内容报错 / 非 2xx）坏了会静默失败，
    // 只测 parse_* 是测不到的。
    // ------------------------------------------------------------------

    /// 在本地起一个按脚本依次应答的假 chat/completions 端点。
    ///
    /// 返回 (完整 URL, 捕获到的原始请求列表)。捕获的是「头 + 体」的原始文本，
    /// 便于同时断言鉴权头与 JSON 载荷。
    fn spawn_mock_openai(
        responses: Vec<(u16, String)>,
    ) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::{Arc, Mutex};

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let addr = listener.local_addr().expect("local addr");
        let url = format!("http://{addr}/v1/chat/completions");
        let captured = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&captured);

        std::thread::spawn(move || {
            for (status, body) in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                // 读到请求体完整为止（按 Content-Length）。
                let mut raw = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let n = stream.read(&mut chunk).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&chunk[..n]);
                    let Some(head_end) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
                        continue;
                    };
                    let head = String::from_utf8_lossy(&raw[..head_end]).to_lowercase();
                    let len = head
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if raw.len() >= head_end + 4 + len {
                        break;
                    }
                }
                sink.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&raw).to_string());

                let response = format!(
                    "HTTP/1.1 {status} MOCK\r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });

        (url, captured)
    }

    /// OpenAI 风格的成功响应体；`content` 是模型回的文本（通常是 JSON 字符串）。
    fn mock_chat_body(content: &str, finish_reason: &str) -> String {
        serde_json::json!({
            "choices": [{
                "message": { "content": content },
                "finish_reason": finish_reason
            }]
        })
        .to_string()
    }

    /// 取出请求体（去掉 HTTP 头）并解析为 JSON。
    fn captured_body(raw: &str) -> serde_json::Value {
        let idx = raw.find("\r\n\r\n").expect("request should have headers");
        serde_json::from_str(&raw[idx + 4..]).expect("request body should be JSON")
    }

    fn openai_config(url: &str) -> LlmConfig {
        LlmConfig {
            api_style: ApiStyle::OpenAi,
            openai_api_key: Some("test-key".into()),
            openai_base_url: url.into(),
            openai_model: "test-vision-model".into(),
            openai_disable_thinking: true,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn test_openai_recognize_sends_image_model_and_bearer_auth() {
        let glyph_json = r#"{"glyph":"散挑一","explanation":"左散右挑下弦一","confidence":0.9}"#;
        let (url, captured) = spawn_mock_openai(vec![(200, mock_chat_body(glyph_json, "stop"))]);

        let result = recognize_jianzi_with_llm(&openai_config(&url), "QUJD", "image/png")
            .await
            .unwrap()
            .expect("should return a recognition");

        // 1) 识别结果被正确解析
        assert_eq!(result.glyph.as_deref(), Some("散挑一"));
        assert_eq!(result.method, "llm");

        // 2) 请求真的带上了 Bearer 鉴权
        let raw = captured.lock().unwrap()[0].clone();
        let lower = raw.to_lowercase();
        assert!(
            lower.contains("authorization: bearer test-key"),
            "缺少 Bearer 鉴权头: {}",
            &raw[..raw.len().min(300)]
        );

        // 3) 载荷形状：模型名 / 图文两块 / data URL / 关思考 / 输出预算
        let body = captured_body(&raw);
        assert_eq!(body["model"], "test-vision-model");
        assert_eq!(body["max_tokens"], 2048);
        assert_eq!(body["thinking"]["type"], "disabled");
        let content = &body["messages"][1]["content"];
        assert_eq!(content[0]["type"], "image_url");
        assert_eq!(content[0]["image_url"]["url"], "data:image/png;base64,QUJD");
        assert_eq!(content[1]["type"], "text");
    }

    #[tokio::test]
    async fn test_openai_retries_without_thinking_when_gateway_rejects_it() {
        let glyph_json = r#"{"glyph":"大九勾四","confidence":0.8}"#;
        let reject = r#"{"error":{"message":"Unrecognized field: thinking"}}"#.to_string();
        let (url, captured) = spawn_mock_openai(vec![
            (400, reject),
            (200, mock_chat_body(glyph_json, "stop")),
        ]);

        let result = recognize_jianzi_with_llm(&openai_config(&url), "QUJD", "image/png")
            .await
            .unwrap()
            .expect("retry should succeed");

        assert_eq!(result.glyph.as_deref(), Some("大九勾四"));
        let requests = captured.lock().unwrap();
        assert_eq!(requests.len(), 2, "400 提到 thinking 时应重试一次");
        let first = captured_body(&requests[0]);
        let second = captured_body(&requests[1]);
        assert_eq!(first["thinking"]["type"], "disabled");
        assert!(
            second.get("thinking").is_none(),
            "重试请求必须去掉 thinking 字段"
        );
        // 重试不能丢掉原请求的关键内容
        assert_eq!(second["model"], "test-vision-model");
    }

    #[tokio::test]
    async fn test_openai_does_not_retry_on_unrelated_400() {
        let (url, captured) = spawn_mock_openai(vec![(
            400,
            r#"{"error":{"message":"context length exceeded"}}"#.to_string(),
        )]);

        let err = recognize_jianzi_with_llm(&openai_config(&url), "QUJD", "image/png")
            .await
            .expect_err("无关的 400 应直接失败");

        assert!(err.to_string().contains("400"), "错误应包含状态码: {err}");
        assert_eq!(
            captured.lock().unwrap().len(),
            1,
            "只在 thinking 相关 400 时才重试，不能盲目重试"
        );
    }

    #[tokio::test]
    async fn test_openai_empty_content_is_an_error_not_a_fake_success() {
        // 复现真实踩坑：推理型模型把预算烧在 thinking 上，content 为空、
        // finish_reason=length。这里必须报错，而不是返回 glyph:null 的 200。
        let (url, _captured) = spawn_mock_openai(vec![(200, mock_chat_body("", "length"))]);

        let err = recognize_jianzi_with_llm(&openai_config(&url), "QUJD", "image/png")
            .await
            .expect_err("空内容必须是错误");

        let msg = err.to_string();
        assert!(msg.contains("空内容"), "错误应说明空内容: {msg}");
        assert!(msg.contains("length"), "错误应带上 finish_reason: {msg}");
    }

    #[tokio::test]
    async fn test_openai_non_2xx_surfaces_status_and_body() {
        let (url, _captured) = spawn_mock_openai(vec![(500, "upstream boom".to_string())]);

        let err = recognize_jianzi_with_llm(&openai_config(&url), "QUJD", "image/png")
            .await
            .expect_err("500 应失败");

        let msg = err.to_string();
        assert!(msg.contains("500"), "应包含状态码: {msg}");
        assert!(msg.contains("upstream boom"), "应带上上游响应体: {msg}");
    }

    #[tokio::test]
    async fn test_openai_disabled_thinking_omits_field() {
        let glyph_json = r#"{"glyph":"挑七","confidence":0.9}"#;
        let (url, captured) = spawn_mock_openai(vec![(200, mock_chat_body(glyph_json, "stop"))]);
        let mut config = openai_config(&url);
        config.openai_disable_thinking = false;

        recognize_jianzi_with_llm(&config, "QUJD", "image/png")
            .await
            .unwrap();

        let body = captured_body(&captured.lock().unwrap()[0]);
        assert!(
            body.get("thinking").is_none(),
            "OPENAI_DISABLE_THINKING=false 时不应发送 thinking 字段"
        );
    }

    #[tokio::test]
    async fn test_openai_sheet_recognition_uses_bigger_budget_and_keeps_grid() {
        let cells = serde_json::json!({
            "cells": [
                {"row": 0, "col": 0, "glyph": "散挑一", "explanation": "散音挑一弦", "confidence": 0.9},
                {"row": 0, "col": 1, "glyph": null, "explanation": "看不清", "confidence": 0.2}
            ]
        })
        .to_string();
        let (url, captured) = spawn_mock_openai(vec![(200, mock_chat_body(&cells, "stop"))]);

        let result = recognize_sheet_with_llm(&openai_config(&url), "QUJD", "image/png")
            .await
            .unwrap()
            .expect("should return a sheet");

        assert_eq!(result.cells.len(), 2);
        assert_eq!(result.cells[0].glyph.as_deref(), Some("散挑一"));
        assert_eq!((result.cells[1].row, result.cells[1].col), (0, 1));
        assert_eq!(result.cells[1].glyph, None);

        // 整页输出预算必须远大于单字（否则几十个格子会被截断）
        let body = captured_body(&captured.lock().unwrap()[0]);
        assert_eq!(body["max_tokens"], 4096);
    }
}
