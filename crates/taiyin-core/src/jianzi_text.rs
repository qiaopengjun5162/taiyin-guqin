//! 减字的文本序列化与反序列化 —— 前端 `jianzi.ts` 的**唯一实现**。
//!
//! 这里处理的不是「编码串」（那是 `jianzi_code.rs` 的 `D4.9g`），
//! 而是**人能读、字体能渲染**的减字文本：
//!
//! ```text
//! 状态 {按, 大指, 九徽, 勾, 四弦}  →  "大九勾四"
//! "大九勾四"                        →  状态
//! ```
//!
//! # 为什么这段逻辑必须只有一份
//!
//! 它同时被三件事依赖，而这三年事分别发生在不同端：
//!
//! 1. **字体渲染**（网页 / 小程序 / App 的 WXML、DOM、原生文本）
//! 2. **谱面导出**（PNG / PDF / MIDI 文件名）
//! 3. **文本互操作**（粘贴传统谱本、识别结果回填）
//!
//! 同一串减字在网页上拼成整字、在小程序里散成两串，用户会以为「这个字坏了」。
//!
//! # 那些「奇怪」的顺序不是排版偏好
//!
//! 文件里每一处顺序约束都对应一次字体实测：
//! - 分数必须在右手指法前，否则「大九六绰勾四」散成两串（1em vs 2em）
//! - 吟猱族必须挂字尾，塞进内折槽会把整字劈成两坨（1.5em）
//! - 偏旁（亻/夕）字体没有连字，序列化时换全字（食/名）；解析两种都收
//!
//! 改这些顺序前先看注释里的实测数字，否则会静默毁掉渲染。

use serde::{Deserialize, Serialize};

/// 减字状态（与前端 `JianziState` 同形）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct JianziState {
    #[serde(rename = "toneType", default)]
    pub tone_type: Option<String>,
    #[serde(rename = "rhythmMode", default)]
    pub rhythm_mode: Option<String>,
    #[serde(rename = "leftFinger", default)]
    pub left_finger: Option<String>,
    #[serde(default)]
    pub hui: Option<String>,
    #[serde(default)]
    pub fen: Option<String>,
    #[serde(default)]
    pub slide: Option<String>,
    #[serde(rename = "rightAction", default)]
    pub right_action: Option<String>,
    #[serde(rename = "stringNumber", default)]
    pub string_number: Option<String>,
    #[serde(rename = "structureMark", default)]
    pub structure_mark: Option<String>,
}

/// 21 个装饰记号，**按长度降序**（两字复合在前、单字在后），供最长匹配。
///
/// 顺序即正确性：「绰吟」若排在「绰」后面，`match_slide_mark("绰吟…")` 会先吃掉
/// 「绰」，剩下「吟…」既不是分数也不是指法，整条解析就废了。
pub const SLIDE_MARKS: [&str; 21] = [
    "绰吟", "绰猱", "注吟", "注猱", "细吟", "细猱", "游吟", "游猱", "荡吟", "荡猱", "飞吟", "飞猱",
    "圆吟", "圆猱", "定吟", "定猱", "绰", "注", "急", "吟", "猱",
];

/// 5 个谱面结构记号——独立于减字四宫格的谱面层标记。
pub const STRUCTURE_MARKS: [&str; 5] = ["少息", "大息", "再作", "从头再作", "入拍"];

/// 字体压在「分数后、右手法前」槽里的三个内折记号；其余 18 个挂字尾。
pub fn is_inline_mark(mark: &str) -> bool {
    matches!(mark, "绰" | "注" | "急")
}

/// 分位 → 字体拼装用的字形字符。
///
/// 减字谱字体的一条硬规则：徽位后的分数在**减字里只写数字**，不写「分」字——
/// 「七徽六分」的减字是「七」下压一个「六」。若把「六分」整串塞进去，
/// 字体找不到对应部件，整块会被撑开散架（线上实测：选「六分」后「勹」被挤出格子）。
pub fn fen_to_glyph(fen: &str) -> String {
    match fen {
        "一分" | "二分" | "三分" | "四分" | "五分" | "六分" | "七分" | "八分" | "九分" => {
            fen.trim_end_matches('分').to_string()
        }
        "半" => "半".to_string(),
        other => other.trim_end_matches('分').to_string(),
    }
}

