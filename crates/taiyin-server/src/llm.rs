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

/// LLM 配置（注入 AppState）。
#[derive(Clone)]
pub struct LlmConfig {
    pub api_key: Option<String>,
    pub model: String,
    pub client: reqwest::Client,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            model: DEFAULT_MODEL.into(),
            client: reqwest::Client::new(),
        }
    }
}

impl LlmConfig {
    /// 从环境变量读取配置；`ANTHROPIC_API_KEY` 缺省或为空则禁用 LLM。
    pub fn from_env() -> Self {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .filter(|k| !k.is_empty());
        let model = std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.into());
        Self {
            api_key,
            model,
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
        .post(ANTHROPIC_URL)
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
        .post(ANTHROPIC_URL)
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
        .post(ANTHROPIC_URL)
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
}
