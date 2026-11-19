//! 减字「连打」解析器 —— 键盘盲打录谱的**唯一实现**。
//!
//! 这是原先只存在于前端 `apps/web/src/lib/jianzi-rapid.ts` 的文法，现迁入核心库，
//! 让网页（WASM）、App / 小程序 / 第三方（HTTP）共用同一张码表与同一套回溯逻辑。
//! 两边各写一份的下场是码表漂移：加一个指法要改三处，漏一处就只有某个客户端打不出来。
//!
//! # 文法
//!
//! 按减字书写顺序（从上到下、从左到右），槽位链由音色决定：
//!
//! ```text
//! 散音：右手 + 弦序 + [结构记号]
//! 泛音：左手 + 徽位 + [分] + 右手 + 弦序 + [结构记号]
//! 按音：左手 + 徽位 + [分] + [走手音] + 右手 + 弦序 + [结构记号]
//! ```
//!
//! 例：`g4` = 散勾四；`djg4` = 大九勾四；`d9f6cg4` = 大九六分绰勾四。
//!
//! # 为什么是回溯而不是贪心
//!
//! 「s / ss / sss / ssss」「1 / 13」「z 在左手槽 / z 在右手槽」都会命中不同长度或不同含义，
//! 只有「能成整字」的那条路径才是用户想打的字。因此走完整条槽位链、保留最优解。
//!
//! # 返回值用字形而非归一全名
//!
//! 与 `jianzi_code` 相反：编码模块输出归一全名（勾 / 挑 / 名 / 食）用于互操作，
//! 这里输出**键盘显示字形**（勹 / 乚 / 夕 / 亻）——键盘 state 存的就是字形，
//! 改了会让渲染换字。两条表示法并存是既有设计，见前端 `jianzi.ts` 的归一表。

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// 槽位。名字与前端 `JianziState` 字段一致（camelCase），序列化后可直接下发。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Slot {
    ToneType,
    LeftFinger,
    Hui,
    Fen,
    Slide,
    RightAction,
    StringNumber,
    StructureMark,
}

impl Slot {
    pub fn name(self) -> &'static str {
        match self {
            Slot::ToneType => "toneType",
            Slot::LeftFinger => "leftFinger",
            Slot::Hui => "hui",
            Slot::Fen => "fen",
            Slot::Slide => "slide",
            Slot::RightAction => "rightAction",
            Slot::StringNumber => "stringNumber",
            Slot::StructureMark => "structureMark",
        }
    }

    fn bit(self) -> u8 {
        1 << (self as u8)
    }

    /// 可省略槽：不在时整字仍算完整。
    fn optional(self) -> bool {
        matches!(
            self,
            Slot::Fen | Slot::Slide | Slot::StructureMark | Slot::ToneType
        )
    }
}

/// 各音色的槽位顺序。
pub fn slots_for_tone(tone: &str) -> &'static [Slot] {
    const SAN: &[Slot] = &[Slot::RightAction, Slot::StringNumber, Slot::StructureMark];
    const FAN: &[Slot] = &[
        Slot::LeftFinger,
        Slot::Hui,
        Slot::Fen,
        Slot::RightAction,
        Slot::StringNumber,
        Slot::StructureMark,
    ];
    const AN: &[Slot] = &[
        Slot::LeftFinger,
        Slot::Hui,
        Slot::Fen,
        Slot::Slide,
        Slot::RightAction,
        Slot::StringNumber,
        Slot::StructureMark,
    ];
    match tone {
        "散" => SAN,
        "泛" => FAN,
        _ => AN,
    }
}

/// 解析出的一个槽位取值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RapidToken {
    pub slot: Slot,
    pub letter: String,
    pub value: String,
}

/// 拼装中的减字。所有字段都可能为空（半截输入）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RapidState {
    #[serde(rename = "toneType")]
    pub tone_type: Option<String>,
    #[serde(rename = "leftFinger")]
    pub left_finger: Option<String>,
    pub hui: Option<String>,
    pub fen: Option<String>,
    pub slide: Option<String>,
    #[serde(rename = "rightAction")]
    pub right_action: Option<String>,
    #[serde(rename = "stringNumber")]
    pub string_number: Option<String>,
    #[serde(rename = "structureMark")]
    pub structure_mark: Option<String>,
}

