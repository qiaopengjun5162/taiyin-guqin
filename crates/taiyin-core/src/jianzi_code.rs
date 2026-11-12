//! 减字编码——把「拼好的减字」压成一串可读、可键入、可打印的码。
//!
//! 包松平《古琴减字谱数字化初探》（2015）把数字化的路径说得很直白：
//! **「先造字库，再给每个字分配一个编码，最后写输入法去调取」**。
//! 他给的编码规则是「采用每个部件的声母；凡与弦和微分相关的序号，采用主键盘上的 0–9」，
//! 于是「大指七徽六分……四弦」这类字就变成 `d76…4` 这样一串字母数字——
//! 一串能在任何文本里传、能照着敲、能建索引的码。
//!
//! 太音早就有了输入侧（`apps/web/src/lib/jianzi-rapid.ts` 的连打文法），
//! 但只有「打字 → 减字」这半边；**减字 → 码**这半边一直缺着，所以：
//! 字典里的字说不清「怎么打」、导出的文本谱离开字体就看不懂、也没法按码检索。
//! 本模块补上反向编码，并把两条方向锁死在同一张码表上（往返测试守着）。
//!
//! # 码法（与前端连打文法同源）
//!
//! 按**减字书写顺序**（从上到下、从左到右）：
//!
//! ```text
//! 音色前缀 + 左手 + 徽位 + [分] + [走手音] + 右手 + 弦序
//!    s/f/a     d    9      f6       c          g      4
//! ```
//!
//! - 音色：散 `s`、泛 `f`、按 `a`（编码**总是**带前缀，保证一码一义）
//! - 左手：大 `d`、食 `s`、中 `z`、名 `m`、跪 `g`（夕→名、亻→食 先归一）
//! - 徽位：1–13 直接写数字（十 = `10`、十三 = `13`）
//! - 分：`f1`–`f9`、半 `fb`（不写 `f` 的裸数字留给徽位，否则「十三」和「一徽三分」分不开）
//! - 装饰记号（仅按音）：绰 `c`、注 `z`、急 `j`，吟 `y`、猱 `n`，
//!   以及「绰吟 `cy` / 绰猱 `cn` / 注吟 `zy` / … / 定猱 `kn`」16 个吟猱族复合。
//!   复合一律「前缀 + 吟/猱」双字母，解码按最长优先，不会把 `cy` 截成绰 + 半个字母。
//!   注意：这是**码**的写法，与字体渲染串不同——字体的吟猱族记号挂在字尾（弦序之后），
//!   见 `apps/web/src/lib/jianzi.ts` 的 `jianziToText`。码是「照着打的串」，不是字体串。
//! - 右手：勾 `g`、挑 `t`、抹 `m`、打 `d`、摘 `z`、托 `tu`、剔 `ti`、劈 `b`，
//!   复合指法 抹挑 `mt`、勾剔 `gt`、抹勾 `mg`、打摘 `dz`，
//!   单指法 轮 `u`、锁 `o`、涓 `v`、历 `h`、拂 `p`（均字体内折成块，已核验 GSUB 真身）
//! - 弦序：1–7
//!
//! 例：散勾三 = `sg3`；大九勾四 = `ad9g4`；泛大九勾四 = `fd9g4`；
//! 大七徽六分绰勾二 = `ad7f6cg2`。
//!
//! # 时值标注（可选，写在码尾）
//!
//! 码本身只描述「这个字怎么按」，不含节奏——但导出再导入时，节奏丢了
//! 就等于把一首曲子拍平成一串音高。所以码后面可以跟 `:时值`：
//!
//! ```text
//! ad9g4:4     四分（默认，不写也一样）
//! ad9g4:8.    八分附点
//! sg3:1       全音符
//! r:2         二分休止
//! ```
//!
//! 时值数字是简谱那一套：全 `1`、二分 `2`、四分 `4`、八分 `8`、十六分 `16`；
//! 附点加 `.`。`r` 是休止符——它没有减字，但占一拍，不标出来小节就散了。

use serde::{Deserialize, Serialize};

use crate::jianzi_dictionary::{
    JianziDictState, is_complete, left_finger_glyph, right_action_glyph,
};

/// 编码中最长的一步是两位的复合指法（`mt` 等），用于回溯时的边界保护。
const MAX_CODE_LEN: usize = 16;

/// 带时值标注的片段上限：码 + `:` + 两位时值 + 附点。
const MAX_ANNOTATED_LEN: usize = MAX_CODE_LEN + 4;

// ──────────────────────────────────────────────
// 码表
// ──────────────────────────────────────────────

/// 音色 → 前缀字母。
fn tone_letter(tone: &str) -> Option<&'static str> {
    match tone {
        "散" => Some("s"),
        "泛" => Some("f"),
        "按" => Some("a"),
        _ => None,
    }
}

/// 前缀字母 → 音色（长串优先，避免 `san` 被吃成 `s`）。
const TONE_TOKENS: &[(&str, &str)] = &[
    ("san", "散"),
    ("fan", "泛"),
    ("an", "按"),
    ("s", "散"),
    ("f", "泛"),
    ("a", "按"),
];

/// 左手指法（已归一：夕→名、亻→食）→ 字母。
fn left_letter(left: &str) -> Option<&'static str> {
    match left_finger_glyph(left).as_str() {
        "大" => Some("d"),
        "食" => Some("s"),
        "中" => Some("z"),
        "名" => Some("m"),
        "跪" => Some("g"),
        _ => None,
    }
}

/// 字母 → 左手指法（存全字，前端渲染与释义都认）。
const LEFT_TOKENS: &[(&str, &str)] = &[
    ("d", "大"),
    ("s", "食"),
    ("z", "中"),
    ("m", "名"),
    ("g", "跪"),
];

