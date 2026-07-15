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
        s.push_str(&h.hui.to_string());
        if let Some(fen) = h.fen {
            s.push_str(&format!(".{fen}"));
        }
    }
    s.push_str(action_text(&note.right_action));
    s.push_str(DIGITS.get(note.string_number as usize).unwrap_or(&"?"));
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
    use taiyin_core::{HuiPosition, LeftFinger, RightAction};

    fn open(string: u8) -> JianziCandidate {
        JianziCandidate {
            score: 150,
            note: GuqinNote::open_string(RightAction::Tiao, string),
        }
    }

    fn pressed(string: u8) -> JianziCandidate {
        JianziCandidate {
            score: 100,
            note: GuqinNote::pressed(
                LeftFinger::Da,
                HuiPosition { hui: 9, fen: None },
                RightAction::Gou,
                string,
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
}