impl RapidState {
    fn get(&self, slot: Slot) -> Option<&String> {
        match slot {
            Slot::ToneType => self.tone_type.as_ref(),
            Slot::LeftFinger => self.left_finger.as_ref(),
            Slot::Hui => self.hui.as_ref(),
            Slot::Fen => self.fen.as_ref(),
            Slot::Slide => self.slide.as_ref(),
            Slot::RightAction => self.right_action.as_ref(),
            Slot::StringNumber => self.string_number.as_ref(),
            Slot::StructureMark => self.structure_mark.as_ref(),
        }
    }

    fn set(&mut self, slot: Slot, value: String) {
        match slot {
            Slot::ToneType => self.tone_type = Some(value),
            Slot::LeftFinger => self.left_finger = Some(value),
            Slot::Hui => self.hui = Some(value),
            Slot::Fen => self.fen = Some(value),
            Slot::Slide => self.slide = Some(value),
            Slot::RightAction => self.right_action = Some(value),
            Slot::StringNumber => self.string_number = Some(value),
            Slot::StructureMark => self.structure_mark = Some(value),
        }
    }
}

/// 解析结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RapidParse {
    pub state: RapidState,
    pub consumed: usize,
    pub complete: bool,
    pub tokens: Vec<RapidToken>,
    #[serde(rename = "nextSlot")]
    pub next_slot: Option<Slot>,
}

// ──────────────────────────────────────────────
// 码表
// ──────────────────────────────────────────────

/// 音色前缀。长串靠前：`san` 必须先于 `s` 命中。
const TONE_TOKENS: &[(&str, &str)] = &[
    ("san", "散"),
    ("fan", "泛"),
    ("an", "按"),
    ("s", "散"),
    ("f", "泛"),
    ("a", "按"),
];

/// 单槽码表。**顺序即正确性**：同前缀的长码必须排在短码之前。
fn tokens_for(slot: Slot) -> &'static [(&'static str, &'static str)] {
    // 左手：键盘存偏旁字形（亻 = 食指、夕 = 名指），与 `DEFAULT_KEYBOARD` 一致。
    const LEFT: &[(&str, &str)] = &[
        ("d", "大"),
        ("s", "亻"),
        ("z", "中"),
        ("m", "夕"),
        ("g", "跪"),
    ];
    // 徽位：数字 1–13 为主，同时保留火蜘蛛的字母旧法。
    const HUI: &[(&str, &str)] = &[
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
        ("ssss", "十三"),
        ("sssy", "十一"),
        ("ssse", "十二"),
        ("sss", "十"),
        ("ss", "四"),
        ("s", "三"),
        ("y", "一"),
        ("e", "二"),
        ("w", "五"),
        ("l", "六"),
        ("q", "七"),
        ("b", "八"),
        ("j", "九"),
    ];
    // 分：可选槽，用 f + 数字/半；裸数字留给徽位。
    const FEN: &[(&str, &str)] = &[
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
    // 走手音 21 个：双字母复合必须排在单字母前，否则 `cy` 会被 `c` 截断。
    const SLIDE: &[(&str, &str)] = &[
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
    // 右手：复合指法在前；注意 `ti` 排在 `tu` 之前，与既有前端码表一致。
    const ACTION: &[(&str, &str)] = &[
        ("mt", "抹挑"),
        ("gt", "勾剔"),
        ("mg", "抹勾"),
        ("dz", "打摘"),
        ("ek", "半扶"),
        ("il", "长锁"),
        ("kq", "短锁"),
        ("lr", "背锁"),
        ("qx", "圆锁"),
        ("wi", "半涓"),
        ("xe", "反涓"),
        ("ki", "叠涓"),
        ("eq", "连涓"),
        ("ti", "剔"),
        ("tu", "乇"),
        ("t", "乚"),
        ("m", "木"),
        ("g", "勹"),
        ("d", "丁"),
        ("z", "倽"),
        ("b", "尸"),
        ("u", "轮"),
        ("o", "锁"),
        ("v", "涓"),
        ("h", "历"),
        ("p", "拂"),
    ];
    const STRING: &[(&str, &str)] = &[
        ("1", "一"),
        ("2", "二"),
        ("3", "三"),
        ("4", "四"),
        ("5", "五"),
        ("6", "六"),
        ("7", "七"),
        ("ss", "四"),
        ("s", "三"),
        ("y", "一"),
        ("e", "二"),
        ("w", "五"),
        ("l", "六"),
        ("q", "七"),
    ];
    // 谱面结构记号：接在弦序之后的末尾可选槽，码字首字母两两不同，不会互相截断。
    const STRUCTURE: &[(&str, &str)] = &[
        ("xx", "少息"),
        ("dx", "大息"),
        ("zz", "再作"),
        ("cz", "从头再作"),
        ("rp", "入拍"),
    ];
    match slot {
        Slot::LeftFinger => LEFT,
        Slot::Hui => HUI,
        Slot::Fen => FEN,
        Slot::Slide => SLIDE,
        Slot::RightAction => ACTION,
        Slot::StringNumber => STRING,
        Slot::StructureMark => STRUCTURE,
        Slot::ToneType => &[],
    }
}

/// 去掉空白与标点、转小写、全角转半角。
pub fn normalize_rapid_input(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        if c.is_whitespace() || matches!(c, ',' | '，' | '、') {
            continue;
        }
        let half = match c as u32 {
            0xFF01..=0xFF5E => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
            _ => c,
        };
        let lower = half.to_ascii_lowercase();
        if lower.is_ascii_lowercase() || lower.is_ascii_digit() {
            out.push(lower);
        }
    }
    out
}

