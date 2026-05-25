//! # taiyin-core
//!
//! 太音 · 古琴减字谱核心数据结构与拼装逻辑。
//!
//! 这是整个太音项目的底层数据契约。减字谱被完全结构化为
//! `GuqinNote`, `GuqinScore` 等类型，支持 serde JSON 序列化，
//! 前端 WASM、后端 Axum、Python AI Agent 均以此数据格式交互。
//!
//! ## 设计原则
//!
//! - **拼装而非枚举**：减字谱由左手/右手/徽位/弦序四种构件组合而成，
//!   不预设穷举所有组合，而是通过类型系统保证有效的组合。
//! - **散音即空**：`left_finger` 和 `hui` 同时为 `None` 表示散音，
//!   无需额外枚举。
//! - **节奏显式化**：传统减字谱不记节奏，但传习平台需要，
//!   故 `duration` 字段为必填（默认 1.0，由上下文拍号解释）。

use serde::{Deserialize, Serialize};

// ──────────────────────────────────────────────
// 基础类型
// ──────────────────────────────────────────────

/// 左手手指。
///
/// 古琴按弦的五种常用手指。散音（空弦）时该字段为 `None`。
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum LeftFinger {
    /// 大指
    Da,
    /// 名指
    Ming,
    /// 中指
    Zhong,
    /// 食指
    Shi,
    /// 跪指（名指弯曲以指关节按弦）
    Gui,
}

/// 右手指法——右手八法核心。
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum RightAction {
    /// 挑：食指（或大指）向外拨弦
    Tiao,
    /// 勾：中指向内拨弦
    Gou,
    /// 抹：食指向内拨弦
    Mo,
    /// 剔：中指向外拨弦
    Ti,
    /// 托：大指向外拨弦
    Tuo,
    /// 擘：大指向内拨弦
    Bo,
    /// 打：名指向内拨弦
    Da,
    /// 摘：名指向外拨弦
    Zhai,
}

/// 左手装饰音——绰注吟猱等修饰指法。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum Ornament {
    /// 吟：在音准位置微微左右颤动（类似小提琴的揉弦）
    Yin,
    /// 猱：比吟幅度更大的颤动
    Nao,
    /// 绰：从徽位下方滑入本音（上滑音）
    Chuo,
    /// 注：从徽位上方滑入本音（下滑音）
    Zhu,
    /// 撞：迅速按滑一下立即回归本音
    Zhuang,
    /// 进：从本音上行到下一个徽位
    Jin,
    /// 退：从本音下行到上一个徽位
    Tui,
    /// 复：回到原徽位
    Fu,
    /// 抓起：左手将弦提起使其发出余音
    ZhuaQi,
    /// 带起：左手离开琴弦时带出空弦音
    DaiQi,
}

/// 徽位 + 分——按弦的位置。
///
/// 琴面镶嵌的十三个徽位标记泛音位置，
/// 按音时可在徽位之间。例如 9.6 徽 = 九徽六分。
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub struct HuiPosition {
    /// 第几徽（1..=13 的有效值，但不由类型系统强制）
    pub hui: u8,
    /// 几分（有效值通常为 0, 3, 6, 8）。`None` 表示正当徽。
    pub fen: Option<u8>,
}

/// 调式。
///
/// 古琴常用五种调式 + 自定义。目前以正调为默认。
/// 不同调式下七条弦的散音音高不同，影响简谱到减字的映射。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum Tuning {
    /// 正调（最常用，一弦到七弦为 5 6 1 2 3 5 6）
    ZhengDiao,
    /// 慢角调
    ManJiao,
    /// 蕤宾调
    RuiBin,
    /// 清商调
    QingShang,
    /// 慢宫调
    ManGong,
    /// 其他（如紧羽调、凄凉调等）
    Custom(String),
}

// ──────────────────────────────────────────────
// 音色与复合指法
// ──────────────────────────────────────────────

