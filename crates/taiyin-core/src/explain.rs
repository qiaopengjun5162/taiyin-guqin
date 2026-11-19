//! 减字 → 人话释义 —— 前端 `jianzi-explain.ts` 的**唯一实现**。
//!
//! 录入减字只是第一步；琴友拿起一张谱，真正要回答的是「这个字怎么弹」。
//! 本模块把减字状态拆成听得到的句子：
//!
//! ```text
//! 大七六勾四 → 按音 · 大指按于四弦七徽六分，右手中指勾弦
//! ```
//!
//! 释义只做「读谱」——指法名称、手指、按弦位置、弦序、大致音高，
//! 不涉及吟猱绰注等风格性处理（那些靠师授，不宜由程序断言）。
//!
//! # 为什么把中文文案也放进核心
//!
//! 这里最大的资产不是算法，而是**文案本身**：21 个装饰记号各自的解释、
//! 8 个右手指法的说明、5 个结构记号的气口含义。同一个减字在网页、小程序、App
//! 上必须读出**同一句话**——否则用户在两处看到两种说法，只会怀疑自己记错了。
//!
//! 改一句文案要重新编译 WASM（秒级），换来的是三端永远不会说法不一。
//! 这笔交易划算，因为「读法」是这个产品的核心内容，不是装饰。

use serde::{Deserialize, Serialize};

use crate::pitch::{self, PitchContext, PitchQuery, ToneType};

/// 逐项拆解中的一项。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExplainPart {
    /// 分组名：音色 / 左手 / 徽位 / 右手 / 弦序 / 走手音 / 结构记号
    pub label: String,
    pub text: String,
}

/// 完整的释义结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Explanation {
    /// 是否已构成一个完整可弹的减字
    pub complete: bool,
    /// 一句话读法（完整时）；不完整时为空串
    pub summary: String,
    /// 逐项拆解，便于对照谱字
    pub parts: Vec<ExplainPart>,
    /// 大致音高，如「简谱 5 · 正调推定」；推不出时为 None
    #[serde(rename = "pitchHint")]
    pub pitch_hint: Option<String>,
    /// 还缺哪些槽位（中文名），完整时为空
    pub missing: Vec<String>,
}

/// 待释义的减字状态（与前端 `JianziState` 同形）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct JianziInput {
    #[serde(rename = "toneType", default)]
    pub tone_type: Option<String>,
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

// ──────────────────────────────────────────────
// 指法字典
// ──────────────────────────────────────────────

/// 装饰记号读法，21 个必须全覆盖。
///
/// 不能写成「三选一，else 就是急」：扩到 21 个之后，任何一个吟猱记号
/// 都会被读成「急（急弹…）」，谱面没错、释义全错。所以用显式表，
/// 并有测试逐个断言都登记了，漏一个就红。
/// 吟猱属广义走手音，故归到「走手音」组；只有「急」单列「弹法」。
fn slide_explain(slide: &str) -> Option<(&'static str, &'static str)> {
    Some(match slide {
        "绰" => ("走手音", "绰（从本位下方滑上来，落到这个徽位）"),
        "注" => ("走手音", "注（从本位上方滑下来，落到这个徽位）"),
        "急" => (
            "弹法",
            "急（急弹：这一声弹得急促，音高不变——节奏仍按所填时值）",
        ),
        "吟" => ("走手音", "吟（得音后指在本位作细微往复颤动，音高微微波动）"),
        "猱" => ("走手音", "猱（幅度比吟大、速度较缓的往复，苍劲有余韵）"),
        "绰吟" => ("走手音", "绰吟（从本位下方滑上来，到位后作吟）"),
        "绰猱" => ("走手音", "绰猱（从本位下方滑上来，到位后作猱）"),
        "注吟" => ("走手音", "注吟（从本位上方滑下来，到位后作吟）"),
        "注猱" => ("走手音", "注猱（从本位上方滑下来，到位后作猱）"),
        "细吟" => ("走手音", "细吟（幅度小而密的吟）"),
        "细猱" => ("走手音", "细猱（幅度收窄的猱）"),
        "游吟" => ("走手音", "游吟（音位从容游移的吟）"),
        "游猱" => ("走手音", "游猱（音位游移、幅度较大的猱）"),
        "荡吟" => ("走手音", "荡吟（来回荡漾的吟）"),
        "荡猱" => ("走手音", "荡猱（来回荡漾、幅度较大的猱）"),
        "飞吟" => ("走手音", "飞吟（迅疾掠过的吟）"),
        "飞猱" => ("走手音", "飞猱（迅疾掠过、幅度较大的猱）"),
        "圆吟" => ("走手音", "圆吟（圆转无棱角的吟）"),
        "圆猱" => ("走手音", "圆猱（圆转无棱角的猱）"),
        "定吟" => ("走手音", "定吟（本位不移动、指力微颤的吟）"),
        "定猱" => ("走手音", "定猱（本位不移动而幅度内收的猱）"),
        _ => return None,
    })
}