/// 左手指法 → 字体真正认得的字形字符。
///
/// 传统减字里食指写「亻」（取「食」左半）、名指写「夕」（取「名」左半），
/// 键盘也是照这个给的按钮。但字体里**只有全字「食」「名」的连字**，
/// 偏旁字根本没有成字连字——实测「夕九勾四」「亻九勾四」散成 3em，
/// 而「名九勾四」「食九勾四」都是整字 1em。
/// 所以序列化时统一换成全字；解析仍两种都收，老谱子照样能读回来。
fn left_finger_glyph(finger: &str) -> &str {
    match finger {
        "夕" => "名",
        "亻" => "食",
        other => other,
    }
}

/// 键盘显示字符 → 字体 GSUB 引擎期望的触发字符。
fn right_action_glyph(action: &str) -> &str {
    match action {
        "勹" => "勾",
        "木" => "抹",
        "乚" => "挑",
        "乇" => "托",
        "丁" => "打",
        // 「擘」在字体里没有整字连字（实测「大九六擘四」散成 3em 的长串），
        // 「劈」有。两者在减字谱里是同一个指法的两种写法，统一交给「劈」渲染。
        "尸" | "擘" => "劈",
        "倽" => "摘",
        "剔" => "剔",
        // 成块单指法与复合指法：显示字符即字体触发字符
        other => other,
    }
}

/// 右手指法字形 → 可读名（「勹」→「勾」）。
///
/// 键盘按钮上存的是偏旁字形（勹/乚/木/丁/倽…），因为那是减字的传统写法。
/// 但对不熟悉减字谱的人，一排「勹 尸 木 乚」等于一排看不懂的符号——
/// 2026-11-18 实拍确认：想点「勾」的人找不到按钮，因为屏幕上没有「勾」这个字。
pub fn right_action_name(glyph: &str) -> String {
    right_action_glyph(glyph).to_string()
}

/// 在 s 开头最长匹配一个装饰记号；认不出返回 None。
fn match_slide_mark(s: &str) -> Option<&'static str> {
    SLIDE_MARKS.iter().copied().find(|m| s.starts_with(m))
}

/// 判断减字是否已完成（各音色类型所需字段不同）。
pub fn is_complete(state: &JianziState) -> bool {
    // 散音：只需要右手指法和弦序
    if state.tone_type.as_deref() == Some("散") {
        return state.right_action.is_some() && state.string_number.is_some();
    }
    // 泛音、按音：需要左手指法 + 徽位 + 右手指法 + 弦序
    state.tone_type.is_some()
        && state.left_finger.is_some()
        && state.hui.is_some()
        && state.right_action.is_some()
        && state.string_number.is_some()
}

/// 将减字状态序列化为减字谱字体可渲染的文本。
pub fn jianzi_to_text(state: &JianziState) -> String {
    let tone = state.tone_type.as_deref();

    // 散音：「散」作为左侧前缀，不参与主体连字组
    if tone == Some("散") {
        let mut s = String::from("散");
        if let Some(a) = state.right_action.as_deref() {
            s.push_str(right_action_glyph(a));
        }
        if let Some(n) = state.string_number.as_deref() {
            s.push_str(n);
        }
        return s;
    }

    let mut text = String::new();

    // 泛音：加空格阻断字体 GSUB 上下文劫持，使「泛」和后续指法独立渲染
    if tone == Some("泛") {
        text.push_str("泛 ");
    }

    if let Some(f) = state.left_finger.as_deref() {
        text.push_str(left_finger_glyph(f));
    }
    if let Some(h) = state.hui.as_deref() {
        text.push_str(h);
    }
    if let Some(f) = state.fen.as_deref() {
        text.push_str(&fen_to_glyph(f));
    }

    // ⚠ 顺序是字体连字规则，不是排版偏好：
    //   「大九六绰勾四」拼成整字，写成「大九绰六勾四」就散成两串（实测 1em vs 2em）。
    //   所以分数必须在前，内折记号在后。
    let slide = state.slide.as_deref().filter(|_| tone != Some("泛"));
    if let Some(s) = slide.filter(|m| is_inline_mark(m)) {
        text.push_str(s);
    }
    if let Some(a) = state.right_action.as_deref() {
        text.push_str(right_action_glyph(a));
    }
    if let Some(n) = state.string_number.as_deref() {
        text.push_str(n);
    }
    // 吟猱族必须挂在字尾：放进上面的内折槽会把整字劈成两坨
    // （实测「大九六吟勾四」1.5em），挂在弦序后是 1em 方块 + 右侧小字，才是传统写法。
    if let Some(s) = slide.filter(|m| !is_inline_mark(m)) {
        text.push_str(s);
    }
    text
}