/// 音色类型——决定左手的触弦方式。
///
/// 古琴三种基本音色各有其独特的触弦技巧和音色特征。
#[derive(Default, Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum NoteType {
    /// 散音（空弦）。左手不按弦，弹奏空弦得声。
    /// 音色松沉旷远，是古琴最基本的音色。
    #[serde(rename = "散")]
    SanYin,
    /// 泛音。左手轻触徽位，右手同时弹弦。
    /// 音色清亮空灵，古琴泛音有"天籁"之誉。
    #[serde(rename = "泛")]
    FanYin,
    /// 按音（走手音）。左手按弦得声，是最具表现力的音色。
    /// 按音弹法在减字谱中一般不另行注明，为默认音色。
    #[default]
    #[serde(rename = "按")]
    AnYin,
}

/// 节奏模式——决定 `duration` 字段的解释方式。
///
/// 古琴减字谱传统上不标记精确节奏，其节奏信息通过指法本身、
/// 文字提示（入拍/入慢/跌宕）以及句读划分来传达。
/// 本文持"传习平台"立场，对初学者提供节拍引导，
/// 同时保留传统琴曲的自由律动。
///
/// | 模式 | 传统标记 | 解释 |
/// |------|---------|------|
/// | `Strict` | 入拍/入调 | 严格节拍，duration = 精确时值 |
/// | `Free` | 散板/入乱 | 自由节奏，duration 仅指示相对长短 |
/// | `Drop` | 跌宕 | 变换拍子，duration 近似但可浮动 |
#[derive(Default, Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum RhythmMode {
    /// 节拍模式。适用入拍、入调段落。
    /// duration 以四分音符=1.0 精确解释。
    #[default]
    #[serde(rename = "板")]
    Strict,
    /// 散板/自由节奏。适用散起、入乱段落。
    /// duration 仅表示音符之间的相对长度关系（长/短），
    /// 演奏者按自然呼吸和气口处理。
    #[serde(rename = "散")]
    Free,
    /// 跌宕/变换拍子。适用跌宕、入慢段落。
    /// duration 近似但允许弹性伸缩，在快慢交替中保持气韵流畅。
    #[serde(rename = "宕")]
    Drop,
}

/// 复合右手指法——右手八法的组合与变体。
///
/// 古琴右手指法极为丰富，基本八法（擘托抹挑勾剔打摘）
/// 可组合出多种复合指法，用于快速连奏、双音、滚拂等效果。
///
/// 每个指法都配有传统"手势"名称（如"游鱼摆尾"=泼剌、"飞龙拿云"=撮），
/// 用于教学传承。手势名称暂不纳入数据模型，属于教学元信息。
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum CompoundAction {
    /// 历：食指连挑两弦或三弦（节奏较快）
    #[serde(rename = "历")]
    Li,
    /// 蠲：同一弦上急速抹勾，连续出二声
    #[serde(rename = "蠲")]
    Juan,
    /// 轮：同一弦上急速摘剔挑，连续出三声
    #[serde(rename = "轮")]
    Lun,
    /// 半轮：与轮动作相同，但只用中指和无名指（摘剔）
    #[serde(rename = "半轮")]
    BanLun,
    /// 背锁：同一弦上剔、抹、挑依次弹出，共三声
    #[serde(rename = "背锁")]
    BeiSuo,
    /// 短锁：同一弦上先抹勾，再接背锁，共五声
    #[serde(rename = "短锁")]
    DuanSuo,
    /// 长锁：同一弦上先抹挑抹勾，再接背锁
    #[serde(rename = "长锁")]
    ChangSuo,
    /// 全扶：食中名三指各入一弦，同时弹奏出一声
    #[serde(rename = "全扶")]
    QuanFu,
    /// 拨：食中名三指相并微屈，同时斜向左方快速拨入两根弦
    #[serde(rename = "拨")]
    Bo,
    /// 剌：与"拨"方向相反，向外弹出两根弦
    #[serde(rename = "剌")]
    La,
    /// 泼剌：先拨后剌的连作，是滚拂之外的另一种扫弦方式
    #[serde(rename = "泼剌")]
    PoLa,
    /// 撮：双音弹法。小撮（隔一或两根弦）和大撮（隔三或四根弦）
    #[serde(rename = "撮")]
    Cuo,
    /// 双弹：同一弦上依次迅速弹出两音，通常是抹勾
    #[serde(rename = "双弹")]
    ShuangTan,
    /// 打圆：涉及两根弦发出七个音的复合指法
    #[serde(rename = "打圆")]
    DaYuan,
    /// 索铃：左手依次轻滑过数弦，右手同时轻挑，双手动作严格平行
    #[serde(rename = "索铃")]
    SuoLing,
    /// 滚：名指自内向外，连续摘四至七声，连成一片
    #[serde(rename = "滚")]
    Gun,
    /// 拂：食指自外向内，连续抹四至七声，连成一片
    #[serde(rename = "拂")]
    Fu,
    /// 如一：两根琴弦同时发声（和弦性质）
    #[serde(rename = "如一")]
    RuYi,
}

