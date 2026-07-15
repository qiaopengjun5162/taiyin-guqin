//! # 简谱转减字规则映射
//!
//! 多调式（正调/蕤宾调/慢角调，1=F）下的简谱数字到古琴减字候选映射。
//! 输出候选按演奏舒适性评分排序，优先散音、常用弦、低徽位泛音/按音。

use serde::{Deserialize, Serialize};

use crate::{GuqinNote, HuiPosition, LeftFinger, RightAction};

/// 简谱音符。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct JianpuNote {
    /// 简谱数字 1–7。
    pub number: u8,
    /// 八度偏移：0 = 中央组，+1 = 高八度 (·)，-1 = 低八度 (,)。
    pub octave: i8,
}

impl JianpuNote {
    /// 创建一个简谱音符。
    pub fn new(number: u8, octave: i8) -> Self {
        Self { number, octave }
    }
}

/// 音高，用简谱数字加八度表示。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Pitch {
    pub number: u8,
    pub octave: i8,
}

impl Pitch {
    /// 创建一个音高。
    pub const fn new(number: u8, octave: i8) -> Self {
        Self { number, octave }
    }
}

/// 正调下可用泛音徽位，按从琴头到琴尾顺序。
pub const ZHENG_DIAO_HARMONIC_HUI: [u8; 9] = [1, 3, 4, 5, 7, 9, 10, 12, 13];

/// 泛音行相对散音的级数偏移（对应 `ZHENG_DIAO_HARMONIC_HUI`）。
///
/// 表内每行泛音音高 = 散音 + 对应级数，该关系与调式无关。
const HARMONIC_STEP_OFFSETS: [i8; 9] = [0, 2, 3, 4, 7, 9, 10, 11, 12];

/// 调式。散音音高以 1=F（三弦为宫）的简谱数字表示。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Tuning {
    /// 正调：5 6 1 2 3 5 6
    #[serde(rename = "zheng")]
    ZhengDiao,
    /// 蕤宾调（紧五弦）：5 6 1 2 4 5 6
    #[serde(rename = "ruibin")]
    RuiBin,
    /// 慢角调（慢三弦）：5 6 7 2 3 5 6
    #[serde(rename = "manjiao")]
    ManJiao,
}

impl Tuning {
    /// 七弦散音音高（一弦到七弦）。
    pub fn open_strings(self) -> [Pitch; 7] {
        match self {
            Tuning::ZhengDiao => [
                Pitch::new(5, 0),
                Pitch::new(6, 0),
                Pitch::new(1, 1),
                Pitch::new(2, 1),
                Pitch::new(3, 1),
                Pitch::new(5, 1),
                Pitch::new(6, 1),
            ],
            Tuning::RuiBin => [
                Pitch::new(5, 0),
                Pitch::new(6, 0),
                Pitch::new(1, 1),
                Pitch::new(2, 1),
                Pitch::new(4, 1),
                Pitch::new(5, 1),
                Pitch::new(6, 1),
            ],
            Tuning::ManJiao => [
                Pitch::new(5, 0),
                Pitch::new(6, 0),
                Pitch::new(7, 0),
                Pitch::new(2, 1),
                Pitch::new(3, 1),
                Pitch::new(5, 1),
                Pitch::new(6, 1),
            ],
        }
    }
}

/// 级数转置：number 沿自然音阶移动 steps 级，超出七级进八度。
fn transpose_diatonic(pitch: Pitch, steps: i8) -> Pitch {
    let idx = pitch.number as i8 - 1 + steps;
    Pitch {
        number: (idx.rem_euclid(7) + 1) as u8,
        octave: pitch.octave + idx.div_euclid(7),
    }
}

/// 由散音推导整行（散音 + 九个泛音徽位）音高。
fn harmonic_row(open: Pitch) -> [Pitch; 10] {
    let mut row = [open; 10];
    for (i, &steps) in HARMONIC_STEP_OFFSETS.iter().enumerate() {
        row[i + 1] = transpose_diatonic(open, steps);
    }
    row
}

/// 指定调式下七弦各位置的音高表。
pub fn pitch_table(tuning: Tuning) -> [[Pitch; 10]; 7] {
    tuning.open_strings().map(harmonic_row)
}