/// 右手指法（已归一：省写→全字）→ 字母。
fn action_letter(action: &str) -> Option<&'static str> {
    match right_action_glyph(action).as_str() {
        "勾" => Some("g"),
        "挑" => Some("t"),
        "抹" => Some("m"),
        "打" => Some("d"),
        "摘" => Some("z"),
        "托" => Some("tu"),
        "剔" => Some("ti"),
        "劈" => Some("b"),
        "抹挑" => Some("mt"),
        "勾剔" => Some("gt"),
        "抹勾" => Some("mg"),
        "打摘" => Some("dz"),
        // 单指法（字体内折成块，GSUB 单字替换已核验真身）：轮/锁/涓/历/拂。
        // 字母取空闲单字母，避开音色 sfa、左手 dszmg、徽位旧法 yewlqbj、分 fN、
        // 走手音 czjy n + 复合、现有右手 gtm dz tu ti b，互不撞车。
        // 注：蠲/剌 在本字体 cmap→placeholder 且无 GSUB 规则，渲染为占位框，不接入。
        "轮" => Some("u"),
        "锁" => Some("o"),
        "涓" => Some("v"),
        "历" => Some("h"),
        "拂" => Some("p"),
        // 拨 / 撮 / 跪 / 大撮 / 反撮：字体有真身（拨→xl_bo、撮→xl_cuo、跪→sm_gui、
        // 大撮→xl_dacuo、反撮→sm_fancuo），但 2026-11-12 渲染闸门实测按音块宽：
        // 拨/撮/大撮/反撮 = 1.533em、跪 = 2.0em（散音下 拨/撮 为 0.866em 合格）。
        // 按音是主用场景，硬接会撑破 1em 方块，故不接入产品；要接需先按音色分槽（另排）。
        // 复合指法（成块，GSUB 连字 lgw_* 真身）：2 字母码，首字母取自空闲池
        // e/i/k/l/q/r/w/x（均不在任何单字母槽位，故 2 字母码不会与单字母 token 前缀冲突）。
        "半扶" => Some("ek"),
        "长锁" => Some("il"),
        "短锁" => Some("kq"),
        "背锁" => Some("lr"),
        "圆锁" => Some("qx"),
        "半涓" => Some("wi"),
        "反涓" => Some("xe"),
        "叠涓" => Some("ki"),
        "连涓" => Some("eq"),
        _ => None,
    }
}

/// 字母 → 右手指法。**长串必须靠前**：`tu` 先于 `t`、`mt` 先于 `m`。
const ACTION_TOKENS: &[(&str, &str)] = &[
    ("mt", "抹挑"),
    ("gt", "勾剔"),
    ("mg", "抹勾"),
    ("dz", "打摘"),
    // 复合指法（成块，GSUB 连字 lgw_* 真身）：2 字母码，空闲池 e/i/k/l/q/r/w/x。
    ("ek", "半扶"),
    ("il", "长锁"),
    ("kq", "短锁"),
    ("lr", "背锁"),
    ("qx", "圆锁"),
    ("wi", "半涓"),
    ("xe", "反涓"),
    ("ki", "叠涓"),
    ("eq", "连涓"),
    ("tu", "托"),
    ("ti", "剔"),
    ("t", "挑"),
    ("g", "勾"),
    ("m", "抹"),
    ("d", "打"),
    ("z", "摘"),
    ("b", "劈"),
    // 单指法（成块）：轮/锁/涓/历/拂
    ("u", "轮"),
    ("o", "锁"),
    ("v", "涓"),
    ("h", "历"),
    ("p", "拂"),
];

/// 装饰记号 → 字母。
///
/// 旧的绰/注/急是单字母；吟猱族 18 个按「前缀 + 吟/猱」编：
/// 裸记号 吟 `y`、猱 `n`，前缀 绰 `c`、注 `z`、细 `x`、游 `u`、
/// 荡 `h`、飞 `v`、圆 `o`、定 `k` 各配 吟/猱 两个变体（共 16）。
/// 选这些字母是为了避开已占用的音色 `s/f/a`、徽位数字、分位 `fN`、
/// 右手 `g/t/m/d/z/tu/ti/b/mt/gt/mg/dz`——同一个字母在不同槽位仍靠槽位区分。
fn slide_letter(slide: &str) -> Option<&'static str> {
    match slide {
        "绰" => Some("c"),
        "注" => Some("z"),
        "急" => Some("j"),
        "吟" => Some("y"),
        "猱" => Some("n"),
        "绰吟" => Some("cy"),
        "绰猱" => Some("cn"),
        "注吟" => Some("zy"),
        "注猱" => Some("zn"),
        "细吟" => Some("xy"),
        "细猱" => Some("xn"),
        "游吟" => Some("uy"),
        "游猱" => Some("un"),
        "荡吟" => Some("hy"),
        "荡猱" => Some("hn"),
        "飞吟" => Some("vy"),
        "飞猱" => Some("vn"),
        "圆吟" => Some("oy"),
        "圆猱" => Some("on"),
        "定吟" => Some("ky"),
        "定猱" => Some("kn"),
        _ => None,
    }
}

/// 字母 → 装饰记号。**双字母必须排在单字母之前**：`match_longest` 取第一个前缀命中，
/// 若 `c`（绰）排在 `cy`（绰吟）前面，`ad9cyg4` 会被截成绰 + `yg4` 而整条报错。
/// `test_slide_tokens_are_sorted_longest_first` 守着这条顺序契约。
const SLIDE_TOKENS: &[(&str, &str)] = &[
    ("cy", "绰吟"),
    ("cn", "绰猱"),
    ("zy", "注吟"),
    ("zn", "注猱"),
    ("xy", "细吟"),
    ("xn", "细猱"),
    ("uy", "游吟"),
    ("un", "游猱"),
    ("hy", "荡吟"),
    ("hn", "荡猱"),
    ("vy", "飞吟"),
    ("vn", "飞猱"),
    ("oy", "圆吟"),
    ("on", "圆猱"),
    ("ky", "定吟"),
    ("kn", "定猱"),
    ("c", "绰"),
    ("z", "注"),
    ("j", "急"),
    ("y", "吟"),
    ("n", "猱"),
];