// ──────────────────────────────────────────────
// 核心音符结构
// ──────────────────────────────────────────────

/// 一个完整的减字谱音符——数字时代的减字。
///
/// 对应传统手写减字谱的拼装结构：
///
/// ```text
/// ┌───────┐
/// │ 音色   │  ← note_type（散/泛/按）
/// │ 左手   │  ← left_finger
/// │ 徽位   │  ← hui
/// ├───────┤
/// │ 右手   │  ← right_action / compound
/// │ 弦序   │  ← string_number
/// └───────┘
///      ↑ ornaments 在音符四角标记
///      ↑ rhythm_mode 决定 duration 解释方式（板/散/宕）
/// ```
///
/// # 节奏模式
///
/// 传统减字谱不记精确节奏，而是通过文字标记（入拍/入慢/跌宕）、
/// 指法本身（轮、打圆等）和句读（小息/大息）传递节奏信息。
/// 初学传习场景下 `duration` 可作精确节拍引导；
/// 传统琴曲场景下 `rhythm_mode = Free/Drop` 保留自由律动。
///
/// # 示例
///
/// - **大九挑七**：`left_finger = Da`, `hui = 9徽, fen = None`,
///   `right_action = 挑`, `string_number = 7`
/// - **散音勾三**：`note_type = SanYin`, `left_finger = None`,
///   `hui = None`, `right_action = 勾`, `string_number = 3`
/// - **泛音挑五**：`note_type = FanYin`, `left_finger = Da`,
///   `hui = 10徽`, `right_action = 挑`, `string_number = 5`
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct GuqinNote {
    /// 音色类型（散/泛/按）。默认按音。
    #[serde(default)]
    pub note_type: NoteType,
    /// 左手手指。`None` + `hui = None` 且 `note_type = SanYin` 为散音。
    pub left_finger: Option<LeftFinger>,
    /// 徽位位置。`None` + `left_finger = None` 且 `note_type = SanYin` 为散音。
    pub hui: Option<HuiPosition>,
    /// 右手指法（基本八法之一，必填）。
    pub right_action: RightAction,
    /// 弦序（1..=7）。
    pub string_number: u8,
    /// 复合右手指法（如历、轮、滚、拂等），非必填。
    pub compound: Option<CompoundAction>,
    /// 装饰音列表（吟猱绰注等）。按出现顺序存储。
    pub ornaments: Vec<Ornament>,
    /// 节奏模式——解释 `duration` 的方式。
    /// `Strict`(板) = 精确节拍，`Free`(散) = 自由节奏，`Drop`(宕) = 跌宕。
    #[serde(default)]
    pub rhythm_mode: RhythmMode,
    /// 时值。以四分音符为 1.0，八分音符为 0.5。
    /// 严格节拍下由曲谱的 `beat_numerator` / `beat_denominator` 解释实际含义；
    /// 散板/跌宕下仅表示相对长短。
    pub duration: f32,
}

