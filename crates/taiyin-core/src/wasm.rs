//! WASM 桥接模块 —— 前端通过 wasm-pack 导入。
//!
//! 策略：JSON 字符串输入/输出桥接。避免将 Rust 复杂枚举直接映射到 JS 类型，
//! 而是接受/返回 JSON 字符串，使用 serde_json 做转换。

use wasm_bindgen::prelude::*;

fn json_error(e: &impl std::fmt::Display) -> String {
    serde_json::json!({"error": e.to_string()}).to_string()
}

/// 将简谱音符翻译为候选减字。
///
/// 输入 JSON: `{"number": 5, "octave": 0, "tuning": "ruibin"?}`
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
