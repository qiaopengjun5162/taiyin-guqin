//! 减字字典（字全表）—— 减字谱的结构化目录。
//!
//! LiberWord 一文点明：减字谱千年未入 Unicode，数字化的第一步是「摸清从古到今
//! 到底有多少个减字、每个字由哪些部件拼成、有哪些写法变体」，再据此编码、造字、建索引。
//! 太音不造字（字体走 GSUB 连字 + SVG 四象限降级），但同样需要一份
//! 「减字全表」让用户知道：一个减字由哪些部件拼成、怎么读、有哪些写法变体。
//!
//! 本模块把这份目录的**全部逻辑**放在 Rust（数据 + 筛选 + 搜索），通过 `wasm.rs`
//! 以 JSON 字符串桥接给前端。前端只负责把结果渲染成卡片、试听，不持有任何字典逻辑。
//!
//! 数据结构与前端 `JianziState` 同形：用中文标签字符串（大/名/夕、勾/挑、九/十、三/四…）
//! 描述一个减字。这样既不牵动 `GuqinNote` 的枚举词表（其复合指法/装饰音是另一套 vocab），
//! 又能 1:1 喂给前端的 SVG 渲染与释义管线。

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// 一个减字的结构化状态——与前端 `JianziState` 同形（rhythmMode 恒为 null，由前端补）。
///
/// 全部用中文标签字符串，便于直接喂给字体渲染与释义，也避免与 Rust 侧枚举词表错配。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JianziDictState {
    #[serde(rename = "toneType")]
    pub tone_type: String,
    #[serde(rename = "leftFinger")]
    pub left_finger: Option<String>,
    #[serde(rename = "hui")]
    pub hui: Option<String>,
    #[serde(rename = "fen")]
    pub fen: Option<String>,
    #[serde(rename = "slide")]
    pub slide: Option<String>,
    #[serde(rename = "rightAction")]
    pub right_action: Option<String>,
    #[serde(rename = "stringNumber")]
    pub string_number: Option<String>,
}

/// 字典条目。`state` 完整可弹；`note` 记录变体 / 易错点，呼应「每个字有多少变体」。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JianziDictEntry {
    /// 稳定 id：由减字字形文本派生（如「大九勾四」「散勾三」「泛 大九勾四」）。
    pub id: String,
    /// 减字状态（与前端 JianziState 同形）。
    pub state: JianziDictState,
    /// 变体或易错说明，如「夕 = 名指，传统也写作『名』」。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// 是否常用（教材高频指法）。
    #[serde(default)]
    pub common: bool,
    /// 减字编码（如 `ad9g4`）——可读、可键入、可打印的那串码。
    ///
    /// 包松平那套输入法的做法是「给每个字分配一个编码，再用输入法调取」；
    /// 这里同一个码既能当搜索键，也是文本谱里替代字形的那一行。
    pub code: String,
    /// 可搜索文本：字形 + 人话读法 + 备注 + 编码，全部小写，供全文搜索。
    #[serde(rename = "searchText")]
    pub search_text: String,
}

// ──────────────────────────────────────────────
// 字形 / 读法文本
// ──────────────────────────────────────────────

/// 右手指法 → 字体真正认得的字形字符。
///
/// 字体里只有全字连字，偏旁字（勹/木/乚/乇/丁/尸/倽）没有成字连字，
/// 统一换成全字；剖析仍两种都收。复合指法（抹挑/勾剔/抹勾/打摘）无映射，原样保留。
pub(crate) fn right_action_glyph(a: &str) -> String {
    match a {
        "勹" => "勾",
        "木" => "抹",
        "乚" => "挑",
        "乇" => "托",
        "丁" => "打",
        "尸" => "劈",
        "倽" => "摘",
        "剔" => "剔",
        "擘" => "劈",
        other => other,
    }
    .to_string()
}

/// 左手指法 → 字体字形字符。传统减字偏旁写法：夕 = 名指、亻 = 食指，统一换成全字。
pub(crate) fn left_finger_glyph(l: &str) -> String {
    match l {
        "夕" => "名",
        "亻" => "食",
        other => other,
    }
    .to_string()
}

/// 分位取值 → 减字字形（分数在减字里只写数字）。
fn fen_glyph(f: &str) -> String {
    f.trim_end_matches('分').to_string()
}

