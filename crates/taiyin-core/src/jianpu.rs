//! # 简谱转减字规则映射
//!
//! 正调（一弦到七弦散音为 5 6 1 2 3 5 6）下的简谱数字到古琴减字候选映射。
//! 输出候选按演奏舒适性评分排序，优先散音、常用弦、低徽位泛音。

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

/// 查找正调下所有匹配目标音高的位置。
fn find_matching_positions(target: Pitch) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for (string_idx, positions) in ZHENG_DIAO_PITCHES.iter().enumerate() {
        for (pos_idx, pitch) in positions.iter().enumerate() {
            if *pitch == target {
                out.push((string_idx, pos_idx));
            }
        }
    }
    out
}

/// 将简谱音符翻译为候选减字。
///
/// 当前支持散音与泛音。按音候选后续扩展。
pub fn translate_jianpu(note: JianpuNote) -> Vec<JianziCandidate> {
    let target = Pitch::new(note.number, note.octave);
    let positions = find_matching_positions(target);

    let mut candidates: Vec<JianziCandidate> = positions
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
        .collect();

    candidates.sort_by_key(|c| std::cmp::Reverse(c.score));
    candidates
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
        let candidates = translate_jianpu(JianpuNote::new(5, 0));
        assert!(!candidates.is_empty());
        let first = &candidates[0].note;
        assert_eq!(first.string_number, 1);
        assert_eq!(first.note_type, crate::NoteType::SanYin);
        assert_eq!(first.right_action, RightAction::Tiao);
    }

    #[test]
    fn test_translate_jianpu_fan_yin() {
        // 二弦一徽泛音 = 6
        let candidates = translate_jianpu(JianpuNote::new(6, 0));
        let has_fan = candidates
            .iter()
            .any(|c| c.note.note_type == crate::NoteType::FanYin);
        assert!(has_fan);
    }

    #[test]
    fn test_translate_jianpu_sorts_open_first() {
        // 一弦散音 5 与一弦一徽泛音 5 同音，散音应排在最前
        let candidates = translate_jianpu(JianpuNote::new(5, 0));
        assert_eq!(candidates[0].note.note_type, crate::NoteType::SanYin);
        assert!(candidates[0].score >= candidates.get(1).map_or(0, |c| c.score));
    }
}
