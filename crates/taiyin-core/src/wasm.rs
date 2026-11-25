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

/// 按时值切句 —— 谱面画「第 N 句」、按句循环慢练都要用同一组句界。
///
/// 输入 JSON: `{"units": [8, 8, 16, 8]}`，单位是 1/8 拍（四分 = 8、二分 = 16），
/// `null` 表示这个音没给时值（按「没有气口」处理）。
/// 输出 JSON: `{"phrases": [{"start": 0, "end": 2}, {"start": 3, "end": 3}]}`，
/// 下标取自入参、两端都含。
///
/// 为什么单独导出一个函数，而不是让前端自己按 `时值 >= 两拍` 切：阈值在
/// [`crate::jianpu::phrase_ranges`] 里，前端抄一份就会各自漂——谱面上分了 5 句、
/// 编排按 4 句算，用户点「第 3 句」练到的却是别的地方，而且没有任何地方会报错。
/// 这里只做切分，不跑编排：画一条分隔线不该先算一遍最优指法。
#[wasm_bindgen]
pub fn split_phrases_to_json(input_json: &str) -> String {
    #[derive(serde::Deserialize)]
    struct PhraseRequest {
        units: Vec<Option<u32>>,
    }
    let req: PhraseRequest = match serde_json::from_str(input_json) {
        Ok(r) => r,
        Err(e) => return json_error(&e),
    };
    let phrases: Vec<serde_json::Value> = crate::jianpu::phrase_ranges(&req.units)
        .into_iter()
        .map(|(start, end)| serde_json::json!({ "start": start, "end": end }))
        .collect();
    serde_json::json!({ "phrases": phrases }).to_string()
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

/// 连打解析 —— 键盘逐键输入的核心文法，逻辑只在 Rust 这一份。
///
/// 输入 JSON: `{"input":"djg4","tone":"按","force":false}`
/// 输出 JSON: `{"state":{...},"consumed":4,"complete":true,"tokens":[...],"nextSlot":null}`
///
/// 网页、小程序、App 都调同一个函数：码表与回溯逻辑不再各写一份。
#[wasm_bindgen]
pub fn parse_rapid_input(input_json: &str) -> String {
    crate::jianzi_rapid::parse_rapid_input_json(input_json)
}

/// 各音色的连打槽位顺序，供客户端渲染输入提示。
///
/// 输出 JSON: `{"散":["rightAction","stringNumber","structureMark"],"泛":[...],"按":[...]}`
#[wasm_bindgen]
pub fn get_rapid_slots() -> String {
    crate::jianzi_rapid::slots_json().to_string()
}

/// 联袂成组归一化 —— 清掉删除/插入后不成立的联袂关系。
///
/// 输入 JSON: `{"notes":[{"id":"a","lianmei":{"kind":"同声","headId":"a"}}]}`
/// 输出 JSON: `{"notes":[...],"changed":false}`
///
/// `changed == false` 时调用方应沿用原数组引用：渲染路径每帧都会跑它，
/// 每次返回新数组会让 React 认为谱面一直在变。
#[wasm_bindgen]
pub fn normalize_lianmei(input_json: &str) -> String {
    match crate::lianmei::normalize_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 解析所有成立的联袂组。输入 `{"notes":[...]}` → `{"groups":[...]}`。
#[wasm_bindgen]
pub fn lianmei_groups(input_json: &str) -> String {
    match crate::lianmei::groups_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 判定两个频率的关系（同度 / 八度 / 不合）。
///
/// 输入 JSON: `{"freqA":440.0,"freqB":880.0}` → `{"relation":"八度"}`
#[wasm_bindgen]
pub fn lianmei_relation(input_json: &str) -> String {
    match crate::lianmei::relation_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 四种联袂指法的元数据（提示语、成员数、是否允许八度）。
#[wasm_bindgen]
pub fn get_lianmei_options() -> String {
    crate::lianmei::options_json()
}

/// 成组：把组首起的若干后续音连成一组。
///
/// 输入 JSON: `{"notes":[...],"headIndex":0,"kind":"同声","memberCount":1}`
/// 输出 JSON: `{"notes":[...],"changed":true}`
///
/// 越界时不硬凑（`changed=false`），调用方据此沿用原数组引用。
#[wasm_bindgen]
pub fn link_lianmei(input_json: &str) -> String {
    match crate::lianmei::link_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 解组：解除该下标所在的一整组联袂。
///
/// 输入 JSON: `{"notes":[...],"index":0}` → `{"notes":[...],"changed":true}`
#[wasm_bindgen]
pub fn clear_lianmei(input_json: &str) -> String {
    match crate::lianmei::clear_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 简谱字符串解析 —— 纯字符串转结构，逻辑只在 Rust 一份。
///
/// 输入 JSON: `{"input":"5 6 1 2 | 3 5 6 -"}`
/// 输出 JSON: `{"items":[{"kind":"note","number":5,"octave":0,"units":8,
///   "duration":"四分","dotted":false,"raw":"5"},...],"units":[8,8,8,8]}`
///
/// `units` 是「1/8 拍」为单位的时值（四分 = 8），与指法编排、切句同一口径。
#[wasm_bindgen]
pub fn parse_jianpu(input_json: &str) -> String {
    match crate::jianpu_parse::parse_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 只要时值单位（切句 / 编排用）：`{"input":"5 - 0_"}` → `{"units":[16,4]}`
#[wasm_bindgen]
pub fn get_jianpu_units(input_json: &str) -> String {
    match crate::jianpu_parse::units_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 减字 → 实际音高与简谱唱名 —— 物理模型只在 Rust 一份。
///
/// 输入 JSON: `{"stringNumber":4,"toneType":"按","hui":9,"fenFraction":null,
///   "tuning":"zhengdiao","concertPitch":440}`
/// 输出 JSON: `{"frequency":196.0,"jianpu":{"number":5,"octave":""}}`
///
/// 推不出时两个字段都是 `null`——**不猜**。一个错的音高比没有音高更糟：
/// 没人会去核对，只会照着一个错音练。
#[wasm_bindgen]
pub fn jianzi_pitch(input_json: &str) -> String {
    match crate::pitch::frequency_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 减字释义 —— 把谱字读成人话，文案只在 Rust 一份。
///
/// 输入 JSON: `{"state":{"toneType":"按","leftFinger":"大","hui":"九",
///   "rightAction":"勹","stringNumber":"四"},"tuning":"zhengdiao","concertPitch":440}`
/// 输出 JSON: `{"complete":true,"summary":"按音 · 左手大指按于四弦九徽，右手中指勾",
///   "parts":[{"label":"音色","text":"…"}],"pitchHint":"简谱 5 · 正调推定","missing":[]}`
///
/// 文案放核心里，是为了让网页、小程序、App 读出**同一句话**——
/// 两处说法不一，用户只会怀疑自己记错了。
#[wasm_bindgen]
pub fn explain_jianzi(input_json: &str) -> String {
    match crate::explain::explain_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 候选音位的短标签 —— 两行小字 + 读屏全称。
///
/// 输入 JSON: `{"state":{"toneType":"散","rightAction":"勹","stringNumber":"一"}}`
/// 输出 JSON: `{"primary":"一弦 · 散","secondary":"中指勾","full":"散音，一弦，右手中指勾"}`
///
/// 与 `explain_jianzi` 同一批指法表：短标签与完整读法不可能说法不一。
#[wasm_bindgen]
pub fn short_caption(input_json: &str) -> String {
    match crate::explain::short_caption_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 徽位 + 分位的位置描述（供前端同步渲染路径复用同一套文案）。
///
/// 输入：`{"hui":"七","fen":"六分"}`；输出：`"七徽六分 · 七徽与八徽之间，过七徽 6 成"`
#[wasm_bindgen]
pub fn describe_hui_position(input_json: &str) -> String {
    match crate::explain::describe_hui_position_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 编排结果的一句话文案（「已编排：少 3 次换弦、少 2 次音色切换」）。
///
/// 输入：`{"stats":…,"greedy_stats":…,"identical_to_greedy":…,"phrases":[…]}`；
/// 输出：裸文本（前端不再自己拼措辞——网页 / 小程序 / App 必须说同一句话）。
#[wasm_bindgen]
pub fn describe_arrangement(input_json: &str) -> String {
    match crate::describe::describe_arrangement_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 分句的一句话文案；只有一句时返回空串（短曲不硬标「第 1 句」）。
///
/// 输入：`{"phrases":[…]}`；输出：裸文本或空串。
#[wasm_bindgen]
pub fn describe_phrases(input_json: &str) -> String {
    match crate::describe::describe_phrases_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 5 个谱面结构记号及其释义。
#[wasm_bindgen]
pub fn structure_marks() -> String {
    crate::explain::structure_marks_json().unwrap_or_else(|e| json_error(&e))
}

/// 减字状态 → 字体可渲染的减字文本（「大九勾四」）。
///
/// 输入 JSON: `{"state":{"toneType":"按","leftFinger":"大","hui":"九",
///   "rightAction":"勹","stringNumber":"四"}}`
/// 输出 JSON: `"大九勾四"`
///
/// 序列化顺序就是字体连字规则：分数在前、内折记号在后、吟猱挂字尾。
/// 网页 / 小程序 / App 必须拼出同一个字，否则用户会以为「这个字坏了」。
#[wasm_bindgen]
pub fn jianzi_to_text(input_json: &str) -> String {
    match crate::jianzi_text::to_text_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}

/// 谱字 → 单音。只有简单形式能压回单音，复杂形式返回 `{"error":...}`。
///
/// 输入 JSON: `{"puzi": <Puzi JSON>}`；输出：`{"note": <GuqinNote>}` 或 `{"error": "..."}`。
#[wasm_bindgen]
pub fn puzi_to_note(input_json: &str) -> String {
    crate::puzi::to_note_json(input_json)
}

/// 曲谱里四种谱字形式各有多少。旧谱全部落 simple；出现其它三种才说明真用了新模型。
///
/// 输入 JSON: `GuqinScore`；输出：`{"total","simple","cuochuo","annotation","standalone"}`。
#[wasm_bindgen]
pub fn score_puzi_summary(input_json: &str) -> String {
    crate::puzi::score_summary_json(input_json)
}

/// 减字文本 → 状态。解析不出完整减字时返回 `null`。
///
/// 输入 JSON: `{"text":"大九勾四"}`；输出：状态对象或 `null`。
#[wasm_bindgen]
pub fn parse_jianzi_text(input_json: &str) -> String {
    match crate::jianzi_text::from_text_json(input_json) {
        Ok(s) => s,
        Err(e) => json_error(&e),
    }
}