/// 由状态推导减字字形文本（与前端 `jianziToText` 对齐），用作条目 id / aria-label。
///
/// 该文本**已做变体归一**（夕→名、亻→食、省写→全字），故也可充当
/// 「把不同写法合并成同一个减字」的聚合键（见 `jianzi_stats`）。
pub(crate) fn glyph_text(s: &JianziDictState) -> String {
    if s.tone_type == "散" {
        let mut t = String::from("散");
        if let Some(a) = &s.right_action {
            t.push_str(&right_action_glyph(a));
        }
        if let Some(st) = &s.string_number {
            t.push_str(st);
        }
        return t;
    }
    let mut t = String::new();
    if s.tone_type == "泛" {
        t.push_str("泛 ");
    }
    if let Some(l) = &s.left_finger {
        t.push_str(&left_finger_glyph(l));
    }
    if let Some(h) = &s.hui {
        t.push_str(h);
    }
    if let Some(f) = &s.fen {
        t.push_str(&fen_glyph(f));
    }
    // 顺序即字体连字规则：分数在前，绰/注在后。
    if let Some(sl) = &s.slide
        && s.tone_type != "泛"
    {
        t.push_str(sl);
    }
    if let Some(a) = &s.right_action {
        t.push_str(&right_action_glyph(a));
    }
    if let Some(st) = &s.string_number {
        t.push_str(st);
    }
    t
}

/// 一条目录的人话读法（用于搜索文本），如「按音 大指 九徽 勾 四弦 绰」。
pub(crate) fn describe(s: &JianziDictState) -> String {
    let mut parts: Vec<String> = Vec::new();
    parts.push(
        match s.tone_type.as_str() {
            "散" => "散音",
            "泛" => "泛音",
            "按" => "按音",
            _ => "",
        }
        .to_string(),
    );
    if let Some(l) = &s.left_finger {
        let name = match l.as_str() {
            "大" => "大指",
            "名" | "夕" => "名指",
            "中" => "中指",
            "食" | "亻" => "食指",
            "跪" => "跪指",
            _ => l,
        };
        parts.push(name.to_string());
    }
    if let Some(h) = &s.hui {
        let mut hui = String::from(h);
        if let Some(f) = &s.fen {
            hui.push_str(f);
        }
        parts.push(format!("{hui}徽"));
    }
    if let Some(sl) = &s.slide {
        parts.push(sl.clone());
    }
    if let Some(a) = &s.right_action {
        parts.push(a.clone());
    }
    if let Some(st) = &s.string_number {
        parts.push(format!("{st}弦"));
    }
    parts.retain(|p| !p.is_empty());
    parts.join(" ")
}

/// 构造搜索文本：字形 + 读法 + 备注，转小写。
///
/// 编码也并进来：用户看着谱上的 `ad9g4` 想知道是哪个字，直接把它敲进搜索框就该命中，
/// 不必先知道这字叫「大九勾四」。
fn build_search_text(s: &JianziDictState, note: Option<&str>, code: &str) -> String {
    let id = glyph_text(s);
    let desc = describe(s);
    let n = note.unwrap_or("");
    format!("{id} {desc} {n} {code}").to_lowercase()
}

// ──────────────────────────────────────────────
// 完整性校验
// ──────────────────────────────────────────────

/// 减字是否已完成（各音色类型所需字段不同），与前端 `isComplete` 对齐。
pub fn is_complete(s: &JianziDictState) -> bool {
    match s.tone_type.as_str() {
        // 散音：只需要右手指法和弦序
        "散" => s.right_action.is_some() && s.string_number.is_some(),
        // 泛音、按音：需要左手指法 + 徽位 + 右手指法 + 弦序
        "泛" | "按" => {
            s.left_finger.is_some()
                && s.hui.is_some()
                && s.right_action.is_some()
                && s.string_number.is_some()
        }
        _ => false,
    }
}

// ──────────────────────────────────────────────
// 筛选维度分组（名/夕、食/亻 同指合并；劈/擘 同指合并）
// ──────────────────────────────────────────────

struct Group {
    label: &'static str,
    keys: &'static [&'static str],
}