/// 徽位汉字 → 数字串。
fn hui_digits(hui: &str) -> Option<&'static str> {
    match hui {
        "一" => Some("1"),
        "二" => Some("2"),
        "三" => Some("3"),
        "四" => Some("4"),
        "五" => Some("5"),
        "六" => Some("6"),
        "七" => Some("7"),
        "八" => Some("8"),
        "九" => Some("9"),
        "十" => Some("10"),
        "十一" => Some("11"),
        "十二" => Some("12"),
        "十三" => Some("13"),
        _ => None,
    }
}

/// 数字串 → 徽位汉字（两位优先，`13` 不能被读成「一」+「3」）。
const HUI_TOKENS: &[(&str, &str)] = &[
    ("13", "十三"),
    ("12", "十二"),
    ("11", "十一"),
    ("10", "十"),
    ("9", "九"),
    ("8", "八"),
    ("7", "七"),
    ("6", "六"),
    ("5", "五"),
    ("4", "四"),
    ("3", "三"),
    ("2", "二"),
    ("1", "一"),
];

/// 分位汉字 → `f` + 数字（半 = `fb`），与前端 `f1–f9 / fb` 一致。
fn fen_code(fen: &str) -> Option<&'static str> {
    match fen {
        "一分" => Some("f1"),
        "二分" => Some("f2"),
        "三分" => Some("f3"),
        "四分" => Some("f4"),
        "五分" => Some("f5"),
        "六分" => Some("f6"),
        "七分" => Some("f7"),
        "八分" => Some("f8"),
        "九分" => Some("f9"),
        "半" => Some("fb"),
        _ => None,
    }
}

const FEN_TOKENS: &[(&str, &str)] = &[
    ("f1", "一分"),
    ("f2", "二分"),
    ("f3", "三分"),
    ("f4", "四分"),
    ("f5", "五分"),
    ("f6", "六分"),
    ("f7", "七分"),
    ("f8", "八分"),
    ("f9", "九分"),
    ("fb", "半"),
];

/// 弦序汉字 → 数字字符。
fn string_char(string: &str) -> Option<&'static str> {
    match string {
        "一" => Some("1"),
        "二" => Some("2"),
        "三" => Some("3"),
        "四" => Some("4"),
        "五" => Some("5"),
        "六" => Some("6"),
        "七" => Some("7"),
        _ => None,
    }
}

const STRING_TOKENS: &[(&str, &str)] = &[
    ("1", "一"),
    ("2", "二"),
    ("3", "三"),
    ("4", "四"),
    ("5", "五"),
    ("6", "六"),
    ("7", "七"),
];

// ──────────────────────────────────────────────
// 编码
// ──────────────────────────────────────────────

/// 把一个减字编成码，如「大九勾四」→ `ad9g4`。
///
/// 缺少必需部件（填不出的半成品字）时返回 `Err`——宁可不给码，
/// 也不给一个别人照着打不出来的码。
pub fn encode(state: &JianziDictState) -> Result<String, String> {
    if !is_complete(state) {
        return Err("减字还不完整，编不了码（缺音色 / 左手 / 徽位 / 右手 / 弦序）".to_string());
    }

    let tone =
        tone_letter(&state.tone_type).ok_or_else(|| format!("未知音色：{}", state.tone_type))?;
    let mut code = String::with_capacity(MAX_CODE_LEN);
    code.push_str(tone);

    let action = state
        .right_action
        .as_deref()
        .and_then(action_letter)
        .ok_or_else(|| {
            format!(
                "未知右手指法：{}",
                state.right_action.as_deref().unwrap_or("")
            )
        })?;

    if state.tone_type != "散" {
        code.push_str(
            state
                .left_finger
                .as_deref()
                .and_then(left_letter)
                .ok_or_else(|| {
                    format!(
                        "未知左手指法：{}",
                        state.left_finger.as_deref().unwrap_or("")
                    )
                })?,
        );
        code.push_str(
            state
                .hui
                .as_deref()
                .and_then(hui_digits)
                .ok_or_else(|| format!("未知徽位：{}", state.hui.as_deref().unwrap_or("")))?,
        );
        if let Some(fen) = &state.fen {
            code.push_str(fen_code(fen).ok_or_else(|| format!("未知分位：{fen}"))?);
        }
        // 泛音虚按取音，滑不动——即便状态里带了走手音也不编码。
        if state.tone_type == "按"
            && let Some(slide) = &state.slide
        {
            code.push_str(slide_letter(slide).ok_or_else(|| format!("未知走手音：{slide}"))?);
        }
    }

    code.push_str(action);
    code.push_str(
        state
            .string_number
            .as_deref()
            .and_then(string_char)
            .ok_or_else(|| format!("未知弦序：{}", state.string_number.as_deref().unwrap_or("")))?,
    );
    Ok(code)
}

// ──────────────────────────────────────────────
// 解码
// ──────────────────────────────────────────────

/// 在 `s` 开头按码表做最长匹配。
fn match_longest<'a>(s: &str, table: &[(&'a str, &'a str)]) -> Option<(&'a str, usize)> {
    table
        .iter()
        .find(|(token, _)| s.starts_with(token))
        .map(|(token, value)| (*value, token.len()))
}

/// 解析「右手 + 弦序」这一段（必须是剩余串的全部）。
fn parse_action_and_string(s: &str) -> Option<(String, String)> {
    let (action, len) = match_longest(s, ACTION_TOKENS)?;
    let rest = &s[len..];
    if rest.len() != 1 {
        return None;
    }
    let string = match_longest(rest, STRING_TOKENS)?.0;
    Some((action.to_string(), string.to_string()))
}