// ──────────────────────────────────────────────
// 解析
// ──────────────────────────────────────────────

/// 单个槽位能否用该位置起的字符填充。
fn match_slot(slot: Slot, input: &[u8], pos: usize) -> Option<(usize, &'static str)> {
    let rest = input.get(pos..)?;
    for (key, value) in tokens_for(slot) {
        let k = key.as_bytes();
        if rest.starts_with(k) {
            return Some((k.len(), value));
        }
    }
    None
}

#[derive(Clone)]
struct Candidate {
    state: RapidState,
    consumed: usize,
    filled: u32,
    tokens: Vec<RapidToken>,
}

/// 一次回溯遍历的固定上下文。
///
/// 打包成一个结构体而不是八个参数：`walk` 是递归函数，`input` / `order` / `best`
/// 在整个遍历里都不变，横在参数表里只会让递归调用难读——而且参数一多，
/// 顺序写错编译器也看不出来。
struct Walk<'a> {
    input: &'a [u8],
    order: &'a [Slot],
    best: Option<Candidate>,
}

/// 在给定音色下从 `pos` 起走完整条槽位链，保留走过的「最远 / 最满」状态。
fn run(tone: &str, input: &[u8], pos: usize) -> Candidate {
    let order = slots_for_tone(tone);
    let mut ctx = Walk {
        input,
        order,
        best: None,
    };
    walk(pos, 0, &RapidState::default(), &mut Vec::new(), 0, &mut ctx);
    ctx.best.unwrap_or(Candidate {
        state: RapidState::default(),
        consumed: pos,
        filled: 0,
        tokens: Vec::new(),
    })
}

fn walk(
    p: usize,
    slot_idx: usize,
    state: &RapidState,
    tokens: &mut Vec<RapidToken>,
    touched: u8,
    ctx: &mut Walk<'_>,
) {
    let filled = touched.count_ones();
    let better = match &ctx.best {
        None => true,
        Some(b) => p > b.consumed || (p == b.consumed && filled > b.filled),
    };
    if better {
        ctx.best = Some(Candidate {
            state: state.clone(),
            consumed: p,
            filled,
            tokens: tokens.clone(),
        });
    }

    if slot_idx >= ctx.order.len() {
        return;
    }
    let slot = ctx.order[slot_idx];

    // 「分」「走手音」是可省略槽：整段跳过也算一条路径
    if matches!(slot, Slot::Fen | Slot::Slide) {
        walk(p, slot_idx + 1, state, tokens, touched, ctx);
    }

    let Some((len, value)) = match_slot(slot, ctx.input, p) else {
        return;
    };
    let mut next = state.clone();
    next.set(slot, value.to_string());
    tokens.push(RapidToken {
        slot,
        letter: String::from_utf8_lossy(&ctx.input[p..p + len]).into_owned(),
        value: value.to_string(),
    });
    walk(
        p + len,
        slot_idx + 1,
        &next,
        tokens,
        touched | slot.bit(),
        ctx,
    );
    tokens.pop();
}