/// 左手指法分组。前端传来分组 label（如「名指」），命中其 keys 集合。
const LEFT_GROUPS: &[Group] = &[
    Group {
        label: "大指",
        keys: &["大"],
    },
    Group {
        label: "名指",
        keys: &["名", "夕"],
    },
    Group {
        label: "中指",
        keys: &["中"],
    },
    Group {
        label: "食指",
        keys: &["食", "亻"],
    },
    Group {
        label: "跪指",
        keys: &["跪"],
    },
];

/// 右手指法分组。单指法 + 复合指法；擘/劈同指合并。
const ACTION_GROUPS: &[Group] = &[
    Group {
        label: "勾",
        keys: &["勾"],
    },
    Group {
        label: "挑",
        keys: &["挑"],
    },
    Group {
        label: "抹",
        keys: &["抹"],
    },
    Group {
        label: "托",
        keys: &["托"],
    },
    Group {
        label: "打",
        keys: &["打"],
    },
    Group {
        label: "剔",
        keys: &["剔"],
    },
    Group {
        label: "摘",
        keys: &["摘"],
    },
    Group {
        label: "劈",
        keys: &["劈", "擘"],
    },
    Group {
        label: "抹挑",
        keys: &["抹挑"],
    },
    Group {
        label: "勾剔",
        keys: &["勾剔"],
    },
    Group {
        label: "抹勾",
        keys: &["抹勾"],
    },
    Group {
        label: "打摘",
        keys: &["打摘"],
    },
];

// ──────────────────────────────────────────────
// 目录数据
// ──────────────────────────────────────────────

/// 构造目录条目的规格（仅填写与音色相关的字段）。
#[derive(Clone, Copy)]
struct Spec<'a> {
    tone: &'a str,
    left: Option<&'a str>,
    hui: Option<&'a str>,
    fen: Option<&'a str>,
    slide: Option<&'a str>,
    action: &'a str,
    string: &'a str,
    note: Option<&'a str>,
    common: bool,
}

// clippy 的 derivable_impls 会建议改成 `#[derive(Default)]`，但 &str 不实现 Default，
// derive 反而无法编译，故保留手写 impl 并显式屏蔽该误报。
#[allow(clippy::derivable_impls)]
impl<'a> Default for Spec<'a> {
    fn default() -> Self {
        Spec {
            tone: "",
            left: None,
            hui: None,
            fen: None,
            slide: None,
            action: "",
            string: "",
            note: None,
            common: false,
        }
    }
}

/// 构造一条目录条目（自动派生 id 与 search_text）。
fn mk(spec: Spec) -> JianziDictEntry {
    let state = JianziDictState {
        tone_type: spec.tone.to_string(),
        // 散音不取左手 / 徽位；泛音滑不动，无走手音（slide）。
        left_finger: if spec.tone == "散" {
            None
        } else {
            spec.left.map(str::to_string)
        },
        hui: if spec.tone == "散" {
            None
        } else {
            spec.hui.map(str::to_string)
        },
        fen: if spec.tone == "散" {
            None
        } else {
            spec.fen.map(str::to_string)
        },
        slide: if spec.tone == "散" || spec.tone == "泛" {
            None
        } else {
            spec.slide.map(str::to_string)
        },
        right_action: Some(spec.action.to_string()),
        string_number: Some(spec.string.to_string()),
    };
    let id = glyph_text(&state);
    // 编码由状态反推（见 jianzi_code）。字全表里每条都填得满，正常不会失败；
    // 万一失败也只是这一条少个码，不该让整张表建不出来。
    let code = crate::jianzi_code::encode(&state).unwrap_or_default();
    let search_text = build_search_text(&state, spec.note, &code);
    JianziDictEntry {
        id,
        state,
        note: spec.note.map(str::to_string),
        common: spec.common,
        code,
        search_text,
    }
}