/// 解析徽位之后的部分：`[走手音] 右手 弦序`。
///
/// `z` 既是「注」也是「摘」，靠回溯区分：先当走手音试，走不通再当指法。
fn parse_slide_action_string(
    s: &str,
    allow_slide: bool,
) -> Option<(Option<String>, String, String)> {
    if allow_slide
        && let Some((slide, len)) = match_longest(s, SLIDE_TOKENS)
        && let Some((action, string)) = parse_action_and_string(&s[len..])
    {
        return Some((Some(slide.to_string()), action, string));
    }
    let (action, string) = parse_action_and_string(s)?;
    Some((None, action, string))
}

/// 把码解回减字，如 `ad9g4` → 按音 · 大指 · 九徽 · 勾 · 四弦。
///
/// 码必须带音色前缀（`s`/`f`/`a`）：不带前缀时「按音」与「泛音」写法完全相同，
/// 猜一个不如直接报错——半个音猜错就是整段音色错。
pub fn decode(code: &str) -> Result<JianziDictState, String> {
    let normalized: String = code
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if normalized.is_empty() {
        return Err("空的码".to_string());
    }
    if normalized.len() > MAX_CODE_LEN {
        return Err(format!("码太长：{normalized}"));
    }

    let (tone, tone_len) = match_longest(&normalized, TONE_TOKENS)
        .ok_or_else(|| format!("码要以音色前缀开头（s/f/a）：{normalized}"))?;
    let rest = &normalized[tone_len..];

    let mut state = JianziDictState {
        tone_type: tone.to_string(),
        left_finger: None,
        hui: None,
        fen: None,
        slide: None,
        right_action: None,
        string_number: None,
    };

    if tone == "散" {
        let (action, string) =
            parse_action_and_string(rest).ok_or_else(|| format!("散音码读不通：{normalized}"))?;
        state.right_action = Some(action);
        state.string_number = Some(string);
        return Ok(state);
    }

    // 左手
    let (left, len) =
        match_longest(rest, LEFT_TOKENS).ok_or_else(|| format!("左手码读不通：{normalized}"))?;
    state.left_finger = Some(left.to_string());
    let rest = &rest[len..];

    // 徽位（两位优先：10–13）
    let (hui, len) =
        match_longest(rest, HUI_TOKENS).ok_or_else(|| format!("徽位码读不通：{normalized}"))?;
    state.hui = Some(hui.to_string());
    let rest = &rest[len..];

    // 分（可省）
    let rest = if let Some((fen, len)) = match_longest(rest, FEN_TOKENS) {
        state.fen = Some(fen.to_string());
        &rest[len..]
    } else {
        rest
    };

    // 走手音 + 右手 + 弦序（泛音不收走手音）
    let (slide, action, string) = parse_slide_action_string(rest, tone == "按")
        .ok_or_else(|| format!("右手 / 弦序读不通：{normalized}"))?;
    state.slide = slide;
    state.right_action = Some(action);
    state.string_number = Some(string);
    Ok(state)
}

// ──────────────────────────────────────────────
// 批量（wasm 用）
// ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct BatchRequest {
    notes: Vec<JianziDictState>,
}

#[derive(Debug, Serialize)]
struct BatchResponse {
    /// 与输入等长；编不出码的位置是 null。
    codes: Vec<Option<String>>,
}

/// 批量编码：`{"notes":[...]}` → `{"codes":["ag9d4", null, ...]}`。
///
/// 单条坏数据只留 null，不让整份文本谱导出失败——少一行码，
/// 总好过用户点导出什么也没得到。
pub fn encode_batch_json(input_json: &str) -> Result<String, String> {
    let req: BatchRequest = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    let codes = req.notes.iter().map(|n| encode(n).ok()).collect();
    serde_json::to_string(&BatchResponse { codes }).map_err(|e| e.to_string())
}

// ──────────────────────────────────────────────
// 批量解码（wasm 用）—— 把粘回来的文本收回成减字
// ──────────────────────────────────────────────

/// 从一段自由文本里抠出所有「像码」的片段（可带时值标注）。
///
/// 导出谱里的码不是孤零零一行：上面有标题、定弦，同一行还夹着简谱数字、
/// 减字（生僻字）、空位 `-` 和小节线 `|`。让用户先把码挑干净再粘，
/// 等于把机械活推回给人——所以这里按「字母数字连续段」切，
/// 只留**字母开头、长度合法**的片段：纯数字（「共 12 音」的 12）、
/// 小节线、破折号自然滤掉，而漏写音色前缀的 `dg4` 会留下来报错，
/// 不会被悄悄吞掉——悄悄吞掉等于让人少录一个音却毫无察觉。
///
/// `:` 与 `.` 也算片段内的字符，因为时值标注写在码尾（`ad9g4:8.`）；
/// 例外是 `r` 单字母——休止符没有减字，只有一声「空」。
fn tokenize_codes(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    let flush = |buf: &mut String, out: &mut Vec<String>| {
        // 长度与首字符按「去掉时值标注后的码」判，否则 `ad9g4:16.` 会被误杀。
        let head = buf.split(':').next().unwrap_or("");
        let looks_like_code = head == "r"
            || (head.len() >= 2
                && head.len() <= MAX_CODE_LEN
                && head.chars().next().is_some_and(|c| c.is_ascii_alphabetic()));
        if looks_like_code && buf.len() <= MAX_ANNOTATED_LEN {
            out.push(std::mem::take(buf));
        } else {
            buf.clear();
        }
    };

    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || ch == ':' || ch == '.' {
            current.push(ch.to_ascii_lowercase());
        } else {
            flush(&mut current, &mut tokens);
        }
    }
    flush(&mut current, &mut tokens);
    tokens
}

#[derive(Debug, Deserialize)]
struct DecodeRequest {
    text: String,
}

/// 时值 → 码尾数字（简谱时值：全 1、二分 2、四分 4、八分 8、十六分 16）。
///
/// 与前端 `Duration` 一一对应；`16` 必须排在 `1` 前面，
/// 否则「十六分」会被读成「全」——差十六倍的时值，听起来是两首曲子。
const DURATION_TOKENS: &[(&str, &str)] = &[
    ("16", "十六分"),
    ("1", "全"),
    ("2", "二分"),
    ("4", "四分"),
    ("8", "八分"),
];