// ──────────────────────────────────────────────
// 曲谱顶层结构
// ──────────────────────────────────────────────

/// 一首完整的古琴曲谱。
///
/// 包含元信息（曲名、作者、调式、拍号、速度）
/// 和一个有序的音符序列。
///
/// # 版本号
///
/// `version` 用于社区协作场景：每次编辑保存递增版本号，
/// 作为版权确权和历史追踪的锚点。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct GuqinScore {
    /// 曲名（如《仙翁操》《沧海一声笑》）
    pub title: String,
    /// 打谱者（改编者）名称
    pub author: String,
    /// 调试（影响简谱→减字的音高映射）
    pub tuning: Tuning,
    /// 拍号分子（每小节几拍）
    pub beat_numerator: u32,
    /// 拍号分母（以几分音符为一拍）
    pub beat_denominator: u32,
    /// 速度（Beats Per Minute）
    pub bpm: u32,
    /// 有序的音符序列——整首曲子
    pub notes: Vec<GuqinNote>,
    /// 版本号（从 1 开始，每次编辑 +1）
    pub version: u32,
}

// ──────────────────────────────────────────────
// 构造辅助
// ──────────────────────────────────────────────

impl GuqinNote {
    /// 创建一个散音（空弦音）。
    ///
    /// 散音不需要左手动作，是古琴最基本的音色。`note_type` 自动设为 `SanYin`。
    pub fn open_string(right_action: RightAction, string_number: u8) -> Self {
        Self {
            note_type: NoteType::SanYin,
            left_finger: None,
            hui: None,
            right_action,
            string_number,
            compound: None,
            ornaments: Vec::new(),
            rhythm_mode: RhythmMode::default(),
            duration: 1.0,
        }
    }

    /// 创建一个完整的按音。
    ///
    /// 按音是古琴最具表现力的音色，需要左手按弦确定音高。`note_type` 自动设为 `AnYin`。
    pub fn pressed(
        left_finger: LeftFinger,
        hui: HuiPosition,
        right_action: RightAction,
        string_number: u8,
    ) -> Self {
        Self {
            note_type: NoteType::AnYin,
            left_finger: Some(left_finger),
            hui: Some(hui),
            right_action,
            string_number,
            compound: None,
            ornaments: Vec::new(),
            rhythm_mode: RhythmMode::default(),
            duration: 1.0,
        }
    }

    /// 创建一个泛音。
    ///
    /// 泛音需要左手轻触徽位、右手同时弹弦。`note_type` 自动设为 `FanYin`。
    pub fn fan_yin(
        left_finger: LeftFinger,
        hui: HuiPosition,
        right_action: RightAction,
        string_number: u8,
    ) -> Self {
        Self {
            note_type: NoteType::FanYin,
            left_finger: Some(left_finger),
            hui: Some(hui),
            right_action,
            string_number,
            compound: None,
            ornaments: Vec::new(),
            rhythm_mode: RhythmMode::default(),
            duration: 1.0,
        }
    }

    /// 检查是否为散音。
    pub fn is_open(&self) -> bool {
        matches!(self.note_type, NoteType::SanYin)
    }

    /// 设置复合指法并返回自身（链式调用）。
    pub fn with_compound(mut self, action: CompoundAction) -> Self {
        self.compound = Some(action);
        self
    }

    /// 设置节奏模式并返回自身（链式调用）。
    pub fn with_rhythm_mode(mut self, mode: RhythmMode) -> Self {
        self.rhythm_mode = mode;
        self
    }

    /// 设置装饰音并返回自身（链式调用）。
    pub fn with_ornaments(mut self, ornaments: Vec<Ornament>) -> Self {
        self.ornaments = ornaments;
        self
    }

    /// 设置时值并返回自身（链式调用）。
    pub fn with_duration(mut self, duration: f32) -> Self {
        self.duration = duration;
        self
    }
}