/// 谱面结构记号读法（5 个，与 `StructureMark` 枚举同源）。
///
/// 结构记号和减字不是一回事：少息/大息是音后气口，再作/从头再作是反复记号，
/// 入拍是从自由节奏切回严格拍速。它们挂在音符上、属谱面层标记，不参与
/// 「这个减字本身弹不弹得出来」的判定——一个带少息的勾四照样是可弹的整字。
fn structure_mark_explain(mark: &str) -> Option<(&'static str, &'static str)> {
    Some(match mark {
        "少息" => (
            "结构记号",
            "少息（短气口：此处略作停顿、换气，时值上等同一个短休止，一般不计拍）",
        ),
        "大息" => (
            "结构记号",
            "大息（长气口：比少息更明显的呼吸停顿，谱面留出一段宽气口）",
        ),
        "再作" => (
            "结构记号",
            "再作（重复记号：把紧邻的前一个片段或乐句再弹一遍）",
        ),
        "从头再作" => ("结构记号", "从头再作（反复记号：从本曲开头处重新弹奏一遍）"),
        "入拍" => (
            "结构记号",
            "入拍（进入严格节拍：此前可自由节奏，自此句起按固定拍速弹奏）",
        ),
        _ => return None,
    })
}

/// 左手指法：减字偏旁 → 名称与补充说明。
fn left_finger(finger: &str) -> Option<(&'static str, Option<&'static str>)> {
    Some(match finger {
        "大" => ("大指", Some("拇指")),
        "食" | "亻" => ("食指", None),
        "中" => ("中指", None),
        "名" | "夕" => ("名指", Some("即无名指")),
        "跪" => ("跪指", Some("名指屈起第一关节，以指背按弦")),
        _ => return None,
    })
}

/// 右手指法信息。
struct RightAction {
    name: &'static str,
    finger: &'static str,
    /// 拨弦方向：内 = 朝自己身体一侧，外 = 离身一侧
    direction: Option<&'static str>,
    /// 复合指法等额外说明
    note: Option<&'static str>,
}

/// 右手指法：偏旁与全字都收，粘贴传统谱本时同样能解释。
fn right_action(action: &str) -> Option<RightAction> {
    let a = |name, finger, direction, note| {
        Some(RightAction {
            name,
            finger,
            direction,
            note,
        })
    };
    match action {
        "乇" | "托" => a("托", "大指", Some("外"), None),
        "尸" | "擘" | "劈" => a("擘", "大指", Some("内"), None),
        "木" | "抹" => a("抹", "食指", Some("内"), None),
        "乚" | "挑" => a("挑", "食指", Some("外"), None),
        "勹" | "勾" => a("勾", "中指", Some("内"), None),
        "剔" => a("剔", "中指", Some("外"), None),
        "丁" | "打" => a("打", "无名指", Some("内"), None),
        "倽" | "摘" => a("摘", "无名指", Some("外"), None),
        // 复合指法（字体 GSUB 支持的四组，另加文本兼容的仰托）
        "抹挑" => a("抹挑", "食指", None, Some("先抹后挑，一弦连得两声")),
        "勾剔" => a("勾剔", "中指", None, Some("先勾后剔，一弦连得两声")),
        "抹勾" => a("抹勾", "食指、中指", None, Some("食指抹、中指勾，两指相接")),
        "打摘" => a("打摘", "无名指", None, Some("先打后摘，一弦连得两声")),
        "仰托" => a(
            "仰托",
            "大指",
            Some("外"),
            Some("字体无此连字，仅作文本兼容"),
        ),
        // 成块单指法（字体内折成块，GSUB 单字替换已核验真身）
        // 蠲/剌 字体 cmap→placeholder 且无 GSUB 规则，渲染为占位框，不接入。
        "轮" => a(
            "轮",
            "无名指、中指、食指",
            None,
            Some("轮指：三指依次快速摘托挑，一弦连得三声"),
        ),
        "锁" => a(
            "锁",
            "食指、中指",
            None,
            Some("锁铃/长锁：抹勾剔连作，三声相系"),
        ),
        "涓" => a("涓", "食指", Some("外"), Some("连剔两弦，轻作二声")),
        "历" => a("历", "食指", Some("外"), Some("食指连挑数弦，历历而下")),
        "拂" => a(
            "拂",
            "食指、中指、无名指",
            Some("外"),
            Some("三指依次向外拂过数弦"),
        ),
        // 复合指法（成块，GSUB 连字 lgw_* 已核验真身）
        "半扶" => a(
            "半扶",
            "食指、中指",
            Some("内"),
            Some("半扶：食指抹扶相连，一弦得两声"),
        ),
        "长锁" => a(
            "长锁",
            "食指、中指",
            None,
            Some("长锁：抹勾剔连作，三声相系，节奏较长"),
        ),
        "短锁" => a("短锁", "食指、中指", None, Some("短锁：抹勾剔短促相连")),
        "背锁" => a("背锁", "食指、中指", None, Some("背锁：反向锁铃，指法相背")),
        "圆锁" => a("圆锁", "食指、中指", None, Some("圆锁：锁铃圆转连贯")),
        "半涓" => a(
            "半涓",
            "食指",
            Some("内"),
            Some("半涓：抹勾相连，一弦得两声"),
        ),
        "反涓" => a("反涓", "食指", Some("内"), Some("反涓：反向涓，指法倒用")),
        "叠涓" => a("叠涓", "食指", Some("内"), Some("叠涓：涓法叠加，声繁")),
        "连涓" => a("连涓", "食指", Some("内"), Some("连涓：涓法连作，声相续")),
        _ => None,
    }
}