/// 时值数字 → 时值汉字。认不出返回 None：宁可不给，也不猜一个。
fn duration_from_digits(digits: &str) -> Option<&'static str> {
    DURATION_TOKENS
        .iter()
        .find(|(d, _)| *d == digits)
        .map(|(_, v)| *v)
}

/// 从文本里切出来的一条片段：`ad9g4:8.` = 大九勾四 · 八分附点；`r:4` = 四分休止。
struct Annotated {
    /// 原样保留（回显给用户看，含时值标注）。
    raw: String,
    /// 去掉时值标注后的纯码；`r` 表示休止符，不对应减字。
    code: String,
    /// 时值汉字（「四分」等）；没标注就是 None，由前端按四分处理。
    duration: Option<String>,
    dotted: bool,
    is_rest: bool,
}

fn parse_annotated(raw: &str) -> Result<Annotated, String> {
    let (head, tail) = match raw.split_once(':') {
        Some((h, t)) => (h, Some(t)),
        // 句末的码常带着句号（「……ad9g4.」），别让一个标点把整条码判死。
        None => (raw.trim_end_matches('.'), None),
    };

    let mut duration = None;
    let mut dotted = false;

    if let Some(tail) = tail {
        let (digits, dot) = match tail.strip_suffix('.') {
            Some(d) => (d, true),
            None => (tail, false),
        };
        if digits.is_empty() {
            return Err(format!("时值标注缺数字（应写成 :4 / :8. 这样）：{raw}"));
        }
        dotted = dot;
        duration = Some(
            duration_from_digits(digits)
                .ok_or_else(|| format!("认不出的时值「:{digits}」（可用 1/2/4/8/16）：{raw}"))?
                .to_string(),
        );
    }

    Ok(Annotated {
        raw: raw.to_string(),
        code: head.to_string(),
        duration,
        dotted,
        is_rest: head == "r",
    })
}

/// 一条码的解析结果：要么给出减字，要么给出「为什么读不通」。
///
/// 字段都不省略：前端要逐条回显原文 + 原因 + 时值，
/// 少一个字段就得靠 `null` 猜是哪一种。
#[derive(Debug, Serialize)]
struct DecodedCode {
    code: String,
    state: Option<JianziDictState>,
    error: Option<String>,
    duration: Option<String>,
    dotted: bool,
    #[serde(rename = "isRest")]
    is_rest: bool,
}

#[derive(Debug, Serialize)]
struct DecodeBatchResponse {
    total: usize,
    ok: usize,
    failed: usize,
    entries: Vec<DecodedCode>,
}

/// 批量解码：`{"text":"ad9g4:8. sg3:4 | r:2"}` → 逐条结果。
///
/// 这是「导出 → 再导入」闭环的另一半：导出的码能整段粘回来变成曲谱，
/// 码才真的是一份可搬运的存档，而不只是给人看的注释。
/// 时值写在码尾（`:4` 四分、`:8.` 八分附点），所以导入不会把整首谱
/// 压成一片四分音符——「能搬运」必须连节奏一起搬，否则搬回来的只是一串音高。
/// 单条坏码只让那一条失败，其余照常——一段谱里错一个字母，
/// 不该让整段导入归零。
pub fn decode_batch_json(input_json: &str) -> Result<String, String> {
    let req: DecodeRequest = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    let tokens = tokenize_codes(&req.text);
    if tokens.is_empty() {
        return Err("没找到可解析的减字码（形如 sg3 / ad9g4，用空格或换行分隔）".to_string());
    }

    let entries: Vec<DecodedCode> = tokens
        .into_iter()
        .map(|raw| match parse_annotated(&raw) {
            Err(e) => DecodedCode {
                code: raw,
                state: None,
                error: Some(e),
                duration: None,
                dotted: false,
                is_rest: false,
            },
            Ok(a) if a.is_rest => DecodedCode {
                code: a.raw,
                state: None,
                error: None,
                duration: a.duration,
                dotted: a.dotted,
                is_rest: true,
            },
            Ok(a) => match decode(&a.code) {
                Ok(state) => DecodedCode {
                    code: a.raw,
                    state: Some(state),
                    error: None,
                    duration: a.duration,
                    dotted: a.dotted,
                    is_rest: false,
                },
                Err(e) => DecodedCode {
                    code: a.raw,
                    state: None,
                    error: Some(e),
                    duration: a.duration,
                    dotted: a.dotted,
                    is_rest: false,
                },
            },
        })
        .collect();

    let ok = entries
        .iter()
        .filter(|e| e.state.is_some() || e.is_rest)
        .count();
    let failed = entries.len() - ok;
    serde_json::to_string(&DecodeBatchResponse {
        total: entries.len(),
        ok,
        failed,
        entries,
    })
    .map_err(|e| e.to_string())
}