/// 十三徽从岳山到按点的弦长比例。
const HUI_RATIOS: [f64; 13] = [
    1.0 / 8.0,
    1.0 / 6.0,
    1.0 / 5.0,
    1.0 / 4.0,
    1.0 / 3.0,
    2.0 / 5.0,
    1.0 / 2.0,
    3.0 / 5.0,
    2.0 / 3.0,
    3.0 / 4.0,
    4.0 / 5.0,
    5.0 / 6.0,
    7.0 / 8.0,
];

/// 常用分位（十分比）。
const COMMON_FEN: [u8; 4] = [3, 5, 6, 8];

/// 正调下七弦各位置的音高。
///
/// 每个内层数组长度为 10：索引 0 为散音，索引 1..=9 依次对应
/// `ZHENG_DIAO_HARMONIC_HUI` 中的泛音徽位。
pub const ZHENG_DIAO_PITCHES: [[Pitch; 10]; 7] = [
    // 一弦
    [
        Pitch::new(5, 0),
        Pitch::new(5, 0),
        Pitch::new(7, 0),
        Pitch::new(1, 1),
        Pitch::new(2, 1),
        Pitch::new(5, 1),
        Pitch::new(7, 1),
        Pitch::new(1, 2),
        Pitch::new(2, 2),
        Pitch::new(3, 2),
    ],
    // 二弦
    [
        Pitch::new(6, 0),
        Pitch::new(6, 0),
        Pitch::new(1, 1),
        Pitch::new(2, 1),
        Pitch::new(3, 1),
        Pitch::new(6, 1),
        Pitch::new(1, 2),
        Pitch::new(2, 2),
        Pitch::new(3, 2),
        Pitch::new(4, 2),
    ],
    // 三弦
    [
        Pitch::new(1, 1),
        Pitch::new(1, 1),
        Pitch::new(3, 1),
        Pitch::new(4, 1),
        Pitch::new(5, 1),
        Pitch::new(1, 2),
        Pitch::new(3, 2),
        Pitch::new(4, 2),
        Pitch::new(5, 2),
        Pitch::new(6, 2),
    ],
    // 四弦
    [
        Pitch::new(2, 1),
        Pitch::new(2, 1),
        Pitch::new(4, 1),
        Pitch::new(5, 1),
        Pitch::new(6, 1),
        Pitch::new(2, 2),
        Pitch::new(4, 2),
        Pitch::new(5, 2),
        Pitch::new(6, 2),
        Pitch::new(7, 2),
    ],
    // 五弦
    [
        Pitch::new(3, 1),
        Pitch::new(3, 1),
        Pitch::new(5, 1),
        Pitch::new(6, 1),
        Pitch::new(7, 1),
        Pitch::new(3, 2),
        Pitch::new(5, 2),
        Pitch::new(6, 2),
        Pitch::new(7, 2),
        Pitch::new(1, 3),
    ],
    // 六弦
    [
        Pitch::new(5, 1),
        Pitch::new(5, 1),
        Pitch::new(7, 1),
        Pitch::new(1, 2),
        Pitch::new(2, 2),
        Pitch::new(5, 2),
        Pitch::new(7, 2),
        Pitch::new(1, 3),
        Pitch::new(2, 3),
        Pitch::new(3, 3),
    ],
    // 七弦
    [
        Pitch::new(6, 1),
        Pitch::new(6, 1),
        Pitch::new(1, 2),
        Pitch::new(2, 2),
        Pitch::new(3, 2),
        Pitch::new(6, 2),
        Pitch::new(1, 3),
        Pitch::new(2, 3),
        Pitch::new(3, 3),
        Pitch::new(4, 3),
    ],
];

/// 候选结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JianziCandidate {
    /// 舒适性评分，越高越优先。
    pub score: i32,
    /// 完整的 Rust 侧音符。
    pub note: GuqinNote,
}