/// 弦序补充：首尾两弦点明粗细高低，中间弦不必啰嗦。
fn string_note(s: &str) -> Option<&'static str> {
    match s {
        "一" => Some("最粗、最低"),
        "七" => Some("最细、最高"),
        _ => None,
    }
}

/// 徽位里几个有明确分数含义的，直接说出来；其余给百分比。
fn hui_note(hui: u8) -> Option<&'static str> {
    Some(match hui {
        1 => "弦长 1/8 处",
        4 => "弦长 1/4 处",
        5 => "弦长 1/3 处",
        7 => "弦的正中（1/2 处）",
        9 => "弦长 2/3 处",
        10 => "弦长 3/4 处",
        13 => "弦长 7/8 处",
        _ => return None,
    })
}

/// 中文徽位 → 数字（一…十三）。
fn hui_from_chinese(hui: &str) -> Option<u8> {
    Some(match hui {
        "一" => 1,
        "二" => 2,
        "三" => 3,
        "四" => 4,
        "五" => 5,
        "六" => 6,
        "七" => 7,
        "八" => 8,
        "九" => 9,
        "十" => 10,
        "十一" => 11,
        "十二" => 12,
        "十三" => 13,
        _ => return None,
    })
}

/// 数字 → 中文徽位。
fn hui_to_chinese(hui: u8) -> &'static str {
    const NAMES: [&str; 14] = [
        "", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三",
    ];
    NAMES.get(hui as usize).copied().unwrap_or("")
}

/// 分位 → 占相邻两徽间隔的比例（三分 = 0.3、半 = 0.5）。
fn fen_fraction(fen: &str) -> f64 {
    match fen {
        "一分" => 0.1,
        "二分" => 0.2,
        "三分" => 0.3,
        "四分" => 0.4,
        "五分" => 0.5,
        "六分" => 0.6,
        "七分" => 0.7,
        "八分" => 0.8,
        "九分" => 0.9,
        "半" => 0.5,
        _ => 0.0,
    }
}

/// 徽位 + 分位 → 位置描述，如「七徽六分 · 七徽与八徽之间，过七徽 6 成」。
pub fn describe_hui_position(hui: &str, fen: Option<&str>) -> Option<String> {
    let hui_num = hui_from_chinese(hui)?;
    let base = format!("{hui}徽");
    let Some(fen) = fen else {
        return Some(match hui_note(hui_num) {
            Some(note) => format!("{base} · {note}"),
            None => base,
        });
    };

    if fen == "半" {
        return Some(if hui_num < 13 {
            format!(
                "{base}半 · {hui}徽与{}徽的正中",
                hui_to_chinese(hui_num + 1)
            )
        } else {
            format!("{base}外半位 · 再往龙龈方向半位")
        });
    }

    // 「三分」→ 3
    let digit = fen.trim_end_matches('分');
    let n = match digit {
        "一" => 1,
        "二" => 2,
        "三" => 3,
        "四" => 4,
        "五" => 5,
        "六" => 6,
        "七" => 7,
        "八" => 8,
        "九" => 9,
        _ => return Some(format!("{base}{fen}")),
    };

    Some(if hui_num < 13 {
        format!(
            "{base}{fen} · {hui}徽与{}徽之间，过{hui}徽 {n} 成",
            hui_to_chinese(hui_num + 1)
        )
    } else {
        // 十三徽外还有一小段弦，分位按上一间隔外推
        format!("{base}{fen} · 再往龙龈方向 {n} 成")
    })
}

/// 徽位 + 分位 → 距岳山的弦长百分比描述。
fn position_percent(hui: &str, fen: Option<&str>) -> Option<String> {
    let hui_num = hui_from_chinese(hui)?;
    let p = pitch::hui_fraction(hui_num, fen.map(fen_fraction))?;
    if !(p > 0.0 && p < 1.0) {
        return None;
    }
    Some(format!("距岳山约 {:.1}% 弦长处", p * 100.0))
}

/// 简谱八度标记 → 口语。
fn octave_text(octave: &str) -> &'static str {
    match octave {
        "·" => "高八度",
        "··" => "高两个八度",
        "," => "低八度",
        ",," => "低两个八度",
        _ => "",
    }
}

/// 定弦的显示名与七弦音名（与前端 `tuning.ts` 的 `name` / `noteNames` 一致）。
fn tuning_display(tuning: crate::jianpu::Tuning) -> (&'static str, [&'static str; 7]) {
    use crate::jianpu::Tuning;
    match tuning {
        Tuning::ZhengDiao => ("正调", ["C2", "D2", "F2", "G2", "A2", "C3", "D3"]),
        Tuning::RuiBin => ("蕤宾调", ["C2", "D2", "F2", "G2", "B♭2", "C3", "D3"]),
        Tuning::ManJiao => ("慢角调", ["C2", "D2", "E2", "G2", "A2", "C3", "D3"]),
    }
}

/// 右手描述，如「中指勾（朝自己一侧拨弦）」。
pub fn describe_right_action(action: &str) -> String {
    let Some(a) = right_action(action) else {
        return action.to_string();
    };
    let dir = match a.direction {
        Some("内") => Some("朝自己一侧拨弦"),
        Some("外") => Some("离身一侧拨弦"),
        _ => None,
    };
    // note 优先于 direction：复合指法的说明比「往哪拨」更有信息量
    let tail = a.note.or(dir);
    match tail {
        Some(t) => format!("{}{}（{}）", a.finger, a.name, t),
        None => format!("{}{}", a.finger, a.name),
    }
}

