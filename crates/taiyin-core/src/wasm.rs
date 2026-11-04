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

/// 整段简谱的**全局指法编排**（Viterbi 动态规划）。
///
/// 输入 JSON: `{"notes": [{"number": 5, "octave": 0}], "tuning": "ruibin"?}`
/// 输出 JSON:
/// `{"candidates_per_note": [[...]], "selections": [0, 0, null], "total_cost": 1234,
///   "stats": {...}, "greedy_stats": {...}, "identical_to_greedy": false,
///   "phrases": [{"index":0,"start":0,"end":11,"note_count":12,"stats":{...}}]}`
///
/// 与 `translate_jianpu_sequence_to_jianzi` 的区别：那一版逐音贪心，只跟前一个音
/// 比远近；这一版把整句当一条路径求全局最优，牺牲个别音的单音舒适度，
/// 换取整句少换把、少跨弦。两个字段（候选 / 选中）出自同一次计算，
/// 前端照单全收，不需要按索引去猜另一份数据。
///
/// `stats` / `greedy_stats` 是同一段简谱两条路径的活动量（换弦、同指挪位、
/// 技法切换），界面据此把「编排到底省了什么」说成琴人能懂的话；
/// `identical_to_greedy` 让界面在没有改善时不必硬夸。
///
/// `phrases` 是按气口切出来的乐句（前一个音留了两拍及以上即为一处气口），
/// 逐句带上 `start` / `end`（**输入数组**的下标，含两端）、音数与活动量。
/// 长曲一句一句练，界面据此标出「第几句」以及哪一句最赶。
#[wasm_bindgen]
pub fn arrange_jianpu_sequence_to_jianzi(input_json: &str) -> String {
    let req: SequenceRequest = match serde_json::from_str(input_json) {
        Ok(r) => r,
        Err(e) => return json_error(&e),
    };
    let tuning = req.tuning.unwrap_or(crate::jianpu::Tuning::ZhengDiao);
    let arrangement = crate::jianpu::arrange_sequence(&req.notes, tuning);
    serde_json::json!({
        "candidates_per_note": arrangement.candidates_per_note,
        "selections": arrangement.selections,
        "total_cost": arrangement.total_cost,
        "stats": arrangement.stats,
        "greedy_stats": arrangement.greedy_stats,
        "identical_to_greedy": arrangement.identical_to_greedy,
        "phrases": arrangement.phrases,
    })
    .to_string()
}

/// 减字字典（字全表）—— 返回经筛选 / 搜索后的减字目录。
///
/// 输入 JSON: `{"tone":"","left":"","action":"","string":"","query":""}`（各字段均可省略）。
/// 输出 JSON: `{"total":50,"entries":[{id,state,note?,common,searchText},...]}`。
///
/// 字典数据与筛选 / 搜索逻辑全部在 Rust（`jianzi_dictionary` 模块），
/// 前端仅负责把结果渲染成卡片与试听。
#[wasm_bindgen]
pub fn get_jianzi_dictionary(input_json: &str) -> String {
    match crate::jianzi_dictionary::get_jianzi_dictionary_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 减字字频统计 —— 给一首曲谱的减字，统计每个字出现次数、占比与写法变体。
///
/// 输入 JSON: `{"notes":[{toneType,leftFinger,hui,fen,slide,rightAction,stringNumber},...]}`
/// 输出 JSON: `{"total":N,"rows":[{id,label,count,ratio,toneType,...,leftVariants,actionVariants},...]}`
///
/// 按归一化字形聚合：名/夕、食/亻、省写（乚/勹/木/丁…）都会合并为同一减字，
/// 对应 LiberWord「系统自动合并所有标注」「每个字有多少变体」。
#[wasm_bindgen]
pub fn analyze_jianzi_frequency(input_json: &str) -> String {
    match crate::jianzi_stats::get_jianzi_frequency_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 减字写法变体对照表 —— 返回 `[{canonical, variants, note}, ...]` JSON。
#[wasm_bindgen]
pub fn get_jianzi_variant_groups() -> String {
    crate::jianzi_stats::get_jianzi_variant_groups_json()
}

/// 批量编码 —— 把一串减字压成码（如 `ad9g4`），供导出文本谱与按码检索。
///
/// 输入 JSON: `{"notes": [{"toneType":"散","rightAction":"勾","stringNumber":"三", ...}]}`
/// 输出 JSON: `{"codes": ["sg3", null, ...]}`（不完整的字给 null，不让整批失败）
#[wasm_bindgen]
pub fn encode_jianzi_batch(input_json: &str) -> String {
    match crate::jianzi_code::encode_batch_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 批量解码 —— 把整段粘回来的文本（码 + 简谱 + 减字 + 小节线混排）收回成减字。
///
/// 输入 JSON: `{"text": "ad9g4 sg3 | st5"}`
/// 输出 JSON: `{"total":3,"ok":2,"failed":1,"entries":[{"code","state","error"}]}`
///
/// 这是「导出 → 再导入」闭环的另一半：码能整段粘回来变成曲谱，
/// 才真的是一份可搬运的存档。切词与解码都在 Rust，前端只管渲染与建列。
#[wasm_bindgen]
pub fn decode_jianzi_batch(input_json: &str) -> String {
    match crate::jianzi_code::decode_batch_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}