/// 将 `Pitch` 映射到 MIDI note number（中央组 C = 60）。
fn midi_note(pitch: Pitch) -> f64 {
    let base = 60.0 + (pitch.octave as f64) * 12.0;
    let offset = match pitch.number {
        1 => 0.0,
        2 => 2.0,
        3 => 4.0,
        4 => 5.0,
        5 => 7.0,
        6 => 9.0,
        7 => 11.0,
        _ => 0.0,
    };
    base + offset
}

/// 从 MIDI note number 还原为 `Pitch`。
fn pitch_from_midi(midi: f64) -> Pitch {
    let rounded = midi.round();
    let octave = ((rounded - 60.0) / 12.0).floor() as i8;
    let pc = ((rounded as i32 - 60).rem_euclid(12)) as u8;
    let number = match pc {
        0 => 1,
        2 => 2,
        4 => 3,
        5 => 4,
        7 => 5,
        9 => 6,
        11 => 7,
        _ => 1,
    };
    Pitch { number, octave }
}

/// 计算某弦散音在指定按点比例处的按音音高。
///
/// `position_ratio` 为按点到岳山的距离占弦总长比例。
fn pressed_pitch(open_pitch: Pitch, position_ratio: f64) -> Pitch {
    let effective_length = 1.0 - position_ratio;
    let ratio = 1.0 / effective_length;
    let semitones = ratio.log2() * 12.0;
    pitch_from_midi(midi_note(open_pitch) + semitones)
}

/// 查找音高表中所有匹配目标音高的散音/泛音位置。
fn find_matching_positions(table: &[[Pitch; 10]; 7], target: Pitch) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for (string_idx, positions) in table.iter().enumerate() {
        for (pos_idx, pitch) in positions.iter().enumerate() {
            if *pitch == target {
                out.push((string_idx, pos_idx));
            }
        }
    }
    out
}

/// 左手触弦位置，用于上下文距离计算。
#[derive(Debug, Clone, Copy)]
struct FretPosition {
    /// 弦序 1..=7。
    string: u8,
    /// 按点在弦上的相对位置：0.0 = 空弦（散音），1.0 = 龙龈端。
    ratio: f64,
}

fn position_from_note(note: &GuqinNote) -> FretPosition {
    let ratio = match (&note.note_type, note.hui) {
        (crate::NoteType::SanYin, _) => 0.0,
        (_, Some(hui)) => hui_to_ratio(hui),
        _ => 0.0,
    };
    FretPosition {
        string: note.string_number,
        ratio,
    }
}

fn hui_to_ratio(hui: HuiPosition) -> f64 {
    let hui_idx = (hui.hui.saturating_sub(1)) as usize;
    if hui_idx >= HUI_RATIOS.len() {
        return 0.0;
    }
    let base = HUI_RATIOS[hui_idx];
    match hui.fen {
        Some(fen) if hui.hui < 13 => {
            let next = HUI_RATIOS[hui_idx + 1];
            base + (next - base) * (fen as f64 / 10.0)
        }
        _ => base,
    }
}

fn context_bonus(prev: FretPosition, curr: FretPosition) -> i32 {
    let string_distance = prev.string.abs_diff(curr.string) as i32;
    let ratio_distance = (prev.ratio - curr.ratio).abs();

    if string_distance == 0 && ratio_distance < 0.15 {
        25
    } else if string_distance <= 1 && ratio_distance < 0.25 {
        15
    } else if string_distance <= 2 {
        5
    } else {
        0
    }
}

/// 根据徽位选择合理的左手指法。
fn choose_left_finger(hui: u8) -> LeftFinger {
    match hui {
        1..=4 => LeftFinger::Da,
        5..=7 => LeftFinger::Shi,
        8..=10 => LeftFinger::Ming,
        _ => LeftFinger::Gui,
    }
}

/// 生成散音与泛音候选。
fn find_open_and_harmonic_candidates(
    table: &[[Pitch; 10]; 7],
    target: Pitch,
) -> Vec<JianziCandidate> {
    let positions = find_matching_positions(table, target);

    positions
        .into_iter()
        .map(|(string_idx, pos_idx)| {
            let string_number = (string_idx + 1) as u8;
            if pos_idx == 0 {
                // 散音：空弦优先，右手默认用挑。
                JianziCandidate {
                    score: 150,
                    note: GuqinNote::open_string(RightAction::Tiao, string_number),
                }
            } else {
                // 泛音：徽位越低越优先。
                let hui = ZHENG_DIAO_HARMONIC_HUI[pos_idx - 1];
                let hui_penalty = hui as i32 * 2;
                JianziCandidate {
                    score: 130 - hui_penalty,
                    note: GuqinNote::fan_yin(
                        LeftFinger::Da,
                        HuiPosition { hui, fen: None },
                        RightAction::Tiao,
                        string_number,
                    ),
                }
            }
        })
        .collect()
}