/// 缺失槽位（散音不要左手指法与徽位）。
fn missing_slots(state: &JianziInput) -> Vec<&'static str> {
    let mut missing = Vec::new();
    if state.tone_type.is_none() {
        missing.push("音色");
    }
    if state.tone_type.as_deref() != Some("散") {
        if state.left_finger.is_none() {
            missing.push("左手指法");
        }
        if state.hui.is_none() {
            missing.push("徽位");
        }
    }
    if state.right_action.is_none() {
        missing.push("右手指法");
    }
    if state.string_number.is_none() {
        missing.push("弦序");
    }
    missing
}

/// 弦序中文 → 1..=7。
fn string_index(s: &str) -> Option<u8> {
    let idx = "一二三四五六七".find(s)?;
    // `find` 返回字节偏移；这些字都是 3 字节，除一下才是序号
    Some((idx / 3) as u8 + 1)
}

/// 减字状态 → 释义。任何时候都能调用，未完成时会告诉你还缺什么。
pub fn explain(state: &JianziInput, ctx: PitchContext) -> Explanation {
    let missing = missing_slots(state);
    let complete = missing.is_empty();
    let mut parts = Vec::new();
    let tone = state.tone_type.as_deref();
    let is_san = tone == Some("散");
    let is_fan = tone == Some("泛");

    // 音色
    if let Some(t) = tone {
        let desc = match t {
            "散" => "散音（左手不按弦，取空弦）",
            "泛" => "泛音（左手轻触徽位，虚按不实）",
            _ => "按音（左手按实于徽位）",
        };
        parts.push(ExplainPart {
            label: "音色".into(),
            text: desc.into(),
        });
    }

    // 左手
    if !is_san && let Some(f) = state.left_finger.as_deref() {
        let text = match left_finger(f) {
            Some((name, Some(note))) => format!("{name}（{note}）"),
            Some((name, None)) => name.to_string(),
            None => f.to_string(),
        };
        parts.push(ExplainPart {
            label: "左手".into(),
            text,
        });
    }

    // 徽位
    if !is_san
        && let Some(pos) = state
            .hui
            .as_deref()
            .and_then(|hui| describe_hui_position(hui, state.fen.as_deref()))
    {
        let text = match state
            .hui
            .as_deref()
            .and_then(|hui| position_percent(hui, state.fen.as_deref()))
        {
            Some(pct) => format!("{pos}；{pct}"),
            None => pos,
        };
        parts.push(ExplainPart {
            label: "徽位".into(),
            text,
        });
    }

    // 绰/注 改变音高走向，急 是弹法，吟猱族是余韵——读法各不相同，全从表取。
    // 表里没有的也不假装是「急」，给一条诚实的兜底（覆盖由测试守着）。
    if !is_san
        && !is_fan
        && let Some(slide) = state.slide.as_deref()
    {
        let (label, text) = slide_explain(slide)
            .map(|(l, t)| (l, t.to_string()))
            .unwrap_or(("走手音", format!("{slide}（装饰记号，具体处理依师授）")));
        parts.push(ExplainPart {
            label: label.into(),
            text,
        });
    }

    // 右手
    if let Some(action) = state.right_action.as_deref() {
        parts.push(ExplainPart {
            label: "右手".into(),
            text: describe_right_action(action),
        });
    }

    // 弦序：带上这根弦在当前定弦下的空弦音，换过调式的人一眼能对上
    if let Some(s) = state.string_number.as_deref() {
        let (tuning_name, note_names) = tuning_display(ctx.tuning);
        let pitch_text = string_index(s)
            .and_then(|idx| note_names.get((idx - 1) as usize))
            .map(|n| format!("{n} · {tuning_name}"));
        let detail: Vec<String> = [pitch_text, string_note(s).map(str::to_string)]
            .into_iter()
            .flatten()
            .collect();
        let text = if detail.is_empty() {
            format!("{s}弦")
        } else {
            format!("{s}弦（{}）", detail.join("，"))
        };
        parts.push(ExplainPart {
            label: "弦序".into(),
            text,
        });
    }

    // 谱面结构记号：独立于减字四宫格，挂在音符上的谱面层标记（气口/反复/入拍）。
    // 不参与「减字是否完整」的判定——带少息的勾四照样是可弹的整字。
    if let Some(mark) = state.structure_mark.as_deref() {
        let (label, text) = structure_mark_explain(mark)
            .map(|(l, t)| (l, t.to_string()))
            .unwrap_or(("结构记号", format!("{mark}（谱面记号）")));
        parts.push(ExplainPart {
            label: label.into(),
            text,
        });
    }

    // 音高（散/按/泛都能推，按当前定弦与基准音）
    let query = PitchQuery {
        string_number: state
            .string_number
            .as_deref()
            .and_then(string_index)
            .unwrap_or(0),
        tone_type: match tone {
            Some("散") => ToneType::散,
            Some("泛") => ToneType::泛,
            _ => ToneType::按,
        },
        hui: state.hui.as_deref().and_then(hui_from_chinese),
        fen_fraction: state.fen.as_deref().map(fen_fraction),
    };
    let pitch_hint = pitch::query_to_jianpu(&query, ctx).map(|name| {
        let oct = octave_text(&name.octave);
        let (tuning_name, _) = tuning_display(ctx.tuning);
        if oct.is_empty() {
            format!("简谱 {} · {tuning_name}推定", name.number)
        } else {
            format!("简谱 {}（{oct}）· {tuning_name}推定", name.number)
        }
    });

    // 一句话读法
    let mut summary = String::new();
    if complete
        && let (Some(t), Some(action), Some(s)) = (
            tone,
            state.right_action.as_deref(),
            state.string_number.as_deref(),
        )
    {
        let action_name = right_action(action)
            .map(|a| format!("{}{}", a.finger, a.name))
            .unwrap_or_else(|| action.to_string());
        if t == "散" {
            summary = format!("散音 · 右手{action_name}{s}弦，左手不按弦");
        } else {
            let finger = state
                .left_finger
                .as_deref()
                .map(|f| {
                    left_finger(f)
                        .map(|(name, _)| name.to_string())
                        .unwrap_or_else(|| f.to_string())
                })
                .unwrap_or_default();
            let pos_short = state
                .hui
                .as_deref()
                .and_then(|h| describe_hui_position(h, state.fen.as_deref()))
                // 「七徽六分 · 七徽与八徽之间…」只取第一段
                .map(|p| p.split(" · ").next().unwrap_or("").to_string())
                .unwrap_or_default();
            let verb = if t == "泛" { "轻触" } else { "按于" };
            // 走手音跟在音位后面读才顺：「按于四弦七徽六分（绰）」
            let slide_text = state
                .slide
                .as_deref()
                .map(|s| format!("（{s}）"))
                .unwrap_or_default();
            let tone_name = if t == "泛" { "泛音" } else { "按音" };
            summary = format!(
                "{tone_name} · 左手{finger}{verb}{s}弦{pos_short}{slide_text}，右手{action_name}"
            );
        }
    }

    Explanation {
        complete,
        summary,
        parts,
        pitch_hint,
        missing: missing.into_iter().map(str::to_string).collect(),
    }
}

