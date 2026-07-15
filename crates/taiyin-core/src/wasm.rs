//! WASM 桥接模块 —— 前端通过 wasm-pack 导入。
//!
//! 策略：JSON 字符串输入/输出桥接。避免将 Rust 复杂枚举直接映射到 JS 类型，
//! 而是接受/返回 JSON 字符串，使用 serde_json 做转换。
//! 前端调用的典型方式：
//!
//! ```js
//! import { parseNote, createScore } from "taiyin-core";
//!
//! const note = parseNote('{"right_action":"挑","string_number":5}');
//! const score = createScore("仙翁操", "传习");
//! ```

use serde::{Serialize, de::DeserializeOwned};
use wasm_bindgen::prelude::*;

use crate::{GuqinNote, GuqinScore};

fn json_error(e: &impl std::fmt::Display) -> String {
    serde_json::json!({"error": e.to_string()}).to_string()
}

fn deserialize_str<T: DeserializeOwned>(s: &str) -> Result<T, String> {
    serde_json::from_str(&format!("\"{}\"", s)).map_err(|e| json_error(&e))
}

fn build_hui(hui: u8, fen: Option<u8>) -> crate::HuiPosition {
    crate::HuiPosition {
        hui,
        fen: fen.filter(|&f| f > 0),
    }
}

fn ser_result<T: Serialize>(val: &T) -> String {
    serde_json::to_string(val).unwrap_or_default()
}

/// 解析并验证一个减字音符的 JSON。
/// 返回标准化后的 JSON。解析失败时返回 `{"error":"..."}`。
#[wasm_bindgen]
pub fn parse_note(json: &str) -> String {
    let note: GuqinNote = match serde_json::from_str(json) {
        Ok(n) => n,
        Err(e) => return json_error(&e),
    };
    serde_json::to_string(&note).unwrap_or_default()
}

/// 解析并验证整首曲谱 JSON。
#[wasm_bindgen]
pub fn parse_score(json: &str) -> String {
    let score: GuqinScore = match serde_json::from_str(json) {
        Ok(s) => s,
        Err(e) => return json_error(&e),
    };
    serde_json::to_string(&score).unwrap_or_default()
}

/// 创建一个散音（空弦音）。
/// right_action 使用 JSON 字符串格式，如 "挑"、"勾"、"抹"。
#[wasm_bindgen]
pub fn create_open_string_note(right_action: &str, string_number: u8) -> String {
    let action = match deserialize_str::<crate::RightAction>(right_action) {
        Ok(a) => a,
        Err(e) => return e,
    };
    ser_result(&GuqinNote::open_string(action, string_number))
}

/// 创建一个按音。
/// left_finger 使用 JSON 字符串格式，如 "Da"、"Ming"、"Zhong"、"Shi"、"Gui"。
#[wasm_bindgen]
pub fn create_pressed_note(
    left_finger: &str,
    hui: u8,
    fen: Option<u8>,
    right_action: &str,
    string_number: u8,
) -> String {
    let finger = match deserialize_str::<crate::LeftFinger>(left_finger) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let action = match deserialize_str::<crate::RightAction>(right_action) {
        Ok(a) => a,
        Err(e) => return e,
    };
    ser_result(&GuqinNote::pressed(
        finger,
        build_hui(hui, fen),
        action,
        string_number,
    ))
}

/// 创建一个泛音。
#[wasm_bindgen]
pub fn create_fan_yin_note(
    left_finger: &str,
    hui: u8,
    fen: Option<u8>,
    right_action: &str,
    string_number: u8,
) -> String {
    let finger = match deserialize_str::<crate::LeftFinger>(left_finger) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let action = match deserialize_str::<crate::RightAction>(right_action) {
        Ok(a) => a,
        Err(e) => return e,
    };
    ser_result(&GuqinNote::fan_yin(
        finger,
        build_hui(hui, fen),
        action,
        string_number,
    ))
}

/// 创建一个空曲谱。
#[wasm_bindgen]
pub fn create_score(title: &str, author: &str) -> String {
    ser_result(&GuqinScore::new(title, author))
}

/// 将简谱音符翻译为候选减字。
///
/// 输入 JSON: `{"number": 5, "octave": 0}`
#[derive(serde::Deserialize)]
struct TranslateRequest {
    number: u8,
    octave: i8,
    #[serde(default)]
    tuning: Option<crate::jianpu::Tuning>,
}

#[derive(serde::Deserialize)]
struct SequenceRequest {
    notes: Vec<crate::jianpu::JianpuNote>,
    #[serde(default)]
    tuning: Option<crate::jianpu::Tuning>,
}

/// 输出 JSON: `{"candidates": [{"score": 150, "note": {...}}]}`
#[wasm_bindgen]
pub fn translate_jianpu_to_jianzi(input_json: &str) -> String {
    let req: TranslateRequest = match serde_json::from_str(input_json) {
        Ok(r) => r,
        Err(e) => return json_error(&e),
    };
    let note = crate::jianpu::JianpuNote::new(req.number, req.octave);
    let tuning = req.tuning.unwrap_or(crate::jianpu::Tuning::ZhengDiao);
    let candidates = crate::jianpu::translate_jianpu(note, tuning);
    serde_json::json!({ "candidates": candidates }).to_string()
}

/// 将一串简谱音符批量翻译为候选减字。
///
/// 输入 JSON: `{"notes": [{"number": 5, "octave": 0}], "tuning": "ruibin"?}`
/// 输出 JSON: `{"candidates_per_note": [[...], [...]]}`
#[wasm_bindgen]
pub fn translate_jianpu_sequence_to_jianzi(input_json: &str) -> String {
    let req: SequenceRequest = match serde_json::from_str(input_json) {
        Ok(r) => r,
        Err(e) => return json_error(&e),
    };
    let tuning = req.tuning.unwrap_or(crate::jianpu::Tuning::ZhengDiao);
    let result = crate::jianpu::translate_jianpu_sequence(&req.notes, tuning);
    serde_json::json!({ "candidates_per_note": result }).to_string()
}