// ──────────────────────────────────────────────
// 测试
// ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 按音：按 大 九 勾 四。
    fn an_da_9_gou_4() -> JianziDictState {
        JianziDictState {
            tone_type: "按".into(),
            left_finger: Some("大".into()),
            hui: Some("九".into()),
            fen: None,
            slide: None,
            right_action: Some("勾".into()),
            string_number: Some("四".into()),
        }
    }

    fn san(action: &str, string: &str) -> JianziDictState {
        JianziDictState {
            tone_type: "散".into(),
            left_finger: None,
            hui: None,
            fen: None,
            slide: None,
            right_action: Some(action.into()),
            string_number: Some(string.into()),
        }
    }

    #[test]
    fn test_encode_basic_examples() {
        assert_eq!(encode(&san("勾", "三")).unwrap(), "sg3");
        assert_eq!(encode(&an_da_9_gou_4()).unwrap(), "ad9g4");

        let fan = JianziDictState {
            tone_type: "泛".into(),
            left_finger: Some("大".into()),
            hui: Some("九".into()),
            fen: None,
            slide: None,
            right_action: Some("勾".into()),
            string_number: Some("四".into()),
        };
        assert_eq!(encode(&fan).unwrap(), "fd9g4");
    }

    #[test]
    fn test_encode_with_fen_and_slide() {
        let mut s = an_da_9_gou_4();
        s.hui = Some("七".into());
        s.fen = Some("六分".into());
        s.slide = Some("绰".into());
        s.string_number = Some("二".into());
        assert_eq!(encode(&s).unwrap(), "ad7f6cg2");
    }

    #[test]
    fn test_encode_two_digit_hui() {
        let mut s = an_da_9_gou_4();
        s.hui = Some("十三".into());
        assert_eq!(encode(&s).unwrap(), "ad13g4");

        s.hui = Some("十".into());
        assert_eq!(encode(&s).unwrap(), "ad10g4");

        s.hui = Some("十一".into());
        assert_eq!(encode(&s).unwrap(), "ad11g4");
    }

    #[test]
    fn test_encode_normalizes_variant_glyphs() {
        // 夕 = 名指、亻 = 食指；勹 = 勾、乚 = 挑（省写）
        let mut s = an_da_9_gou_4();
        s.left_finger = Some("夕".into());
        assert_eq!(encode(&s).unwrap(), "am9g4");

        s.left_finger = Some("亻".into());
        assert_eq!(encode(&s).unwrap(), "as9g4");

        let mut open = san("勹", "三");
        assert_eq!(encode(&open).unwrap(), "sg3");
        open.right_action = Some("乚".into());
        assert_eq!(encode(&open).unwrap(), "st3");
    }

    #[test]
    fn test_encode_compound_actions() {
        assert_eq!(encode(&san("抹挑", "四")).unwrap(), "smt4");
        assert_eq!(encode(&san("勾剔", "五")).unwrap(), "sgt5");
        assert_eq!(encode(&san("打摘", "四")).unwrap(), "sdz4");
        assert_eq!(encode(&san("托", "一")).unwrap(), "stu1");
        assert_eq!(encode(&san("剔", "四")).unwrap(), "sti4");
        assert_eq!(encode(&san("劈", "七")).unwrap(), "sb7");
    }

    #[test]
    fn test_new_right_actions_roundtrip() {
        // 字体内折成块、GSUB 单字替换已核验真身的单指法：轮/锁/涓/历/拂。
        // 字母取空闲单字母，与音色/左手/徽位/分/走手音/现有右手互不撞车。
        // 蠲/剌 在字体 cmap→placeholder 且无 GSUB 规则，不接入（见 action_letter 注释）。
        let cases: &[(&str, &str)] = &[
            ("u", "轮"),
            ("o", "锁"),
            ("v", "涓"),
            ("h", "历"),
            ("p", "拂"),
        ];
        for (letter, action) in cases {
            let note = san(action, "四");
            assert_eq!(
                encode(&note).unwrap(),
                format!("s{letter}4"),
                "{action} 编码"
            );
            let decoded =
                decode(&format!("s{letter}4")).unwrap_or_else(|e| panic!("s{letter}4 解不开：{e}"));
            assert_eq!(
                decoded.right_action.as_deref(),
                Some(*action),
                "{action} 解码"
            );
            assert_eq!(
                encode(&decoded).unwrap(),
                format!("s{letter}4"),
                "{action} 编回"
            );
        }
    }

    #[test]
    fn test_action_tokens_are_sorted_longest_first() {
        // 与 SLIDE_TOKENS 同一条契约：`match_longest` 取第一个前缀命中，
        // 短码若排在长码前面就会被先吃掉（`tu`→`t`、`lr` 被 `r` 截断）。
        for (i, (a, _)) in ACTION_TOKENS.iter().enumerate() {
            for (b, _) in ACTION_TOKENS.iter().skip(i + 1) {
                assert!(
                    a.len() >= b.len(),
                    "ACTION_TOKENS 顺序错：{a} 排在 {b} 前面，长码必须靠前"
                );
            }
        }
    }

    #[test]
    fn test_compound_right_actions_roundtrip() {
        // 复合指法（成块，GSUB 连字 lgw_* 真身）：半扶/长锁/短锁/背锁/圆锁/半涓/反涓/叠涓/连涓。
        // 2 字母码取空闲池 e/i/k/l/q/r/w/x，与单指法互不撞车。
        let cases: &[(&str, &str)] = &[
            ("ek", "半扶"),
            ("il", "长锁"),
            ("kq", "短锁"),
            ("lr", "背锁"),
            ("qx", "圆锁"),
            ("wi", "半涓"),
            ("xe", "反涓"),
            ("ki", "叠涓"),
            ("eq", "连涓"),
        ];
        for (letter, action) in cases {
            let note = san(action, "四");
            assert_eq!(
                encode(&note).unwrap(),
                format!("s{letter}4"),
                "{action} 编码"
            );
            let decoded =
                decode(&format!("s{letter}4")).unwrap_or_else(|e| panic!("s{letter}4 解不开：{e}"));
            assert_eq!(
                decoded.right_action.as_deref(),
                Some(*action),
                "{action} 解码"
            );
            assert_eq!(
                encode(&decoded).unwrap(),
                format!("s{letter}4"),
                "{action} 编回"
            );
        }
    }

    #[test]
    fn test_encode_rejects_incomplete() {
        let mut s = an_da_9_gou_4();
        s.hui = None;
        assert!(encode(&s).is_err());
    }

    #[test]
    fn test_decode_basic() {
        let s = decode("ad9g4").unwrap();
        assert_eq!(s, an_da_9_gou_4());

        let s = decode("sg3").unwrap();
        assert_eq!(s, san("勾", "三"));
        assert!(s.left_finger.is_none());
        assert!(s.hui.is_none());
    }

    #[test]
    fn test_decode_long_prefixes() {
        // san / fan / an 与单字母等价
        assert_eq!(decode("sang3").unwrap(), decode("sg3").unwrap());
        assert_eq!(decode("an d9g4").unwrap(), decode("ad9g4").unwrap());
        // 复合 半涓(wi) 与 单指法 涓(v) 不能互串
        assert_eq!(
            decode("swi4").unwrap().right_action.as_deref(),
            Some("半涓")
        );
        assert_eq!(decode("sv4").unwrap().right_action.as_deref(), Some("涓"));
    }

    #[test]
    fn test_decode_z_ambiguity() {
        // z 既是「注」也是「摘」：靠后续能不能读通来定
        let zhu = decode("ad9zg4").unwrap();
        assert_eq!(zhu.slide.as_deref(), Some("注"));
        assert_eq!(zhu.right_action.as_deref(), Some("勾"));

        let zhai = decode("ad9z4").unwrap();
        assert_eq!(zhai.slide, None);
        assert_eq!(zhai.right_action.as_deref(), Some("摘"));
    }

    #[test]
    fn test_decode_rejects_bad_input() {
        assert!(decode("").is_err());
        assert!(decode("d9g4").is_err(), "缺音色前缀必须报错");
        assert!(decode("ad9x4").is_err(), "未知指法");
        assert!(decode("ad9g8").is_err(), "弦序越界");
    }

    #[test]
    fn test_roundtrip_table() {
        // 编码 → 解码 → 再编码，必须原样回到同一串码。
        let codes = [
            "sg3", "st3", "stu1", "sti4", "sb7", "smt4", "sgt5", "smg3", "sdz4", "ad9g4",
            "ad7f6cg2", "ad13g4", "ad10g4", "ad11g4", "am9g4", "as9g4", "ag9f3cg4", "fd9g4",
            "fm7g2", "fd9tu1",
        ];
        for code in codes {
            let state = decode(code).unwrap_or_else(|e| panic!("{code} 解不开：{e}"));
            let back = encode(&state).unwrap_or_else(|e| panic!("{code} 编不回：{e}"));
            assert_eq!(back, code);
        }
    }

    #[test]
    fn test_yin_nao_marks_roundtrip() {
        // 21 个装饰记号：旧的绰/注/急（单字母）+ 18 个吟猱族。
        // 复合用「前缀 + 吟/猱」双字母，必须与绰/注的单字母按最长优先区分。
        let marks: &[(&str, &str)] = &[
            ("c", "绰"),
            ("z", "注"),
            ("j", "急"),
            ("y", "吟"),
            ("n", "猱"),
            ("cy", "绰吟"),
            ("cn", "绰猱"),
            ("zy", "注吟"),
            ("zn", "注猱"),
            ("xy", "细吟"),
            ("xn", "细猱"),
            ("uy", "游吟"),
            ("un", "游猱"),
            ("hy", "荡吟"),
            ("hn", "荡猱"),
            ("vy", "飞吟"),
            ("vn", "飞猱"),
            ("oy", "圆吟"),
            ("on", "圆猱"),
            ("ky", "定吟"),
            ("kn", "定猱"),
        ];
        assert_eq!(marks.len(), 21);
        assert_eq!(SLIDE_TOKENS.len(), marks.len());
        for (letter, mark) in marks {
            let mut note = an_da_9_gou_4();
            note.slide = Some((*mark).into());
            let code = format!("ad9{letter}g4");
            assert_eq!(encode(&note).unwrap(), code, "{mark} 编码");
            let decoded = decode(&code).unwrap_or_else(|e| panic!("{code} 解不开：{e}"));
            assert_eq!(decoded.slide.as_deref(), Some(*mark), "{code} 记号");
            assert_eq!(
                decoded.right_action.as_deref(),
                Some("勾"),
                "{code} 右手指法"
            );
            assert_eq!(encode(&decoded).unwrap(), code, "{code} 编回");
        }
    }

    #[test]
    fn test_slide_tokens_are_sorted_longest_first() {
        // match_longest 依赖表顺序：长 token 必须在短 token 前面，
        // 否则 `cy`（绰吟）会被 `c`（绰）截断，剩下 `yg4` 没有以 y 开头的右手指法，整条解码报错。
        for (i, (short, _)) in SLIDE_TOKENS.iter().enumerate() {
            for (long, _) in SLIDE_TOKENS.iter().skip(i + 1) {
                assert!(
                    !(long.starts_with(short) && long.len() > short.len()),
                    "短 token {short} 排在长 token {long} 前面，会截断复合记号"
                );
            }
        }
    }

    #[test]
    fn test_yin_nao_marks_keep_z_ambiguity() {
        // 扩了 z 开头的复合（注吟 zy / 注猱 zn）后，「z 既是注又是摘」的回溯不能被破坏。
        let zhu = decode("ad9zg4").unwrap();
        assert_eq!(zhu.slide.as_deref(), Some("注"));
        let zhai = decode("ad9z4").unwrap();
        assert_eq!(zhai.slide, None);
        assert_eq!(zhai.right_action.as_deref(), Some("摘"));
        // 注吟：zy 必须整体吃掉，不能读成「注」+ 以 y 开头的指法
        assert_eq!(decode("ad9zyg4").unwrap().slide.as_deref(), Some("注吟"));
    }

    #[test]
    fn test_encode_batch_json() {
        let json = r#"{"notes":[
            {"toneType":"散","leftFinger":null,"hui":null,"fen":null,"slide":null,"rightAction":"勾","stringNumber":"三"},
            {"toneType":"按","leftFinger":"大","hui":null,"fen":null,"slide":null,"rightAction":"勾","stringNumber":"四"}
        ]}"#;
        let out = encode_batch_json(json).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["codes"][0], "sg3");
        assert!(v["codes"][1].is_null(), "不完整的字给 null，不整批失败");
    }

    #[test]
    fn test_tokenize_skips_noise_keeps_suspects() {
        // 一整段导出文本：标题、定弦、生僻减字、空位 -、小节线 |、尾行计数。
        let text =
            "# 花非花\n定弦：正调 · 1=F\n1·  |  2   |\n䶴  |  减字  |\nad9g4 | sg3 - st5\n共 12 音";
        let tokens = tokenize_codes(text);
        assert_eq!(tokens, vec!["ad9g4", "sg3", "st5"]);

        // 漏写音色前缀的码要留下来报错，不能悄悄消失。
        assert_eq!(tokenize_codes("d9g4"), vec!["d9g4"]);
        // 纯数字（计数 / 简谱）不算码。
        assert!(tokenize_codes("共 12 音 3 4 5").is_empty());
        // 大小写与中文标点混排也能认。
        assert_eq!(
            tokenize_codes("AD9G4，sg3、st5"),
            vec!["ad9g4", "sg3", "st5"]
        );
    }

    #[test]
    fn test_decode_batch_json_mixed() {
        let out = decode_batch_json(r#"{"text":"ad9g4 sg3 | d9g4"}"#).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["total"], 3);
        assert_eq!(v["ok"], 2);
        assert_eq!(v["failed"], 1);
        assert_eq!(v["entries"][0]["state"]["toneType"], "按");
        assert_eq!(v["entries"][0]["state"]["hui"], "九");
        assert_eq!(v["entries"][1]["state"]["toneType"], "散");
        // 坏码留原文 + 原因，其余不受影响。
        assert_eq!(v["entries"][2]["code"], "d9g4");
        assert!(v["entries"][2]["state"].is_null());
        assert!(
            v["entries"][2]["error"]
                .as_str()
                .unwrap()
                .contains("音色前缀")
        );
    }

    #[test]
    fn test_decode_batch_json_empty() {
        assert!(decode_batch_json(r#"{"text":"   \n#"}"#).is_err());
        assert!(decode_batch_json(r#"{"text":""}"#).is_err());
    }

    #[test]
    fn test_decode_batch_roundtrip_with_encode() {
        // 编 → 粘回 → 解，必须回到同一批减字：这是「导出可再用」的底线。
        let notes = [
            san("勾", "三"),
            an_da_9_gou_4(),
            JianziDictState {
                tone_type: "按".into(),
                left_finger: Some("大".into()),
                hui: Some("七".into()),
                fen: Some("六分".into()),
                slide: Some("绰".into()),
                right_action: Some("勾".into()),
                string_number: Some("二".into()),
            },
        ];
        let codes: Vec<String> = notes.iter().map(|n| encode(n).unwrap()).collect();
        let text = codes.join(" | ");
        let out = decode_batch_json(&serde_json::json!({ "text": text }).to_string()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], 3);
        for (i, note) in notes.iter().enumerate() {
            let back: JianziDictState =
                serde_json::from_value(v["entries"][i]["state"].clone()).unwrap();
            assert_eq!(&back, note, "第 {i} 条往返不一致");
        }
    }

    #[test]
    fn test_tokenize_keeps_rhythm_annotation() {
        assert_eq!(
            tokenize_codes("ad9g4:8. sg3:4 | r:2 — st5"),
            vec!["ad9g4:8.", "sg3:4", "r:2", "st5"]
        );
        // 十六分：16 不能被切成 1 + 6，也不能因为超长被丢掉
        assert_eq!(tokenize_codes("ad9g4:16."), vec!["ad9g4:16."]);
        // 句末句号属于标点，不该把码判死（切词保留原样，解析时去掉句号）
        let out =
            decode_batch_json(&serde_json::json!({ "text": "最后 ad9g4." }).to_string()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], 1, "{}", v["entries"][0]["error"]);
        assert_eq!(v["entries"][0]["state"]["hui"], "九");
    }

    #[test]
    fn test_decode_batch_duration() {
        let out = decode_batch_json(
            &serde_json::json!({ "text": "ad9g4:8. sg3:1 st5:16 r:2 r" }).to_string(),
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();

        assert_eq!(v["entries"][0]["duration"], "八分");
        assert_eq!(v["entries"][0]["dotted"], true);
        assert_eq!(v["entries"][1]["duration"], "全");
        assert_eq!(v["entries"][1]["dotted"], false);
        assert_eq!(v["entries"][2]["duration"], "十六分");
        // 休止符：没有减字、不算失败、默认四分
        assert_eq!(v["entries"][3]["isRest"], true);
        assert_eq!(v["entries"][3]["duration"], "二分");
        assert!(v["entries"][3]["state"].is_null());
        assert!(v["entries"][3]["error"].is_null());
        assert_eq!(v["entries"][4]["isRest"], true);
        assert!(v["entries"][4]["duration"].is_null());
        assert_eq!(v["ok"], 5, "休止符也算解析成功");
        assert_eq!(v["failed"], 0);
    }

    #[test]
    fn test_decode_batch_rejects_bad_duration() {
        let out = decode_batch_json(&serde_json::json!({ "text": "ad9g4:5" }).to_string()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["failed"], 1);
        assert!(
            v["entries"][0]["error"]
                .as_str()
                .unwrap()
                .contains("认不出的时值"),
            "{}",
            v["entries"][0]["error"]
        );

        // 只写了冒号没写数字
        let out = decode_batch_json(&serde_json::json!({ "text": "ad9g4:" }).to_string()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(
            v["entries"][0]["error"]
                .as_str()
                .unwrap()
                .contains("缺数字")
        );
    }

    #[test]
    fn test_duration_tokens_cover_all_values() {
        // 前端 Duration 的五个值必须都能写、都能读回；16 要优先于 1。
        for (digits, expected) in DURATION_TOKENS {
            assert_eq!(duration_from_digits(digits), Some(*expected));
        }
        assert_eq!(duration_from_digits("16"), Some("十六分"));
        assert_eq!(duration_from_digits("6"), None);
    }
}