/// 候选音位的短标签：谱字旁边两行小字 + 读屏用的完整描述。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShortCaption {
    /// 第一行：弦 + 音位，如「五弦 · 十徽」「一弦 · 散」
    pub primary: String,
    /// 第二行：指法，如「大指按 · 中指勾」
    pub secondary: String,
    /// 读屏/无障碍名：一句话说清这个音怎么弹
    pub full: String,
}

/// 徽位 + 分位 → 极简写法（七徽六分 → 七徽六；十三徽半 → 十三徽半）。
fn short_hui(hui: Option<&str>, fen: Option<&str>) -> String {
    let Some(hui) = hui else {
        return String::new();
    };
    let fen_text = match fen {
        Some("半") => "半".to_string(),
        Some(f) => f.trim_end_matches('分').to_string(),
        None => String::new(),
    };
    format!("{hui}徽{fen_text}")
}

/// 候选音位的短标签。
///
/// 候选列表里一个音可能有十几个位置，名字太长就扫不动：第一行只留
/// 「几弦 · 几徽」，第二行只留「谁按、谁弹」，完整读法留给 title / 读屏。
pub fn short_caption(state: &JianziInput) -> ShortCaption {
    let string_text = state
        .string_number
        .as_deref()
        .map(|s| format!("{s}弦"))
        .unwrap_or_default();
    let action_text = state
        .right_action
        .as_deref()
        .map(|a| match right_action(a) {
            Some(act) => format!("{}{}", act.finger, act.name),
            None => a.to_string(),
        })
        .unwrap_or_default();

    // 短标签里的指法名不带「即无名指」这类补充——一行只有六七十像素
    let finger_text: String = match state.left_finger.as_deref() {
        Some(f) => left_finger(f)
            .map(|(name, _)| name.to_string())
            .unwrap_or_else(|| f.to_string()),
        None => String::new(),
    };

    if state.tone_type.as_deref() == Some("散") {
        let primary = join_nonempty(&[string_text.clone(), "散".to_string()], " · ");
        let full = format!(
            "散音，{}，右手{}",
            if string_text.is_empty() {
                "未定弦"
            } else {
                &string_text
            },
            if action_text.is_empty() {
                "未定指法"
            } else {
                &action_text
            }
        );
        return ShortCaption {
            primary,
            secondary: action_text,
            full,
        };
    }

    let pos = short_hui(state.hui.as_deref(), state.fen.as_deref());
    let is_fan = state.tone_type.as_deref() == Some("泛");
    let touch = if is_fan { "轻触" } else { "按" };
    // 卡片一行只有六七十像素：短标签用单字「泛 / 按」，完整读法里再写「轻触」
    let touch_short = if is_fan { "泛" } else { "按" };
    let primary = join_nonempty(&[string_text.clone(), pos.clone()], " · ");
    // 第二行只留「谁按 · 谁弹」：左右手由按/弹本身就能读出来，
    // 再写「右手」反而把这一行撑满，卡片宽了反而扫不动。
    let finger_part = if finger_text.is_empty() {
        String::new()
    } else {
        format!("{finger_text}{touch_short}")
    };
    let secondary = join_nonempty(&[finger_part, action_text.clone()], " · ");
    let full = format!(
        "{}音，{}{}{}{}，右手{}",
        state.tone_type.as_deref().unwrap_or(""),
        if finger_text.is_empty() {
            "未定手指"
        } else {
            &finger_text
        },
        touch,
        string_text,
        pos,
        if action_text.is_empty() {
            "未定指法"
        } else {
            &action_text
        }
    );
    ShortCaption {
        primary,
        secondary,
        full,
    }
}