/// 已知的徽数字集：一～九 为单位数，十/十一/十二/十三 另判。
///
/// ⚠ 必须逐字列举，不能写 `'一'..='九'`：汉字不是按码位连续的，
/// 那个范围只覆盖到 一(U+4E00)、三(U+4E09)、七(U+4E03)、九(U+4E5D)，
/// 二(U+4E8C)、四(U+56DB)、五(U+4E94)、六(U+516D)、八(U+516B) 全在范围外——
/// 于是「四徽」判不出徽位，整条解析静默失败。
fn is_hui_char(c: char) -> bool {
    matches!(
        c,
        '一' | '二' | '三' | '四' | '五' | '六' | '七' | '八' | '九'
    )
}

/// 徽位后可能紧跟的分位数字（一分～九分 在减字里只写数字）。
fn is_fen_digit(c: char) -> bool {
    is_hui_char(c)
}

/// 弦序字符集。
fn is_string_char(c: char) -> bool {
    matches!(c, '一' | '二' | '三' | '四' | '五' | '六' | '七')
}

/// 右手指法名，**按最长优先排列**，散音与按/泛音共用一份。
///
/// 顺序即正确性：`勾剔` 必须排在 `勾` 前面，否则「散勾剔二」只吃掉一个「勾」，
/// 剩下的「剔二」既不是弦序也不是指法，整条就废了。
/// 曾经散音分支自己维护一份只有单指法的表，于是 `散勾剔二` 这类谱本常见写法
/// 解析出一个**缺弦序的半残状态**——识别面板按「非 null 即成功」统计，
/// 把它算成解析成功，于是错误率看起来是 0。
const RIGHT_ACTION_NAMES: [&str; 34] = [
    "勾剔", "抹挑", "打摘",
    "抹勾", // 复合指法（成块，GSUB 连字 lgw_* 已核验真身）
    "半扶", "长锁", "短锁", "背锁", "圆锁", "半涓", "反涓", "叠涓", "连涓", "仰托",
    // 单指法：全字在前、偏旁在后（键盘存偏旁，粘贴传统谱本存全字）
    "勾", "挑", "抹", "劈", "托", "剔", "打", "摘", "乇", "尸", "木", "乚", "勹", "丁", "倽",
    // 成块单指法（字体内折成块，GSUB 单字替换已核验真身）
    "轮", "锁", "涓", "历", "拂",
];

