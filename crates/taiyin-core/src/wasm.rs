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

use wasm_bindgen::prelude::*;

use crate::{GuqinNote, GuqinScore};

fn json_error(e: &impl std::fmt::Display) -> String {
    format!("{{\"error\":\"{}\"}}", e.to_string().replace('"', "\\\""))
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
    let action: crate::RightAction = match serde_json::from_str(&format!("\"{}\"", right_action)) {
        Ok(a) => a,
        Err(e) => return json_error(&e),
    };
    let note = GuqinNote::open_string(action, string_number);
    serde_json::to_string(&note).unwrap_or_default()
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
    let finger: crate::LeftFinger = match serde_json::from_str(&format!("\"{}\"", left_finger)) {
        Ok(f) => f,
        Err(e) => return json_error(&e),
    };
    let action: crate::RightAction = match serde_json::from_str(&format!("\"{}\"", right_action)) {
        Ok(a) => a,
        Err(e) => return json_error(&e),
    };
    let note = GuqinNote::pressed(
        finger,
        crate::HuiPosition {
            hui,
            fen: fen.filter(|&f| f > 0),
        },
        action,
        string_number,
    );
    serde_json::to_string(&note).unwrap_or_default()
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
    let finger: crate::LeftFinger = match serde_json::from_str(&format!("\"{}\"", left_finger)) {
        Ok(f) => f,
        Err(e) => return json_error(&e),
    };
    let action: crate::RightAction = match serde_json::from_str(&format!("\"{}\"", right_action)) {
        Ok(a) => a,
        Err(e) => return json_error(&e),
    };
    let note = GuqinNote::fan_yin(
        finger,
        crate::HuiPosition {
            hui,
            fen: fen.filter(|&f| f > 0),
        },
        action,
        string_number,
    );
    serde_json::to_string(&note).unwrap_or_default()
}

/// 创建一个空曲谱。
#[wasm_bindgen]
pub fn create_score(title: &str, author: &str) -> String {
    let score = GuqinScore::new(title, author);
    serde_json::to_string(&score).unwrap_or_default()
}