/// 用分隔符连接非空片段。
fn join_nonempty(parts: &[String], sep: &str) -> String {
    parts
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join(sep)
}

// ──────────────────────────────────────────────
// JSON 桥接
// ──────────────────────────────────────────────

/// 输入：`{"state":{...},"tuning":"zhengdiao","concertPitch":440}`
/// 输出：`Explanation` 的 JSON。
pub fn explain_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        state: JianziInput,
        #[serde(default)]
        tuning: Option<String>,
        #[serde(rename = "concertPitch", default)]
        concert_pitch: Option<f64>,
    }

    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let tuning = match req.tuning.as_deref() {
        Some(s) => pitch::parse_tuning(s).ok_or_else(|| format!("未知定弦：{s}"))?,
        None => crate::jianpu::Tuning::ZhengDiao,
    };
    let ctx = PitchContext {
        tuning,
        concert_pitch: req.concert_pitch.unwrap_or(pitch::CONCERT_PITCH_DEFAULT),
    };
    serde_json::to_string(&explain(&req.state, ctx)).map_err(|e| e.to_string())
}

/// 徽位 + 分位 → 位置描述。不传 `fen` 时按整徽描述。
///
/// 输入：`{"hui":"七","fen":"六分"}` 或 `{"hui":"七"}`
/// 输出：`"七徽六分 · 七徽与八徽之间，过七徽 6 成"`
pub fn describe_hui_position_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        #[serde(default)]
        hui: Option<String>,
        #[serde(default)]
        fen: Option<String>,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    match req.hui.as_deref() {
        Some(hui) => Ok(describe_hui_position(hui, req.fen.as_deref()).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

/// 结构记号清单与释义：`{"少息":{"label":"结构记号","text":"…"},…}`
pub fn structure_marks_json() -> Result<String, String> {
    let mut map = serde_json::Map::new();
    for mark in ["少息", "大息", "再作", "从头再作", "入拍"] {
        if let Some((label, text)) = structure_mark_explain(mark) {
            map.insert(
                mark.to_string(),
                serde_json::json!({ "label": label, "text": text }),
            );
        }
    }
    serde_json::to_string(&map).map_err(|e| e.to_string())
}

/// 输入：`{"state":{...}}` → `ShortCaption` 的 JSON。
pub fn short_caption_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        state: JianziInput,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    serde_json::to_string(&short_caption(&req.state)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> PitchContext {
        PitchContext::default()
    }

    fn state(tone: &str) -> JianziInput {
        JianziInput {
            tone_type: Some(tone.into()),
            ..Default::default()
        }
    }

    /// 大九勾四：按音的标准形态。
    fn da_jiu_gou_si() -> JianziInput {
        JianziInput {
            tone_type: Some("按".into()),
            left_finger: Some("大".into()),
            hui: Some("九".into()),
            fen: None,
            slide: None,
            right_action: Some("勹".into()),
            string_number: Some("四".into()),
            structure_mark: None,
        }
    }

    #[test]
    fn reads_fingers_and_action() {
        let e = explain(&da_jiu_gou_si(), ctx());
        assert!(e.complete);
        let labels: Vec<&str> = e.parts.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, ["音色", "左手", "徽位", "右手", "弦序"]);
        assert_eq!(e.parts[1].text, "大指（拇指）");
        assert!(e.parts[3].text.contains("中指勾"));
        assert!(e.parts[3].text.contains("朝自己一侧拨弦"));
    }

    #[test]
    fn summary_reads_like_a_sentence() {
        let e = explain(&da_jiu_gou_si(), ctx());
        assert_eq!(e.summary, "按音 · 左手大指按于四弦九徽，右手中指勾");
    }

    #[test]
    fn partial_and_full_glyph_agree() {
        // 「夕」= 名指，与「名」同一读法
        let mut a = da_jiu_gou_si();
        a.left_finger = Some("夕".into());
        let mut b = da_jiu_gou_si();
        b.left_finger = Some("名".into());
        assert_eq!(
            explain(&a, ctx()).parts[1].text,
            explain(&b, ctx()).parts[1].text
        );
    }

    #[test]
    fn composite_action_explains_instead_of_direction() {
        let mut s = da_jiu_gou_si();
        s.right_action = Some("抹挑".into());
        let text = explain(&s, ctx()).parts[3].text.clone();
        assert!(text.contains("先抹后挑"));
        assert!(!text.contains("拨弦"), "复合指法不该只说方向");
    }

    #[test]
    fn unknown_action_falls_back_to_raw() {
        let mut s = da_jiu_gou_si();
        s.right_action = Some("某指法".into());
        assert_eq!(explain(&s, ctx()).parts[3].text, "某指法");
    }

    #[test]
    fn hui_without_fen_gives_ratio_note() {
        let mut s = da_jiu_gou_si();
        s.hui = Some("七".into());
        let text = &explain(&s, ctx()).parts[2].text;
        assert!(text.contains("弦的正中（1/2 处）"), "{text}");
    }

    #[test]
    fn hui_with_fen_describes_interval() {
        let mut s = da_jiu_gou_si();
        s.hui = Some("七".into());
        s.fen = Some("六分".into());
        let text = &explain(&s, ctx()).parts[2].text;
        assert!(text.contains("七徽与八徽之间"), "{text}");
        assert!(text.contains("过七徽 6 成"), "{text}");
    }

    #[test]
    fn two_char_hui_does_not_borrow_fourteen() {
        // 十三徽的分位不能写成「十三徽与十四徽之间」
        let mut s = da_jiu_gou_si();
        s.hui = Some("十三".into());
        s.fen = Some("三分".into());
        let text = &explain(&s, ctx()).parts[2].text;
        assert!(!text.contains("十四徽"), "{text}");
        assert!(text.contains("再往龙龈方向 3 成"), "{text}");
    }

    #[test]
    fn half_position_is_midway() {
        let mut s = da_jiu_gou_si();
        s.hui = Some("七".into());
        s.fen = Some("半".into());
        let text = &explain(&s, ctx()).parts[2].text;
        assert!(text.contains("七徽与八徽的正中"), "{text}");
    }

    #[test]
    fn san_yin_needs_no_left_hand_or_hui() {
        let s = JianziInput {
            tone_type: Some("散".into()),
            right_action: Some("勹".into()),
            string_number: Some("三".into()),
            ..Default::default()
        };
        let e = explain(&s, ctx());
        assert!(e.complete);
        assert_eq!(e.parts[0].text, "散音（左手不按弦，取空弦）");
        assert_eq!(e.summary, "散音 · 右手中指勾三弦，左手不按弦");
        // 没有左手与徽位两项
        assert!(
            e.parts
                .iter()
                .all(|p| p.label != "左手" && p.label != "徽位")
        );
    }

    #[test]
    fn fan_yin_says_light_touch() {
        let mut s = da_jiu_gou_si();
        s.tone_type = Some("泛".into());
        let e = explain(&s, ctx());
        assert_eq!(e.parts[0].text, "泛音（左手轻触徽位，虚按不实）");
        assert!(e.summary.contains("轻触"), "{}", e.summary);
    }

    #[test]
    fn incomplete_lists_missing_slots() {
        let e = explain(&state("按"), ctx());
        assert!(!e.complete);
        assert_eq!(e.summary, "");
        assert_eq!(e.missing, ["左手指法", "徽位", "右手指法", "弦序"]);
    }

    #[test]
    fn each_slide_mark_is_registered() {
        // 21 个装饰记号必须逐个登记，漏一个就会被读成兜底文案
        for mark in [
            "绰", "注", "急", "吟", "猱", "绰吟", "绰猱", "注吟", "注猱", "细吟", "细猱", "游吟",
            "游猱", "荡吟", "荡猱", "飞吟", "飞猱", "圆吟", "圆猱", "定吟", "定猱",
        ] {
            assert!(slide_explain(mark).is_some(), "{mark} 未登记");
        }
    }

    #[test]
    fn ji_is_a_technique_not_a_slide() {
        let mut s = da_jiu_gou_si();
        s.slide = Some("急".into());
        let part = explain(&s, ctx())
            .parts
            .into_iter()
            .find(|p| p.label == "弹法")
            .expect("急 应单列弹法");
        assert!(part.text.contains("音高不变"));
    }

    #[test]
    fn slide_hidden_for_san_and_fan() {
        // 散音与泛音不显示走手音
        for tone in ["散", "泛"] {
            let mut s = da_jiu_gou_si();
            s.tone_type = Some(tone.into());
            s.slide = Some("绰".into());
            let labels: Vec<String> = explain(&s, ctx())
                .parts
                .into_iter()
                .map(|p| p.label)
                .collect();
            assert!(
                !labels.iter().any(|l| l.contains("走手音")),
                "{tone} 不该有走手音"
            );
        }
    }

    #[test]
    fn string_note_marks_outer_strings() {
        let mut s = da_jiu_gou_si();
        s.string_number = Some("一".into());
        assert!(explain(&s, ctx()).parts[4].text.contains("最粗、最低"));
        s.string_number = Some("七".into());
        assert!(explain(&s, ctx()).parts[4].text.contains("最细、最高"));
        // 中间弦不加这条
        let mut mid = da_jiu_gou_si();
        mid.string_number = Some("四".into());
        let text = &explain(&mid, ctx()).parts[4].text;
        assert!(!text.contains("最粗") && !text.contains("最细"), "{text}");
    }

    #[test]
    fn string_carries_open_note_and_tuning() {
        let e = explain(&da_jiu_gou_si(), ctx());
        // 正调四弦 G2
        assert!(e.parts[4].text.contains("G2 · 正调"), "{}", e.parts[4].text);
    }

    #[test]
    fn tuning_change_updates_note_name() {
        let ctx_mj = PitchContext {
            tuning: crate::jianpu::Tuning::ManJiao,
            ..ctx()
        };
        let mut s = da_jiu_gou_si();
        s.string_number = Some("三".into());
        let text = &explain(&s, ctx_mj).parts[4].text;
        assert!(text.contains("E2 · 慢角调"), "{text}");
    }

    #[test]
    fn structure_marks_are_listed_separately() {
        for (mark, keyword) in [
            ("少息", "短气口"),
            ("大息", "长气口"),
            ("再作", "重复记号"),
            ("从头再作", "反复记号"),
            ("入拍", "严格节拍"),
        ] {
            let mut s = da_jiu_gou_si();
            s.structure_mark = Some(mark.into());
            let part = explain(&s, ctx())
                .parts
                .into_iter()
                .find(|p| p.label == "结构记号")
                .unwrap_or_else(|| panic!("{mark} 应有结构记号项"));
            assert!(part.text.contains(keyword), "{mark}: {}", part.text);
        }
    }

    #[test]
    fn structure_mark_does_not_affect_completeness() {
        let mut s = da_jiu_gou_si();
        s.structure_mark = Some("少息".into());
        assert!(explain(&s, ctx()).complete, "带少息的勾四仍是完整减字");
    }

    #[test]
    fn pitch_hint_present_for_complete_glyph() {
        let e = explain(&da_jiu_gou_si(), ctx());
        let hint = e.pitch_hint.expect("应给出音高");
        assert!(hint.starts_with("简谱 "), "{hint}");
        assert!(hint.contains("正调推定"), "{hint}");
    }

    #[test]
    fn pitch_hint_absent_when_uncomputable() {
        // 只有左手、没有弦序 → 推不出音高
        let s = JianziInput {
            tone_type: Some("按".into()),
            left_finger: Some("大".into()),
            hui: Some("九".into()),
            ..Default::default()
        };
        assert!(explain(&s, ctx()).pitch_hint.is_none());
    }

    #[test]
    fn short_caption_for_san_yin() {
        let s = JianziInput {
            tone_type: Some("散".into()),
            right_action: Some("勹".into()),
            string_number: Some("一".into()),
            ..Default::default()
        };
        let c = short_caption(&s);
        assert_eq!(c.primary, "一弦 · 散");
        assert_eq!(c.secondary, "中指勾");
        assert!(c.full.contains("散音"), "{}", c.full);
    }

    #[test]
    fn short_caption_for_an_yin() {
        let c = short_caption(&da_jiu_gou_si());
        assert_eq!(c.primary, "四弦 · 九徽");
        assert_eq!(c.secondary, "大指按 · 中指勾");
        assert!(c.full.contains("大指按"), "{}", c.full);
    }

    #[test]
    fn short_caption_for_fan_yin_uses_light_touch_in_full_only() {
        let mut s = da_jiu_gou_si();
        s.tone_type = Some("泛".into());
        let c = short_caption(&s);
        // 短标签用单字「泛」，完整读法才写「轻触」
        assert!(c.secondary.contains("大指泛"), "{}", c.secondary);
        assert!(c.full.contains("轻触"), "{}", c.full);
    }

    #[test]
    fn short_caption_fen_drops_trailing_char() {
        let mut s = da_jiu_gou_si();
        s.fen = Some("六分".into());
        assert_eq!(short_caption(&s).primary, "四弦 · 九徽六");
        // 半位保留「半」字
        let mut half = da_jiu_gou_si();
        half.fen = Some("半".into());
        assert_eq!(short_caption(&half).primary, "四弦 · 九徽半");
    }

    #[test]
    fn hui_position_json_bridge() {
        assert_eq!(
            describe_hui_position_json(r#"{"hui":"七","fen":"六分"}"#).unwrap(),
            "七徽六分 · 七徽与八徽之间，过七徽 6 成"
        );
        assert_eq!(
            describe_hui_position_json(r#"{"hui":"七"}"#).unwrap(),
            "七徽 · 弦的正中（1/2 处）"
        );
        assert_eq!(describe_hui_position_json(r#"{}"#).unwrap(), "");
    }

    #[test]
    fn structure_marks_json_lists_all_five() {
        let v: serde_json::Value = serde_json::from_str(&structure_marks_json().unwrap()).unwrap();
        for mark in ["少息", "大息", "再作", "从头再作", "入拍"] {
            assert_eq!(v[mark]["label"], serde_json::json!("结构记号"), "{mark}");
        }
    }

    #[test]
    fn short_caption_json_bridge() {
        let out = short_caption_json(
            r#"{"state":{"toneType":"散","rightAction":"勹","stringNumber":"一"}}"#,
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["primary"], serde_json::json!("一弦 · 散"));
    }

    #[test]
    fn json_bridge_round_trips() {
        let out = explain_json(
            r#"{"state":{"toneType":"散","rightAction":"勹","stringNumber":"三"},"tuning":"zhengdiao"}"#,
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["complete"], serde_json::json!(true));
        assert_eq!(
            v["summary"],
            serde_json::json!("散音 · 右手中指勾三弦，左手不按弦")
        );
        assert!(v["parts"].is_array());
        assert!(v["pitchHint"].is_string());
    }

    #[test]
    fn json_bridge_reports_bad_tuning() {
        let err = explain_json(r#"{"state":{},"tuning":"bogus"}"#).unwrap_err();
        assert!(err.contains("未知定弦"), "{err}");
    }
}