/// 减字文本 → 状态。解析不出来返回 None（不会返回半残对象）。
pub fn parse_jianzi_text(text: &str) -> Option<JianziState> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut result = JianziState::default();
    let mut remaining = trimmed.to_string();

    // 1. 音色前缀
    if let Some(rest) = remaining.strip_prefix('散') {
        result.tone_type = Some("散".into());
        remaining = rest.to_string();
    } else if let Some(rest) = remaining.strip_prefix('泛') {
        result.tone_type = Some("泛".into());
        remaining = rest.to_string();
    } else {
        result.tone_type = Some("按".into());
    }
    remaining = remaining.trim().to_string();

    // 散音：只需要右手指法 + 弦序
    if result.tone_type.as_deref() == Some("散") {
        // 散音不吃走手音/急弹，但粘贴来的谱本里常带一个「绰」。
        // 这里**丢掉记号继续解析**，不因为多一个记号整条失败：
        // 旧代码不丢也不解析，直接返回一个「没指法没弦」的空壳，比失败更糟。
        //
        // 反复最长匹配剥掉装饰记号：复合「细吟」是两字，按单字丢会残留「细」，
        // 把后面的弦序判死。
        let mut cleaned = String::new();
        let mut rest = remaining.as_str();
        while !rest.is_empty() {
            if let Some(mark) = match_slide_mark(rest) {
                rest = &rest[mark.len()..];
            } else {
                let c = rest.chars().next()?;
                cleaned.push(c);
                rest = &rest[c.len_utf8()..];
            }
        }
        remaining = cleaned.trim().to_string();

        for name in RIGHT_ACTION_NAMES {
            if let Some(rest) = remaining.strip_prefix(name) {
                result.right_action = Some(name.into());
                remaining = rest.to_string();
                break;
            }
        }
        // 剩下的就是弦序
        if remaining.chars().count() == 1 && remaining.chars().all(is_string_char) {
            result.string_number = Some(remaining);
        }
        // 必须和按/泛音一样过 is_complete：上面那两条 if 都不成立时，
        // 返回的是一个「有指法没弦」的半残对象，调用方（识别面板）会当成解析成功。
        return if is_complete(&result) {
            Some(result)
        } else {
            None
        };
    }

    // 2. 左手指法
    // 传统减字偏旁写法：亻 = 食指（取「食」左半）、夕 = 名指（取「名」左半）。
    // 与全字写法（食/名）一并支持，粘贴传统谱本时才不会解析失败。
    for name in ["大", "名", "夕", "中", "食", "亻", "跪"] {
        if let Some(rest) = remaining.strip_prefix(name) {
            result.left_finger = Some(name.into());
            remaining = rest.to_string();
            break;
        }
    }

    // 3. 徽位数字
    //    十一/十二/十三 是两个字；其余是一位。不能贪心吃光连续数字，
    //    否则「大七六勾四」（七徽六分）会被读成徽位「七六」。
    let mut chars: Vec<char> = remaining.chars().collect();
    let mut consumed = 0usize;
    if chars.first() == Some(&'十') {
        if matches!(chars.get(1), Some('一' | '二' | '三')) {
            result.hui = Some(chars[..2].iter().collect());
            consumed = 2;
        } else {
            result.hui = Some("十".into());
            consumed = 1;
        }
    } else if let Some(&c) = chars.first()
        && is_hui_char(c)
    {
        result.hui = Some(c.to_string());
        consumed = 1;
    }
    chars.drain(..consumed);
    remaining = chars.iter().collect();

    // 4. 分
    //    减字里分数只写数字（七徽六分 → 「大七六勾四」），也兼容旧写法「六分」。
    //    两字徽位后可能带一个「徽」分隔字，先跳过。
    if let Some(rest) = remaining.strip_prefix('徽') {
        remaining = rest.to_string();
    }
    // 内折记号（绰/注/急）允许写在分数前或后：字体的连字规则只认「分数在前」，
    // 但人打字时按口语顺序（「大九绰六勾四」）来的更多，两处都接住，
    // 序列化时再统一排成字体要的顺序。吟猱族不写这里——它们挂字尾（第 6 步）。
    let mut slide = match_slide_mark(&remaining).filter(|m| is_inline_mark(m));
    if let Some(mark) = slide {
        result.slide = Some(mark.into());
        remaining = remaining[mark.len()..].to_string();
    }
    if let Some(rest) = remaining.strip_prefix('半') {
        result.fen = Some("半".into());
        remaining = rest.to_string();
    } else if let Some(c) = remaining.chars().next()
        && is_fen_digit(c)
    {
        result.fen = Some(format!("{c}分"));
        let mut rest = &remaining[c.len_utf8()..];
        if let Some(r) = rest.strip_prefix('分') {
            rest = r;
        }
        remaining = rest.to_string();
    }
    if result.slide.is_none() {
        slide = match_slide_mark(&remaining).filter(|m| is_inline_mark(m));
        if let Some(mark) = slide {
            result.slide = Some(mark.into());
            remaining = remaining[mark.len()..].to_string();
        }
    }

    // 5. 右手指法
    for name in RIGHT_ACTION_NAMES {
        if let Some(rest) = remaining.strip_prefix(name) {
            result.right_action = Some(name.into());
            remaining = rest.to_string();
            break;
        }
    }

    // 6. 弦序 + 挂字尾的吟猱族记号
    //    字体把吟猱族小字挂在弦序之后（「大九六勾四细吟」），内折记号走第 4 步的槽内。
    //    先把首字当弦序，剩下的尾缀必须**整段**是合法装饰记号：
    //    认不出、或槽里已经有记号了（一谱字只带一个），都判失败，别静默吞掉错字。
    let mut string_part = String::new();
    let mut tail_part = String::new();
    if let Some(c) = remaining.chars().next() {
        if is_string_char(c) {
            string_part = c.to_string();
            tail_part = remaining[c.len_utf8()..].to_string();
        } else {
            return None;
        }
    }
    if !tail_part.is_empty() {
        let tail_mark = match_slide_mark(&tail_part)?;
        // 必须整段都是记号，不能只吃掉前缀就完事
        if tail_mark.len() != tail_part.len() || result.slide.is_some() {
            return None;
        }
        result.slide = Some(tail_mark.into());
    }
    if !string_part.is_empty() {
        result.string_number = Some(string_part);
    }
    // 泛音是虚按徽位取泛音，滑不动也谈不上吟猱；写进来也不收，免得谱面和听感对不上
    if result.tone_type.as_deref() == Some("泛") {
        result.slide = None;
    }

    if is_complete(&result) {
        Some(result)
    } else {
        None
    }
}