/// 生成按音候选。
fn find_pressed_candidates(table: &[[Pitch; 10]; 7], target: Pitch) -> Vec<JianziCandidate> {
    let mut candidates = Vec::new();

    for (string_idx, positions) in table.iter().enumerate() {
        let open_pitch = positions[0];

        for hui in 1..=11 {
            let hui_idx = (hui - 1) as usize;

            // 徽位上的按音（与泛音同音高）
            let exact = pressed_pitch(open_pitch, HUI_RATIOS[hui_idx]);
            if exact == target {
                candidates.push(build_pressed_candidate(string_idx, hui, None));
            }

            // 常用分位
            for &fen in &COMMON_FEN {
                if hui >= 13 {
                    continue;
                }
                let next_ratio = HUI_RATIOS[hui_idx + 1];
                let ratio =
                    HUI_RATIOS[hui_idx] + (next_ratio - HUI_RATIOS[hui_idx]) * (fen as f64 / 10.0);
                let p = pressed_pitch(open_pitch, ratio);
                if p == target {
                    candidates.push(build_pressed_candidate(string_idx, hui, Some(fen)));
                }
            }
        }
    }

    candidates
}

fn build_pressed_candidate(string_idx: usize, hui: u8, fen: Option<u8>) -> JianziCandidate {
    let string_number = (string_idx + 1) as u8;
    let left_finger = choose_left_finger(hui);

    let mut score: i32 = 100;
    score += 13 - hui as i32;
    if string_number >= 5 {
        score += 5;
    }
    if matches!(left_finger, LeftFinger::Gui) {
        score -= 10;
    }

    JianziCandidate {
        score,
        note: GuqinNote::pressed(
            left_finger,
            HuiPosition { hui, fen },
            RightAction::Tiao,
            string_number,
        ),
    }
}

/// 将简谱音符翻译为候选减字。
///
/// 支持散音、泛音与按音候选，按演奏舒适性评分排序。
pub fn translate_jianpu(note: JianpuNote, tuning: Tuning) -> Vec<JianziCandidate> {
    let table = pitch_table(tuning);
    let target = Pitch::new(note.number, note.octave);
    let mut candidates = find_open_and_harmonic_candidates(&table, target);
    candidates.extend(find_pressed_candidates(&table, target));
    candidates.sort_by_key(|c| std::cmp::Reverse(c.score));
    candidates
}