/// 未填的必填槽（分 / 走手音 / 结构记号可省）。
fn first_missing(state: &RapidState, tone: &str) -> Option<Slot> {
    slots_for_tone(tone)
        .iter()
        .copied()
        .find(|slot| !slot.optional() && state.get(*slot).is_none())
}

fn is_complete(state: &RapidState, tone: &str, consumed: usize, len: usize) -> bool {
    if len == 0 || consumed != len {
        return false;
    }
    first_missing(state, tone).is_none()
}

/// 候选优先级：先看能否成整字，再看吃掉多少字符，最后看填了几个槽。
fn candidate_better(a: &(Candidate, bool), b: &(Candidate, bool)) -> bool {
    if a.1 != b.1 {
        return a.1;
    }
    if a.0.consumed != b.0.consumed {
        return a.0.consumed > b.0.consumed;
    }
    a.0.filled > b.0.filled
}

/// 解析连打串。
///
/// `tone_type` 是界面上当前选中的音色；`force` 关掉「当前音色吃满就不兜底」的保护
/// （回车提交时由用户明确表态）。
pub fn parse_rapid_input(raw: &str, tone_type: &str, force: bool) -> RapidParse {
    let input = normalize_rapid_input(raw);
    let bytes = input.as_bytes();
    let len = bytes.len();

    let mut best: Option<(Candidate, bool)> = None;

    let consider = |tone: &str,
                    pos: usize,
                    prefix: Option<RapidToken>,
                    best: &mut Option<(Candidate, bool)>| {
        let c = run(tone, bytes, pos);
        // 泛音滑不动：写进来也不收（与按音之外的音色一致）
        let slide = if tone == "按" {
            c.state.slide.clone()
        } else {
            None
        };
        let mut state = c.state.clone();
        state.tone_type = Some(tone.to_string());
        state.slide = slide;

        let filled = c.filled + u32::from(prefix.is_some());
        let complete = is_complete(&state, tone, c.consumed, len);
        let mut tokens = c.tokens.clone();
        if let Some(p) = prefix {
            tokens.insert(0, p);
        }
        let candidate = Candidate {
            state,
            consumed: c.consumed,
            filled,
            tokens,
        };
        let entry = (candidate, complete);
        let better = match best {
            None => true,
            Some(b) => candidate_better(&entry, b),
        };
        if better {
            *best = Some(entry);
        }
    };

    // ① 串首显式音色前缀（s / f / a，长串优先）
    for (key, tone) in TONE_TOKENS {
        if input.starts_with(key) {
            consider(
                tone,
                key.len(),
                Some(RapidToken {
                    slot: Slot::ToneType,
                    letter: (*key).to_string(),
                    value: (*tone).to_string(),
                }),
                &mut best,
            );
        }
    }

    // ② 界面选中音色
    let ui_consumed = run(tone_type, bytes, 0).consumed;
    consider(tone_type, 0, None, &mut best);

    // ③ 兜底：字符串本身已说清音色时，不该因为界面停在别处而打不出来。
    //    但只在当前音色「读不下去」时才捡，否则会提前成字（打 d13g4 时 d1 被读成散打一）。
    let ui_took_over = !force && ui_consumed == len && len > 0;
    if !ui_took_over {
        for fallback in ["按", "散"] {
            if fallback != tone_type {
                consider(fallback, 0, None, &mut best);
            }
        }
    }

    let (candidate, complete) = best.unwrap_or_else(|| {
        (
            Candidate {
                state: RapidState {
                    tone_type: Some(tone_type.to_string()),
                    ..RapidState::default()
                },
                consumed: 0,
                filled: 0,
                tokens: Vec::new(),
            },
            false,
        )
    });

    let next_slot = if complete {
        None
    } else {
        first_missing(
            &candidate.state,
            candidate.state.tone_type.as_deref().unwrap_or(tone_type),
        )
    };

    RapidParse {
        state: candidate.state,
        consumed: candidate.consumed,
        complete,
        tokens: candidate.tokens,
        next_slot,
    }
}