// ──────────────────────────────────────────────
// 时值
// ──────────────────────────────────────────────

/// 根据时值获取减时线数量。
pub fn rhythm_line_count(duration: &str) -> u8 {
    match duration {
        "全" | "二分" => 0,
        "四分" => 1,
        "八分" => 2,
        "十六分" => 3,
        "三十二分" => 4,
        _ => 0,
    }
}

/// 时值 → 拍数（四分音符为一拍）；附点加一半。
pub fn duration_to_beats(duration: &str, dotted: bool) -> f64 {
    let base = match duration {
        "全" => 4.0,
        "二分" => 2.0,
        "四分" => 1.0,
        "八分" => 0.5,
        "十六分" => 0.25,
        "三十二分" => 0.125,
        _ => 1.0,
    };
    if dotted { base * 1.5 } else { base }
}

// ──────────────────────────────────────────────
// JSON 桥接
// ──────────────────────────────────────────────

/// 输入：`{"state":{...}}` → 减字文本。
pub fn to_text_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        state: JianziState,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    serde_json::to_string(&jianzi_to_text(&req.state)).map_err(|e| e.to_string())
}

/// 输入：`{"text":"大九勾四"}` → 状态或 `null`。
pub fn from_text_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        text: String,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    serde_json::to_string(&parse_jianzi_text(&req.text)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn an_yin() -> JianziState {
        JianziState {
            tone_type: Some("按".into()),
            left_finger: Some("大".into()),
            hui: Some("九".into()),
            right_action: Some("勹".into()),
            string_number: Some("四".into()),
            ..Default::default()
        }
    }

    #[test]
    fn serializes_basic_glyph() {
        assert_eq!(jianzi_to_text(&an_yin()), "大九勾四");
    }

    #[test]
    fn san_yin_prefixes_san() {
        let s = JianziState {
            tone_type: Some("散".into()),
            right_action: Some("勹".into()),
            string_number: Some("二".into()),
            ..Default::default()
        };
        assert_eq!(jianzi_to_text(&s), "散勾二");
    }

    #[test]
    fn fan_yin_gets_space_guard() {
        // 空格阻断字体 GSUB 上下文劫持
        let mut s = an_yin();
        s.tone_type = Some("泛".into());
        assert_eq!(jianzi_to_text(&s), "泛 大九勾四");
        assert!(jianzi_to_text(&s).starts_with("泛 "));
    }

    #[test]
    fn parts_become_full_glyphs() {
        // 偏旁字体没有连字，序列化换全字
        let mut s = an_yin();
        s.left_finger = Some("夕".into());
        assert_eq!(jianzi_to_text(&s), "名九勾四");
        s.left_finger = Some("亻".into());
        assert_eq!(jianzi_to_text(&s), "食九勾四");
    }

    #[test]
    fn fen_written_as_digit_only() {
        let mut s = an_yin();
        s.fen = Some("六分".into());
        assert_eq!(jianzi_to_text(&s), "大九六勾四");
        assert!(!jianzi_to_text(&s).contains('分'));
    }

    #[test]
    fn inline_marks_come_before_right_action() {
        // 字体连字规则：分数在前、内折记号在后，否则散成两串
        let mut s = an_yin();
        s.fen = Some("六分".into());
        s.slide = Some("绰".into());
        let text = jianzi_to_text(&s);
        assert_eq!(text, "大九六绰勾四");
        // 徽位数字必须在「绰」前
        assert!(text.find('九').unwrap() < text.find('绰').unwrap());
        assert!(text.find('绰').unwrap() < text.find('勾').unwrap());
    }

    #[test]
    fn tail_marks_come_after_string() {
        let mut s = an_yin();
        s.slide = Some("吟".into());
        assert_eq!(jianzi_to_text(&s), "大九勾四吟");
    }

    #[test]
    fn fan_yin_drops_slide() {
        let mut s = an_yin();
        s.tone_type = Some("泛".into());
        s.slide = Some("绰".into());
        assert!(!jianzi_to_text(&s).contains('绰'));
    }

    #[test]
    fn parses_basic_glyph() {
        let s = parse_jianzi_text("大九勾四").unwrap();
        assert_eq!(s.tone_type.as_deref(), Some("按"));
        assert_eq!(s.left_finger.as_deref(), Some("大"));
        assert_eq!(s.hui.as_deref(), Some("九"));
        assert_eq!(s.right_action.as_deref(), Some("勾"));
        assert_eq!(s.string_number.as_deref(), Some("四"));
    }

    #[test]
    fn round_trips_through_text() {
        for s in [
            an_yin(),
            JianziState {
                tone_type: Some("散".into()),
                right_action: Some("挑".into()),
                string_number: Some("一".into()),
                ..Default::default()
            },
        ] {
            let text = jianzi_to_text(&s);
            let back = parse_jianzi_text(&text).unwrap_or_else(|| panic!("{text} 解析失败"));
            assert_eq!(jianzi_to_text(&back), text);
        }
    }

    #[test]
    fn parses_partial_glyph_names() {
        assert_eq!(
            parse_jianzi_text("夕九勾四")
                .unwrap()
                .left_finger
                .as_deref(),
            Some("夕")
        );
        assert_eq!(
            parse_jianzi_text("食九勾四")
                .unwrap()
                .left_finger
                .as_deref(),
            Some("食")
        );
    }

    #[test]
    fn two_char_hui_not_read_as_two_digits() {
        // 「大七六勾四」是七徽六分，不能读成徽位「七六」
        let s = parse_jianzi_text("大七六勾四").unwrap();
        assert_eq!(s.hui.as_deref(), Some("七"));
        assert_eq!(s.fen.as_deref(), Some("六分"));
    }

    #[test]
    fn eleven_to_thirteen_hui() {
        for (text, hui) in [
            ("大十一勾四", "十一"),
            ("大十二勾四", "十二"),
            ("大十三勾四", "十三"),
        ] {
            assert_eq!(
                parse_jianzi_text(text).unwrap().hui.as_deref(),
                Some(hui),
                "{text}"
            );
        }
    }

    #[test]
    fn ten_hui_alone() {
        assert_eq!(
            parse_jianzi_text("大十勾四").unwrap().hui.as_deref(),
            Some("十")
        );
    }

    #[test]
    fn old_fen_spelling_still_accepted() {
        let s = parse_jianzi_text("大九六分勾四").unwrap();
        assert_eq!(s.fen.as_deref(), Some("六分"));
    }

    #[test]
    fn hui_with_separator_char() {
        let s = parse_jianzi_text("大九徽六勾四").unwrap();
        assert_eq!(s.hui.as_deref(), Some("九"));
        assert_eq!(s.fen.as_deref(), Some("六分"));
    }

    #[test]
    fn inline_mark_accepted_before_fen() {
        // 口语顺序「大九绰六勾四」也要收
        let s = parse_jianzi_text("大九绰六勾四").unwrap();
        assert_eq!(s.slide.as_deref(), Some("绰"));
        assert_eq!(s.fen.as_deref(), Some("六分"));
    }

    #[test]
    fn tail_mark_after_string() {
        let s = parse_jianzi_text("大九勾四吟").unwrap();
        assert_eq!(s.slide.as_deref(), Some("吟"));
    }

    #[test]
    fn compound_tail_mark_fully_consumed() {
        // 「细吟」是两字，必须整体吃掉，不能残留「细」
        let s = parse_jianzi_text("大九勾四细吟").unwrap();
        assert_eq!(s.slide.as_deref(), Some("细吟"));
    }

    #[test]
    fn rejects_partial_tail_mark() {
        // 尾缀认不出就判失败，别静默吞掉错字
        assert!(parse_jianzi_text("大九勾四某").is_none());
    }

    #[test]
    fn rejects_two_slides() {
        // 一谱字只带一个记号
        assert!(parse_jianzi_text("大九绰六勾四吟").is_none());
    }

    #[test]
    fn san_yin_drops_ornament_and_still_parses() {
        // 粘贴谱本常带「绰」，丢掉记号继续解析，不因多一个记号整条失败
        let s = parse_jianzi_text("散绰勾二").unwrap();
        assert_eq!(s.right_action.as_deref(), Some("勾"));
        assert_eq!(s.string_number.as_deref(), Some("二"));
        assert_eq!(s.slide, None);
    }

    #[test]
    fn san_yin_with_compound_ornament() {
        // 复合「细吟」按单字丢会残留「细」，把后面的弦序判死
        let s = parse_jianzi_text("散细吟勾二").unwrap();
        assert_eq!(s.string_number.as_deref(), Some("二"));
    }

    #[test]
    fn compound_right_action_needs_longest_first() {
        // 「散勾剔二」：勾剔 必须排在 勾 前面，否则剩「剔二」整条废掉
        let s = parse_jianzi_text("散勾剔二").unwrap();
        assert_eq!(s.right_action.as_deref(), Some("勾剔"));
        assert_eq!(s.string_number.as_deref(), Some("二"));
    }

    #[test]
    fn incomplete_returns_none_not_partial() {
        // 只有指法没弦序 → 半残对象会让识别面板误判成功
        assert!(parse_jianzi_text("散勾").is_none());
        assert!(parse_jianzi_text("大九勾").is_none());
    }

    #[test]
    fn empty_is_none() {
        assert!(parse_jianzi_text("").is_none());
        assert!(parse_jianzi_text("   ").is_none());
    }

    #[test]
    fn fan_yin_with_space_parses() {
        // 序列化给泛音加了空格（阻断 GSUB 劫持），解析必须能吃回去
        let s = parse_jianzi_text("泛 大九勾四吟").expect("泛音应能解析");
        assert_eq!(s.tone_type.as_deref(), Some("泛"));
        assert_eq!(s.left_finger.as_deref(), Some("大"));
        assert_eq!(s.hui.as_deref(), Some("九"));
        assert_eq!(s.right_action.as_deref(), Some("勾"));
        assert_eq!(s.string_number.as_deref(), Some("四"));
        // 泛音不收吟猱
        assert_eq!(s.slide, None);
    }

    #[test]
    fn fan_yin_never_keeps_slide() {
        let s = parse_jianzi_text("泛大九勾四绰").unwrap();
        assert_eq!(s.slide, None);
    }

    #[test]
    fn completeness_rules() {
        assert!(is_complete(&an_yin()));
        // 散音不要左手与徽位
        let san = JianziState {
            tone_type: Some("散".into()),
            right_action: Some("勾".into()),
            string_number: Some("四".into()),
            ..Default::default()
        };
        assert!(is_complete(&san));
        // 按音缺徽位不算完整
        let mut partial = an_yin();
        partial.hui = None;
        assert!(!is_complete(&partial));
        // 没有音色也不算
        assert!(!is_complete(&JianziState::default()));
    }

    #[test]
    fn right_action_name_reads_glyphs() {
        assert_eq!(right_action_name("勹"), "勾");
        assert_eq!(right_action_name("乇"), "托");
        assert_eq!(right_action_name("乚"), "挑");
        assert_eq!(right_action_name("尸"), "劈");
        assert_eq!(right_action_name("倽"), "摘");
        // 全字本身就是可读名
        assert_eq!(right_action_name("勾"), "勾");
    }

    #[test]
    fn slide_mark_table_is_longest_first() {
        // 顺序即正确性：靠前的必须不比靠后的短
        for w in SLIDE_MARKS.windows(2) {
            assert!(
                w[0].chars().count() >= w[1].chars().count(),
                "{} 排在 {} 前面但更短",
                w[0],
                w[1]
            );
        }
    }

    #[test]
    fn inline_marks_are_exactly_three() {
        let inline: Vec<&str> = SLIDE_MARKS
            .iter()
            .copied()
            .filter(|m| is_inline_mark(m))
            .collect();
        assert_eq!(inline, ["绰", "注", "急"]);
    }

    #[test]
    fn duration_to_beats_values() {
        assert_eq!(duration_to_beats("四分", false), 1.0);
        assert_eq!(duration_to_beats("四分", true), 1.5);
        assert_eq!(duration_to_beats("八分", false), 0.5);
        assert_eq!(duration_to_beats("全", false), 4.0);
        assert_eq!(duration_to_beats("三十二分", false), 0.125);
    }

    #[test]
    fn rhythm_line_counts() {
        assert_eq!(rhythm_line_count("全"), 0);
        assert_eq!(rhythm_line_count("二分"), 0);
        assert_eq!(rhythm_line_count("四分"), 1);
        assert_eq!(rhythm_line_count("八分"), 2);
        assert_eq!(rhythm_line_count("十六分"), 3);
        assert_eq!(rhythm_line_count("三十二分"), 4);
    }

    #[test]
    fn right_action_table_keeps_longest_first() {
        // 顺序即正确性：靠前的必须不比靠后的短，否则「勾剔二」会被「勾」先吃掉。
        for w in RIGHT_ACTION_NAMES.windows(2) {
            assert!(
                w[0].chars().count() >= w[1].chars().count(),
                "{} 排在 {} 前面但更短",
                w[0],
                w[1]
            );
        }
    }

    #[test]
    fn full_form_precedes_radical_form() {
        // 全字在前、偏旁在后：粘贴谱本里的「勾」不能被「勹」规则抢走
        let pos = |needle: &str| {
            RIGHT_ACTION_NAMES
                .iter()
                .position(|n| *n == needle)
                .unwrap_or_else(|| panic!("{needle} 未登记"))
        };
        for (full, radical) in [
            ("勾", "勹"),
            ("抹", "木"),
            ("挑", "乚"),
            ("托", "乇"),
            ("打", "丁"),
            ("摘", "倽"),
            ("劈", "尸"),
        ] {
            assert!(pos(full) < pos(radical), "{full} 应排在 {radical} 前");
        }
    }

    #[test]
    fn json_bridges() {
        let out = to_text_json(r#"{"state":{"toneType":"按","leftFinger":"大","hui":"九","rightAction":"勹","stringNumber":"四"}}"#).unwrap();
        assert_eq!(out, "\"大九勾四\"");
        let back = from_text_json(r#"{"text":"大九勾四"}"#).unwrap();
        let v: serde_json::Value = serde_json::from_str(&back).unwrap();
        assert_eq!(v["hui"], serde_json::json!("九"));
        assert_eq!(from_text_json(r#"{"text":"乱写"}"#).unwrap(), "null");
    }
}