/// 将多个简谱音符批量翻译为候选减字。
///
/// 每个音符先生成散音/泛音/按音候选，再根据前一个已选候选的位置
/// 对当前候选做上下文加分，使相邻音符演奏更连贯。
pub fn translate_jianpu_sequence(
    notes: &[JianpuNote],
    tuning: Tuning,
) -> Vec<Vec<JianziCandidate>> {
    let initial: Vec<Vec<JianziCandidate>> =
        notes.iter().map(|n| translate_jianpu(*n, tuning)).collect();

    let mut result = Vec::with_capacity(initial.len());
    let mut prev_note: Option<GuqinNote> = None;

    for mut candidates in initial {
        if let Some(ref prev) = prev_note {
            let prev_pos = position_from_note(prev);
            for c in &mut candidates {
                let curr_pos = position_from_note(&c.note);
                c.score += context_bonus(prev_pos, curr_pos);
            }
            candidates.sort_by_key(|c| std::cmp::Reverse(c.score));
        }
        prev_note = candidates.first().map(|c| c.note.clone());
        result.push(candidates);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zheng_diao_open_strings() {
        assert_eq!(ZHENG_DIAO_PITCHES[0][0], Pitch::new(5, 0)); // 一弦散音 = 5
        assert_eq!(ZHENG_DIAO_PITCHES[1][0], Pitch::new(6, 0)); // 二弦散音 = 6
        assert_eq!(ZHENG_DIAO_PITCHES[2][0], Pitch::new(1, 1)); // 三弦散音 = 1
        assert_eq!(ZHENG_DIAO_PITCHES[6][0], Pitch::new(6, 1)); // 七弦散音 = 6·
    }

    #[test]
    fn test_jianpu_note_serialization() {
        let note = JianpuNote::new(5, 1);
        let json = serde_json::to_string(&note).unwrap();
        assert_eq!(json, r#"{"number":5,"octave":1}"#);
    }

    #[test]
    fn test_translate_jianpu_open_string() {
        let candidates = translate_jianpu(JianpuNote::new(5, 0), Tuning::ZhengDiao);
        assert!(!candidates.is_empty());
        let first = &candidates[0].note;
        assert_eq!(first.string_number, 1);
        assert_eq!(first.note_type, crate::NoteType::SanYin);
        assert_eq!(first.right_action, RightAction::Tiao);
    }

    #[test]
    fn test_translate_jianpu_fan_yin() {
        // 二弦一徽泛音 = 6
        let candidates = translate_jianpu(JianpuNote::new(6, 0), Tuning::ZhengDiao);
        let has_fan = candidates
            .iter()
            .any(|c| c.note.note_type == crate::NoteType::FanYin);
        assert!(has_fan);
    }

    #[test]
    fn test_translate_jianpu_sorts_open_first() {
        // 一弦散音 5 与一弦一徽泛音 5 同音，散音应排在最前
        let candidates = translate_jianpu(JianpuNote::new(5, 0), Tuning::ZhengDiao);
        assert_eq!(candidates[0].note.note_type, crate::NoteType::SanYin);
        assert!(candidates[0].score >= candidates.get(1).map_or(0, |c| c.score));
    }

    #[test]
    fn test_translate_jianpu_sequence_length() {
        let notes = [
            JianpuNote::new(5, 0),
            JianpuNote::new(6, 0),
            JianpuNote::new(1, 1),
        ];
        let result = translate_jianpu_sequence(&notes, Tuning::ZhengDiao);
        assert_eq!(result.len(), 3);
        assert!(!result[0].is_empty());
        assert!(!result[1].is_empty());
        assert!(!result[2].is_empty());
    }

    #[test]
    fn test_translate_jianpu_includes_pressed() {
        // 中央组的 1 在正调散音/泛音表中不存在，只能靠按音
        let candidates = translate_jianpu(JianpuNote::new(1, 0), Tuning::ZhengDiao);
        let has_anyin = candidates
            .iter()
            .any(|c| c.note.note_type == crate::NoteType::AnYin);
        assert!(has_anyin, "中央组 1 应至少有一个按音候选");
    }

    #[test]
    fn test_pressed_candidate_has_hui_and_finger() {
        let candidates = translate_jianpu(JianpuNote::new(1, 0), Tuning::ZhengDiao);
        let anyin = candidates
            .iter()
            .find(|c| c.note.note_type == crate::NoteType::AnYin)
            .expect("应有按音候选");
        assert!(anyin.note.hui.is_some());
        assert!(anyin.note.left_finger.is_some());
    }

    #[test]
    fn test_open_fan_rank_higher_than_pressed() {
        // 5 同时有散音/泛音/按音，散音应在最前，按音应在后
        let candidates = translate_jianpu(JianpuNote::new(5, 0), Tuning::ZhengDiao);
        let open_score = candidates
            .iter()
            .find(|c| c.note.note_type == crate::NoteType::SanYin)
            .map(|c| c.score)
            .unwrap_or(0);
        let pressed_score = candidates
            .iter()
            .find(|c| c.note.note_type == crate::NoteType::AnYin)
            .map(|c| c.score)
            .unwrap_or(0);
        assert!(open_score > pressed_score);
    }

    #[test]
    fn test_pressed_pitch_matches_harmonic() {
        // 一弦七徽泛音 = 5·，按音在七徽处应得到相同音高
        let open = ZHENG_DIAO_PITCHES[0][0];
        let pressed = pressed_pitch(open, HUI_RATIOS[6]); // 七徽
        assert_eq!(pressed, Pitch::new(5, 1));
    }

    #[test]
    fn test_context_prefers_nearby_positions() {
        // 连续两个中央组 1，第二个应优先选择与第一个接近的位置
        let notes = [JianpuNote::new(1, 0), JianpuNote::new(1, 0)];
        let result = translate_jianpu_sequence(&notes, Tuning::ZhengDiao);

        let first_pos = position_from_note(&result[0][0].note);
        let second_top = &result[1][0];
        let second_pos = position_from_note(&second_top.note);

        let string_distance = first_pos.string.abs_diff(second_pos.string);
        assert!(
            string_distance <= 1,
            "上下文应优先选择邻近弦，但得到 {}",
            string_distance
        );
    }

    #[test]
    fn test_context_does_not_affect_first_note() {
        let notes = [JianpuNote::new(5, 0), JianpuNote::new(6, 0)];
        let result = translate_jianpu_sequence(&notes, Tuning::ZhengDiao);
        // 第一音仍按单音规则排序
        assert_eq!(result[0][0].note.note_type, crate::NoteType::SanYin);
    }

    #[test]
    fn test_derived_table_matches_zheng_diao_const() {
        // 泛音行推导必须复现正调常量表（正调行为零变化）
        assert_eq!(pitch_table(Tuning::ZhengDiao), ZHENG_DIAO_PITCHES);
    }

    #[test]
    fn test_tuning_open_strings() {
        assert_eq!(Tuning::RuiBin.open_strings()[4], Pitch::new(4, 1)); // 紧五弦 3→4
        assert_eq!(Tuning::ManJiao.open_strings()[2], Pitch::new(7, 0)); // 慢三弦 1→7
        assert_eq!(Tuning::ZhengDiao.open_strings()[0], Pitch::new(5, 0));
    }

    #[test]
    fn test_ruibin_translate_open_string_five() {
        // 蕤宾调五弦散音为 4：translate(4) 应出现五弦散音候选
        let candidates = translate_jianpu(JianpuNote::new(4, 1), Tuning::RuiBin);
        let open_five = candidates
            .iter()
            .any(|c| c.note.note_type == crate::NoteType::SanYin && c.note.string_number == 5);
        assert!(open_five, "蕤宾调下 4 应含五弦散音候选");
    }

    #[test]
    fn test_manjiao_translate_open_string_three() {
        // 慢角调三弦散音为 7：translate(7) 应出现三弦散音候选
        let candidates = translate_jianpu(JianpuNote::new(7, 0), Tuning::ManJiao);
        let open_three = candidates
            .iter()
            .any(|c| c.note.note_type == crate::NoteType::SanYin && c.note.string_number == 3);
        assert!(open_three, "慢角调下 7 应含三弦散音候选");
    }

    #[test]
    fn test_tuning_changes_candidates() {
        // 同一简谱数字在不同调式下候选不同：4 在正调五弦无散音，在蕤宾调有
        let zheng = translate_jianpu(JianpuNote::new(4, 1), Tuning::ZhengDiao);
        let zheng_open_five = zheng
            .iter()
            .any(|c| c.note.note_type == crate::NoteType::SanYin && c.note.string_number == 5);
        assert!(!zheng_open_five, "正调五弦散音为 3，不应匹配 4");
    }

    #[test]
    fn test_tuning_sequence_uses_tuning() {
        let notes = [JianpuNote::new(4, 1)];
        let result = translate_jianpu_sequence(&notes, Tuning::RuiBin);
        assert_eq!(result.len(), 1);
        assert!(
            result[0].iter().any(|c| {
                c.note.note_type == crate::NoteType::SanYin && c.note.string_number == 5
            })
        );
    }

    #[test]
    fn test_tuning_serde() {
        assert_eq!(
            serde_json::from_str::<Tuning>(r#""ruibin""#).unwrap(),
            Tuning::RuiBin
        );
        assert_eq!(
            serde_json::to_string(&Tuning::ManJiao).unwrap(),
            r#""manjiao""#
        );
    }
}