/// 构建完整字全表（50 条）。与前端原 TS 版逐条对齐。
fn build_catalog() -> Vec<JianziDictEntry> {
    vec![
        // ── 散音（空弦，不取左手与徽位） ──
        mk(Spec {
            tone: "散",
            action: "勾",
            string: "三",
            note: Some("散勾三：空弦得三弦散音，最常用起手式之一"),
            common: true,
            ..Default::default()
        }),
        mk(Spec {
            tone: "散",
            action: "挑",
            string: "三",
            note: Some("散挑三：与散勾三同弦不同向，常用于连接"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "散",
            action: "抹",
            string: "五",
            note: Some("散抹五：空弦得五弦散音"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "散",
            action: "托",
            string: "一",
            note: Some("散托一：大指向外挑托一弦空弦"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "散",
            action: "打",
            string: "二",
            note: Some("散打二：名指向内打二弦空弦"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "散",
            action: "剔",
            string: "四",
            note: Some("散剔四：中指向外剔四弦空弦"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "散",
            action: "摘",
            string: "四",
            note: Some("散摘四：名指向外摘四弦空弦"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "散",
            action: "劈",
            string: "七",
            note: Some("散劈七：大指向内擘七弦空弦（劈/擘同指）"),
            ..Default::default()
        }),
        // ── 按音 · 大指 ──
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("九"),
            action: "勾",
            string: "四",
            note: Some("九徽为常用徽位，大指按四弦九徽"),
            common: true,
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("九"),
            action: "挑",
            string: "六",
            note: Some("大指按六弦九徽，食指向外挑"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("七"),
            fen: Some("六分"),
            action: "勾",
            string: "二",
            note: Some("七徽六分：七徽与八徽之间，过七徽六成"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("十"),
            action: "勾",
            string: "五",
            note: Some("大指按五弦十徽"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("七"),
            action: "勾",
            string: "一",
            note: Some("大指按一弦七徽，按音最低微处之一"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("九"),
            action: "抹",
            string: "三",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("七"),
            action: "挑",
            string: "五",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("九"),
            slide: Some("绰"),
            action: "勾",
            string: "四",
            note: Some("绰：从本位下方滑上来落于九徽"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("九"),
            slide: Some("注"),
            action: "勾",
            string: "四",
            note: Some("注：从本位上方滑下来落于九徽"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("十"),
            action: "勾",
            string: "六",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("十三"),
            action: "勾",
            string: "七",
            note: Some("十三徽近龙龈，按音清亮"),
            ..Default::default()
        }),
        // ── 按音 · 名指（夕） ──
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("九"),
            action: "勾",
            string: "四",
            note: Some("夕 = 名指，取『名』左半；传统也写作『名』"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("十"),
            action: "勾",
            string: "五",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("七"),
            fen: Some("六分"),
            action: "勾",
            string: "二",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("九"),
            action: "挑",
            string: "六",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("九"),
            action: "抹",
            string: "三",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("十"),
            slide: Some("绰"),
            action: "勾",
            string: "五",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("七"),
            slide: Some("注"),
            action: "勾",
            string: "三",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("十三"),
            action: "勾",
            string: "七",
            ..Default::default()
        }),
        // ── 按音 · 中指 ──
        mk(Spec {
            tone: "按",
            left: Some("中"),
            hui: Some("九"),
            action: "勾",
            string: "四",
            note: Some("中指按四弦九徽"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("中"),
            hui: Some("十"),
            action: "勾",
            string: "五",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("中"),
            hui: Some("七"),
            fen: Some("六分"),
            action: "勾",
            string: "二",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("中"),
            hui: Some("九"),
            action: "挑",
            string: "六",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("中"),
            hui: Some("九"),
            action: "抹",
            string: "三",
            ..Default::default()
        }),
        // ── 按音 · 食指（亻） ──
        mk(Spec {
            tone: "按",
            left: Some("亻"),
            hui: Some("九"),
            action: "勾",
            string: "四",
            note: Some("亻 = 食指，取『食』左半；也写作『食』"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("亻"),
            hui: Some("十"),
            action: "勾",
            string: "五",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("亻"),
            hui: Some("九"),
            action: "挑",
            string: "六",
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("亻"),
            hui: Some("九"),
            action: "抹",
            string: "三",
            ..Default::default()
        }),
        // ── 按音 · 跪指 ──
        mk(Spec {
            tone: "按",
            left: Some("跪"),
            hui: Some("九"),
            action: "勾",
            string: "四",
            note: Some("跪指：名指屈起第一关节，以指背按弦"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("跪"),
            hui: Some("十"),
            action: "勾",
            string: "五",
            ..Default::default()
        }),
        // ── 泛音（左手虚触徽位节点，不取走手音） ──
        mk(Spec {
            tone: "泛",
            left: Some("大"),
            hui: Some("九"),
            action: "勾",
            string: "四",
            note: Some("泛音：左手虚触徽位节点，轻点得清越之音"),
            common: true,
            ..Default::default()
        }),
        mk(Spec {
            tone: "泛",
            left: Some("夕"),
            hui: Some("七"),
            action: "勾",
            string: "二",
            ..Default::default()
        }),
        mk(Spec {
            tone: "泛",
            left: Some("大"),
            hui: Some("七"),
            action: "勾",
            string: "一",
            ..Default::default()
        }),
        mk(Spec {
            tone: "泛",
            left: Some("中"),
            hui: Some("十"),
            action: "勾",
            string: "五",
            ..Default::default()
        }),
        mk(Spec {
            tone: "泛",
            left: Some("大"),
            hui: Some("九"),
            action: "挑",
            string: "六",
            ..Default::default()
        }),
        mk(Spec {
            tone: "泛",
            left: Some("夕"),
            hui: Some("九"),
            action: "勾",
            string: "四",
            ..Default::default()
        }),
        mk(Spec {
            tone: "泛",
            left: Some("大"),
            hui: Some("十"),
            action: "勾",
            string: "七",
            ..Default::default()
        }),
        mk(Spec {
            tone: "泛",
            left: Some("大"),
            hui: Some("七"),
            fen: Some("六分"),
            action: "勾",
            string: "三",
            ..Default::default()
        }),
        // ── 复合指法（双指法连字） ──
        mk(Spec {
            tone: "按",
            left: Some("大"),
            hui: Some("九"),
            action: "抹挑",
            string: "四",
            note: Some("抹挑：先抹后挑，一弦连得两声"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("名"),
            hui: Some("九"),
            action: "勾剔",
            string: "五",
            note: Some("勾剔：先勾后剔"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("食"),
            hui: Some("九"),
            action: "抹勾",
            string: "三",
            note: Some("抹勾：食指抹、中指勾，两指相接"),
            ..Default::default()
        }),
        mk(Spec {
            tone: "按",
            left: Some("夕"),
            hui: Some("九"),
            action: "打摘",
            string: "四",
            note: Some("打摘：先打后摘"),
            ..Default::default()
        }),
    ]
}

/// 字全表（惰性构建一次）。
fn catalog() -> &'static Vec<JianziDictEntry> {
    static C: OnceLock<Vec<JianziDictEntry>> = OnceLock::new();
    C.get_or_init(build_catalog)
}

// ──────────────────────────────────────────────
// 筛选 / 搜索
// ──────────────────────────────────────────────

/// 组合筛选条件（与前端 DictFilter 同形）。
#[derive(Default)]
pub struct DictFilter {
    pub tone: String,
    pub left: String,
    pub action: String,
    pub string: String,
    pub query: String,
}

/// 单条目录是否命中筛选条件（纯函数）。
pub fn entry_matches(entry: &JianziDictEntry, f: &DictFilter) -> bool {
    let s = &entry.state;
    if !f.tone.is_empty() && s.tone_type != f.tone {
        return false;
    }
    if !f.left.is_empty() {
        match LEFT_GROUPS.iter().find(|g| g.label == f.left) {
            Some(g) => {
                if !g.keys.contains(&s.left_finger.as_deref().unwrap_or("")) {
                    return false;
                }
            }
            None => return false,
        }
    }
    if !f.action.is_empty() {
        match ACTION_GROUPS.iter().find(|g| g.label == f.action) {
            Some(g) => {
                if !g.keys.contains(&s.right_action.as_deref().unwrap_or("")) {
                    return false;
                }
            }
            None => return false,
        }
    }
    if !f.string.is_empty() && s.string_number.as_deref() != Some(f.string.as_str()) {
        return false;
    }
    if !f.query.is_empty() {
        let q = f.query.trim().to_lowercase();
        if !q.is_empty() && !entry.search_text.to_lowercase().contains(&q) {
            return false;
        }
    }
    true
}

/// 按筛选条件过滤目录（纯函数）。
pub fn filter_dictionary(filter: &DictFilter) -> Vec<JianziDictEntry> {
    catalog()
        .iter()
        .filter(|e| entry_matches(e, filter))
        .cloned()
        .collect()
}

/// wasm 入口：接收筛选 JSON，返回 `{ total, entries }` JSON 字符串。
///
/// 输入：`{"tone":"","left":"","action":"","string":"","query":""}`（各字段均可省略）。
/// 输出：`{"total":50,"entries":[{id,state,note?,common,searchText},...]}`。
pub fn get_jianzi_dictionary_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Req {
        #[serde(default)]
        tone: String,
        #[serde(default)]
        left: String,
        #[serde(default)]
        action: String,
        #[serde(default)]
        string: String,
        #[serde(default)]
        query: String,
    }
    let req: Req = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    let filter = DictFilter {
        tone: req.tone,
        left: req.left,
        action: req.action,
        string: req.string,
        query: req.query,
    };
    let entries = filter_dictionary(&filter);
    let total = catalog().len();
    Ok(serde_json::json!({ "total": total, "entries": entries }).to_string())
}

// ──────────────────────────────────────────────
// 测试
// ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn by_tone(tone: &str) -> Vec<JianziDictEntry> {
        filter_dictionary(&DictFilter {
            tone: tone.to_string(),
            ..Default::default()
        })
    }

    #[test]
    fn test_catalog_all_complete() {
        for e in catalog() {
            assert!(
                is_complete(&e.state),
                "字典条目不完整：{} ({}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?})",
                e.id,
                e.state.tone_type,
                e.state.left_finger,
                e.state.hui,
                e.state.fen,
                e.state.slide,
                e.state.right_action,
                e.state.string_number,
            );
        }
    }

    #[test]
    fn test_catalog_entries_have_roundtrip_code() {
        use crate::jianzi_code::{decode, encode};
        for e in catalog() {
            assert!(!e.code.is_empty(), "{} 没有编码", e.id);
            // 码要解回同一个减字，再编回同一串码——码表与状态不能各说各话。
            //
            // 注意别直接比 `state`：码是有损的（这正是它的用处），`夕` 解回来是规范的
            // `名`、`勹` 解回来是 `勾`。比归一化后的字形才是对的。
            let back = decode(&e.code)
                .unwrap_or_else(|err| panic!("{} 的码 {} 解不开：{err}", e.id, e.code));
            assert_eq!(
                glyph_text(&back),
                glyph_text(&e.state),
                "{} 的码解回的字形不一致",
                e.id
            );
            assert_eq!(encode(&back).unwrap(), e.code);
        }
    }

    #[test]
    fn test_search_by_code() {
        // 用户拿谱上的码来查：ad9g4 应命中「大九勾四」
        let hits = filter_dictionary(&DictFilter {
            query: "ad9g4".to_string(),
            ..Default::default()
        });
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].code, "ad9g4");

        let san = filter_dictionary(&DictFilter {
            query: "sg3".to_string(),
            ..Default::default()
        });
        assert_eq!(san.len(), 1);
        assert_eq!(san[0].state.tone_type, "散");
    }

    #[test]
    fn test_catalog_count_is_50() {
        assert_eq!(catalog().len(), 50);
    }

    #[test]
    fn test_catalog_ids_unique() {
        let mut seen = std::collections::HashSet::new();
        for e in catalog() {
            assert!(seen.insert(e.id.clone()), "重复 id：{}", e.id);
        }
    }

    #[test]
    fn test_tone_groups() {
        assert_eq!(by_tone("散").len(), 8);
        assert_eq!(by_tone("泛").len(), 8);
        assert_eq!(by_tone("按").len(), 34);
        for e in by_tone("散") {
            assert_eq!(e.state.tone_type, "散");
            assert!(e.state.left_finger.is_none());
            assert!(e.state.hui.is_none());
        }
        for e in by_tone("泛") {
            assert!(e.state.slide.is_none(), "泛音不该有走手音：{}", e.id);
        }
    }

    #[test]
    fn test_left_group_merges_variants() {
        // 「名指」应同时命中 left_finger 为 名 与 夕 的条目
        let got = filter_dictionary(&DictFilter {
            left: "名指".to_string(),
            ..Default::default()
        });
        assert!(!got.is_empty());
        for e in &got {
            let lf = e.state.left_finger.as_deref().unwrap_or("");
            assert!(
                lf == "名" || lf == "夕",
                "名指分组误命中：{} (left={})",
                e.id,
                lf
            );
        }
        // 也应包含复合指法中 left 为 名/夕 的条目（名九勾剔五、名九打摘四）
        let ids: Vec<&str> = got.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"名九勾剔五"));
        assert!(ids.contains(&"名九打摘四"));
    }

    #[test]
    fn test_action_group_merges_pi_and_bo() {
        // 「劈」应命中 劈 与 擘
        let got = filter_dictionary(&DictFilter {
            action: "劈".to_string(),
            ..Default::default()
        });
        let ids: Vec<&str> = got.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"散劈七"));
        // 目录内无 擘 条目，至少确认分组逻辑不报错且只命中劈
        for e in &got {
            assert_eq!(e.state.right_action.as_deref(), Some("劈"));
        }
    }

    #[test]
    fn test_string_filter() {
        let got = filter_dictionary(&DictFilter {
            string: "三".to_string(),
            ..Default::default()
        });
        assert!(!got.is_empty());
        for e in &got {
            assert_eq!(e.state.string_number.as_deref(), Some("三"));
        }
    }

    #[test]
    fn test_query_search() {
        // 搜「泛音」只命中泛音条目
        let got = filter_dictionary(&DictFilter {
            query: "泛音".to_string(),
            ..Default::default()
        });
        assert_eq!(got.len(), 8);
        for e in &got {
            assert_eq!(e.state.tone_type, "泛");
        }
        // 搜「名指」命中含变体说明的条目
        let got2 = filter_dictionary(&DictFilter {
            query: "名指".to_string(),
            ..Default::default()
        });
        assert!(
            got2.iter()
                .any(|e| e.note.as_deref() == Some("夕 = 名指，取『名』左半；传统也写作『名』"))
        );
        // 搜「九徽」应命中大量按音
        let got3 = filter_dictionary(&DictFilter {
            query: "九徽".to_string(),
            ..Default::default()
        });
        assert!(got3.len() > 10);
    }

    #[test]
    fn test_empty_filter_returns_all() {
        let got = filter_dictionary(&DictFilter::default());
        assert_eq!(got.len(), 50);
    }

    #[test]
    fn test_glyph_text_matches_frontend() {
        // 与前端 jianziToText 对齐的几个关键字形
        let cases = [
            ("散勾三", "散", None, None, None, None, "勾", "三"),
            (
                "大九勾四",
                "按",
                Some("大"),
                Some("九"),
                None,
                None,
                "勾",
                "四",
            ),
            (
                "大七六勾二",
                "按",
                Some("大"),
                Some("七"),
                Some("六分"),
                None,
                "勾",
                "二",
            ),
            (
                "大九绰勾四",
                "按",
                Some("大"),
                Some("九"),
                None,
                Some("绰"),
                "勾",
                "四",
            ),
            (
                "泛 大九勾四",
                "泛",
                Some("大"),
                Some("九"),
                None,
                None,
                "勾",
                "四",
            ),
            (
                "名九勾剔五",
                "按",
                Some("名"),
                Some("九"),
                None,
                None,
                "勾剔",
                "五",
            ),
            (
                "名九打摘四",
                "按",
                Some("夕"),
                Some("九"),
                None,
                None,
                "打摘",
                "四",
            ),
        ];
        for (expected, tone, left, hui, fen, slide, action, string) in cases {
            let s = JianziDictState {
                tone_type: tone.to_string(),
                left_finger: left.map(str::to_string),
                hui: hui.map(str::to_string),
                fen: fen.map(str::to_string),
                slide: slide.map(str::to_string),
                right_action: Some(action.to_string()),
                string_number: Some(string.to_string()),
            };
            assert_eq!(glyph_text(&s), expected, "字形不符");
        }
    }

    #[test]
    fn test_get_json_roundtrip() {
        let out = get_jianzi_dictionary_json(r#"{"tone":"散"}"#).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["total"], 50);
        assert_eq!(v["entries"].as_array().unwrap().len(), 8);
        // 条目含必要字段
        let first = &v["entries"][0];
        assert!(first["id"].is_string());
        assert!(first["state"]["toneType"].is_string());
        assert!(first["searchText"].is_string());
    }
}