// ──────────────────────────────────────────────
// JSON 桥接（WASM / HTTP 共用）
// ──────────────────────────────────────────────

/// 把解析结果转成前端 `JianziState` 形状的 JSON（补上 `rhythmMode: null`）。
pub fn parse_to_json_value(parsed: &RapidParse) -> Value {
    let s = &parsed.state;
    json!({
        "state": {
            "toneType": s.tone_type,
            "rhythmMode": Value::Null,
            "leftFinger": s.left_finger,
            "hui": s.hui,
            "fen": s.fen,
            "slide": s.slide,
            "structureMark": s.structure_mark,
            "rightAction": s.right_action,
            "stringNumber": s.string_number,
        },
        "consumed": parsed.consumed,
        "complete": parsed.complete,
        "tokens": parsed.tokens,
        "nextSlot": parsed.next_slot,
    })
}

/// 输入 JSON：`{"input": "djg4", "tone": "按", "force": false}`。
/// 输出见 [`parse_to_json_value`]；解析失败返回 `{"error": ...}`。
pub fn parse_rapid_input_json(input_json: &str) -> String {
    #[derive(Deserialize)]
    struct Request {
        input: String,
        #[serde(default)]
        tone: Option<String>,
        #[serde(default)]
        force: bool,
    }

    let req: Request = match serde_json::from_str(input_json) {
        Ok(r) => r,
        Err(e) => return json!({"error": e.to_string()}).to_string(),
    };
    let tone = req.tone.as_deref().unwrap_or("按");
    let parsed = parse_rapid_input(&req.input, tone, req.force);
    parse_to_json_value(&parsed).to_string()
}