impl GuqinScore {
    /// 创建一个新的空曲谱（version 从 1 开始）。
    pub fn new(title: &str, author: &str) -> Self {
        Self {
            title: title.to_string(),
            author: author.to_string(),
            tuning: Tuning::ZhengDiao,
            beat_numerator: 4,
            beat_denominator: 4,
            bpm: 80,
            notes: Vec::new(),
            version: 1,
        }
    }
}

// ──────────────────────────────────────────────
// 测试
// ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_string_note() {
        let note = GuqinNote::open_string(RightAction::Tiao, 5);
        assert!(note.is_open());
        assert_eq!(note.note_type, NoteType::SanYin);
        assert_eq!(note.string_number, 5);
        assert_eq!(note.duration, 1.0);
        assert!(note.compound.is_none());
    }

    #[test]
    fn test_pressed_note() {
        let note = GuqinNote::pressed(
            LeftFinger::Da,
            HuiPosition { hui: 9, fen: None },
            RightAction::Gou,
            1,
        );
        assert!(!note.is_open());
        assert_eq!(note.note_type, NoteType::AnYin);
        assert_eq!(note.left_finger, Some(LeftFinger::Da));
        assert_eq!(note.hui, Some(HuiPosition { hui: 9, fen: None }));
    }

    #[test]
    fn test_fan_yin_note() {
        let note = GuqinNote::fan_yin(
            LeftFinger::Da,
            HuiPosition { hui: 10, fen: None },
            RightAction::Tiao,
            5,
        );
        assert!(!note.is_open());
        assert_eq!(note.note_type, NoteType::FanYin);
        assert_eq!(note.left_finger, Some(LeftFinger::Da));
    }

    #[test]
    fn test_chain_builder() {
        let note = GuqinNote::pressed(
            LeftFinger::Da,
            HuiPosition { hui: 9, fen: None },
            RightAction::Tiao,
            7,
        )
        .with_ornaments(vec![Ornament::Yin])
        .with_compound(CompoundAction::Cuo)
        .with_duration(2.0);

        assert!(note.ornaments.contains(&Ornament::Yin));
        assert_eq!(note.compound, Some(CompoundAction::Cuo));
        assert_eq!(note.duration, 2.0);
    }

    #[test]
    fn test_serialization_roundtrip() {
        let note = GuqinNote::open_string(RightAction::Tiao, 5);
        let json = serde_json::to_string(&note).unwrap();
        let deserialized: GuqinNote = serde_json::from_str(&json).unwrap();
        assert_eq!(note, deserialized);
    }

    #[test]
    fn test_note_type_deserialize() {
        // 散音
        let json = r#"{"note_type":"散","left_finger":null,"hui":null,"right_action":"Tiao","string_number":5,"compound":null,"ornaments":[],"duration":1.0}"#;
        let note: GuqinNote = serde_json::from_str(json).unwrap();
        assert_eq!(note.note_type, NoteType::SanYin);
        assert!(note.is_open());

        // 按音
        let json = r#"{"note_type":"按","left_finger":"Da","hui":{"hui":9,"fen":null},"right_action":"Gou","string_number":1,"compound":null,"ornaments":[],"duration":1.0}"#;
        let note: GuqinNote = serde_json::from_str(json).unwrap();
        assert_eq!(note.note_type, NoteType::AnYin);

        // 泛音
        let json = r#"{"note_type":"泛","left_finger":"Da","hui":{"hui":10,"fen":null},"right_action":"Tiao","string_number":5,"compound":null,"ornaments":[],"duration":1.0}"#;
        let note: GuqinNote = serde_json::from_str(json).unwrap();
        assert_eq!(note.note_type, NoteType::FanYin);
    }

    #[test]
    fn test_compound_action_serialization() {
        let note = GuqinNote::pressed(
            LeftFinger::Da,
            HuiPosition { hui: 7, fen: None },
            RightAction::Gou,
            1,
        )
        .with_compound(CompoundAction::Gun);
        let json = serde_json::to_value(&note).unwrap();
        assert_eq!(json.get("compound").unwrap(), "滚");

        let back: GuqinNote = serde_json::from_value(json).unwrap();
        assert_eq!(back.compound, Some(CompoundAction::Gun));
    }

    #[test]
    fn test_score_serialization() {
        let score = GuqinScore {
            title: "练习曲".into(),
            author: "太音".into(),
            tuning: Tuning::ZhengDiao,
            beat_numerator: 4,
            beat_denominator: 4,
            bpm: 80,
            version: 1,
            notes: vec![
                GuqinNote::open_string(RightAction::Tiao, 5),
                GuqinNote::open_string(RightAction::Tiao, 6),
            ],
        };

        let json = serde_json::to_string_pretty(&score).unwrap();
        let back: GuqinScore = serde_json::from_str(&json).unwrap();
        assert_eq!(score, back);
        println!("{}", json);
    }

    #[test]
    fn test_no_left_hand_open_string() {
        // 测试散音在 JSON 中 left_finger 和 hui 同时为 null
        let note = GuqinNote::open_string(RightAction::Gou, 3);
        let json = serde_json::to_value(&note).unwrap();
        assert_eq!(json.get("note_type").unwrap(), "散");
        assert!(json.get("left_finger").unwrap().is_null());
        assert!(json.get("hui").unwrap().is_null());
    }

    #[test]
    fn test_backward_compat_no_note_type() {
        // 旧版 JSON 没有 note_type 字段，deserialize 时应该默认 AnYin
        let json = r#"{"left_finger":"Da","hui":{"hui":9,"fen":null},"right_action":"Gou","string_number":1,"compound":null,"ornaments":[],"duration":1.0}"#;
        let note: GuqinNote = serde_json::from_str(json).unwrap();
        assert_eq!(note.note_type, NoteType::AnYin);
    }

    #[test]
    fn test_rhythm_mode_default() {
        let note = GuqinNote::open_string(RightAction::Tiao, 5);
        assert_eq!(note.rhythm_mode, RhythmMode::Strict);
    }

    #[test]
    fn test_rhythm_mode_builder() {
        let note = GuqinNote::pressed(
            LeftFinger::Da,
            HuiPosition { hui: 9, fen: None },
            RightAction::Gou,
            1,
        )
        .with_rhythm_mode(RhythmMode::Free);

        assert_eq!(note.rhythm_mode, RhythmMode::Free);
    }

    #[test]
    fn test_rhythm_mode_serialization() {
        // 序列化
        let note = GuqinNote::open_string(RightAction::Gou, 3)
            .with_rhythm_mode(RhythmMode::Drop);
        let json = serde_json::to_value(&note).unwrap();
        assert_eq!(json.get("rhythm_mode").unwrap(), "宕");

        // 反序列化
        let back: GuqinNote = serde_json::from_value(json).unwrap();
        assert_eq!(back.rhythm_mode, RhythmMode::Drop);

        // 各模式 JSON 标签
        let strict_json = serde_json::to_value(RhythmMode::Strict).unwrap();
        assert_eq!(strict_json, "板");
        let free_json = serde_json::to_value(RhythmMode::Free).unwrap();
        assert_eq!(free_json, "散");
        let drop_json = serde_json::to_value(RhythmMode::Drop).unwrap();
        assert_eq!(drop_json, "宕");
    }

    #[test]
    fn test_backward_compat_no_rhythm_mode() {
        // 旧版 JSON 没有 rhythm_mode 字段，deserialize 时应默认 Strict
        let json = r#"{"note_type":"散","left_finger":null,"hui":null,"right_action":"Tiao","string_number":5,"compound":null,"ornaments":[],"duration":1.0}"#;
        let note: GuqinNote = serde_json::from_str(json).unwrap();
        assert_eq!(note.rhythm_mode, RhythmMode::Strict);
    }
}