/// 各音色的槽位顺序，供客户端渲染输入提示而不必抄一份。
pub fn slots_json() -> Value {
    json!({
        "散": slots_for_tone("散").iter().map(|s| s.name()).collect::<Vec<_>>(),
        "泛": slots_for_tone("泛").iter().map(|s| s.name()).collect::<Vec<_>>(),
        "按": slots_for_tone("按").iter().map(|s| s.name()).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(raw: &str, tone: &str) -> RapidParse {
        parse_rapid_input(raw, tone, false)
    }

    #[test]
    fn normalize_strips_and_folds() {
        assert_eq!(normalize_rapid_input(" D J, G 4 "), "djg4");
        assert_eq!(normalize_rapid_input("ｄｊｇ４"), "djg4");
    }

    #[test]
    fn san_yin_slots_have_no_slide() {
        assert_eq!(
            slots_for_tone("散"),
            &[Slot::RightAction, Slot::StringNumber, Slot::StructureMark]
        );
        assert!(!slots_for_tone("散").contains(&Slot::Slide));
    }

    #[test]
    fn san_g4_is_complete() {
        let r = parse("g4", "散");
        assert!(r.complete);
        assert_eq!(r.state.right_action.as_deref(), Some("勹"));
        assert_eq!(r.state.string_number.as_deref(), Some("四"));
        assert_eq!(r.state.left_finger, None);
        assert_eq!(r.state.hui, None);
    }

    #[test]
    fn san_s_ambiguity_three_vs_four() {
        assert_eq!(parse("gs", "散").state.string_number.as_deref(), Some("三"));
        assert_eq!(
            parse("gss", "散").state.string_number.as_deref(),
            Some("四")
        );
    }

    #[test]
    fn an_yin_djg4_full() {
        let r = parse("djg4", "按");
        assert!(r.complete);
        assert_eq!(r.consumed, 4);
        assert_eq!(r.state.left_finger.as_deref(), Some("大"));
        assert_eq!(r.state.hui.as_deref(), Some("九"));
        assert_eq!(r.state.right_action.as_deref(), Some("勹"));
        assert_eq!(r.state.string_number.as_deref(), Some("四"));
    }

    #[test]
    fn hui_letter_disambiguation() {
        assert_eq!(parse("dssg4", "按").state.hui.as_deref(), Some("四"));
        assert_eq!(parse("dsssg4", "按").state.hui.as_deref(), Some("十"));
        assert_eq!(parse("dsg4", "按").state.hui.as_deref(), Some("三"));
    }

    #[test]
    fn fen_optional_and_insertable() {
        assert_eq!(parse("djg4", "按").state.fen, None);
        let with_fen = parse("djf6g4", "按");
        assert!(with_fen.complete);
        assert_eq!(with_fen.state.fen.as_deref(), Some("六分"));
        assert_eq!(with_fen.state.hui.as_deref(), Some("九"));
    }

    #[test]
    fn right_action_letters() {
        assert_eq!(
            parse("djt4", "按").state.right_action.as_deref(),
            Some("乚")
        );
        assert_eq!(
            parse("djtu4", "按").state.right_action.as_deref(),
            Some("乇")
        );
        assert_eq!(
            parse("djti4", "按").state.right_action.as_deref(),
            Some("剔")
        );
        assert_eq!(
            parse("djmt4", "按").state.right_action.as_deref(),
            Some("抹挑")
        );
    }

    #[test]
    fn same_letter_differs_by_slot() {
        assert_eq!(parse("d", "按").state.left_finger.as_deref(), Some("大"));
        let r = parse("djd4", "按");
        assert_eq!(r.state.left_finger.as_deref(), Some("大"));
        assert_eq!(r.state.right_action.as_deref(), Some("丁"));
    }

    #[test]
    fn partial_input_reports_next_slot() {
        let r = parse("dj", "按");
        assert!(!r.complete);
        assert_eq!(r.consumed, 2);
        assert_eq!(r.next_slot, Some(Slot::RightAction));
    }

    #[test]
    fn trailing_garbage_is_not_complete() {
        assert!(!parse("djg4x", "按").complete);
        assert!(!parse("", "按").complete);
    }

    #[test]
    fn tone_is_recorded_and_rhythm_left_empty() {
        let r = parse("mqt3", "泛");
        assert!(r.complete);
        assert_eq!(r.state.tone_type.as_deref(), Some("泛"));
        assert_eq!(parse_to_json_value(&r)["state"]["rhythmMode"], Value::Null);
    }

    #[test]
    fn fan_yin_needs_full_four_slots() {
        assert!(parse("mqt3", "泛").complete);
        assert!(!parse("dg4", "泛").complete);
    }

    #[test]
    fn explicit_tone_prefix_wins() {
        let r = parse("sg3", "按");
        assert!(r.complete);
        assert_eq!(r.state.tone_type.as_deref(), Some("散"));
        assert_eq!(r.state.right_action.as_deref(), Some("勹"));
    }

    #[test]
    fn ui_tone_taking_whole_input_blocks_fallback() {
        // 按音界面打「d1」：当前音色吃满整串，不该提前成「散打一」
        let r = parse("d1", "按");
        assert!(!r.complete);
    }

    #[test]
    fn force_allows_best_effort_on_enter() {
        // 按音界面下打 g4，force 时按最优解入谱
        let r = parse_rapid_input("g4", "按", true);
        assert!(r.complete);
    }

    #[test]
    fn slide_only_for_an_yin() {
        let r = parse("djcg4", "按");
        assert_eq!(r.state.slide.as_deref(), Some("绰"));
        // 散音没有走手音槽
        assert_eq!(parse("sg3", "散").state.slide, None);
    }

    #[test]
    fn structure_mark_tail() {
        let r = parse("sg3xx", "散");
        assert!(r.complete);
        assert_eq!(r.state.structure_mark.as_deref(), Some("少息"));
    }

    #[test]
    fn json_bridge_shape() {
        let out = parse_rapid_input_json(r#"{"input":"g4","tone":"散"}"#);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["complete"], json!(true));
        assert_eq!(v["state"]["rightAction"], json!("勹"));
        assert!(v["state"].get("rhythmMode").is_some());
    }
}
