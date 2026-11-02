//! # 简谱转减字规则映射
//!
//! 多调式（正调/蕤宾调/慢角调，1=F）下的简谱数字到古琴减字候选映射。
//! 输出候选按演奏舒适性评分排序，优先散音、常用弦、低徽位泛音/按音。

use serde::{Deserialize, Serialize};

use crate::{GuqinNote, Hui, HuiPosition, LeftFinger, RightAction, StringNumber};
// ts-rs：从 Rust wire 类型生成前端 TS 类型（见 src/bin/gen_types.rs）。
use ts_rs::TS;

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

/// 十三徽各自对应的泛音谐波次数（弦长 1/n 处轻触，出第 n 次谐波）。
///
/// 这是物理事实，不是调式属性：一徽 1/8 → 8 次，七徽 1/2 → 2 次。
/// 之前用「泛音 = 散音 + 几个级数」的近似表，把一徽记成与散音同音，
/// 等于所有泛音候选都低了一到三个八度——候选看着像，弹出来不是那个音。
const HUI_HARMONIC: [u8; 13] = [8, 6, 5, 4, 3, 5, 2, 5, 3, 4, 5, 6, 8];

/// 简谱级数在 1=F 记谱下的半音数（1=F 2=G 3=A 4=B♭ 5=C 6=D 7=E）。
///
/// 三种定弦都用同一套 1=F 记谱（正调三弦为宫），所以级数→半音的
/// 对应关系与调式无关，调式只决定每根空弦落在第几级。
const DEGREE_SEMITONES: [i32; 7] = [0, 2, 4, 5, 7, 9, 11];

/// 级数 1、八度 0 的绝对 MIDI 号。
///
/// 定弦表把正调一弦（C2 = 36）记作 5（八度 0），故 1（八度 0）= F1 = 29。
/// 八度编号以「一弦所在组」为 0，与古琴谱面写法一致。
const PITCH_BASE_MIDI: i32 = 29;

/// 级数 + 八度 → 绝对 MIDI 号（十二平均律取整后的名义值）。
fn midi_note(pitch: Pitch) -> f64 {
    let degree = DEGREE_SEMITONES[(pitch.number.clamp(1, 7) - 1) as usize];
    f64::from(PITCH_BASE_MIDI) + f64::from(pitch.octave) * 12.0 + f64::from(degree)
}

/// 允许的取整误差：约三分之一半音（30 音分）——`nearest_pitch` 里用半音为单位比较。
///
/// 徽位是纯律，与平均律最多差十几音分（五徽大三度 386 vs 400），
/// 30 音分以内算同一个音；超过就说明这个按点并不真在这个音上（微分位置大多如此），
/// 宁可不出候选，也不能把一个升半音的位置报成邻音。
const SNAP_TOLERANCE: f64 = 0.3;

/// 绝对 MIDI 号 → 最接近的简谱级数；差得太远返回 None。
fn nearest_pitch(midi: f64) -> Option<Pitch> {
    let mut best: Option<(f64, Pitch)> = None;
    for octave in -3..=4 {
        for (idx, _) in DEGREE_SEMITONES.iter().enumerate() {
            let candidate = Pitch::new((idx + 1) as u8, octave);
            let distance = (midi_note(candidate) - midi).abs();
            if best.is_none_or(|(best_distance, _)| distance < best_distance) {
                best = Some((distance, candidate));
            }
        }
    }
    match best {
        Some((distance, pitch)) if distance <= SNAP_TOLERANCE => Some(pitch),
        _ => None,
    }
}

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

/// 由散音推导整行（散音 + 九个泛音徽位）音高。
///
/// 泛音是**谐波**：徽位处的弦长比例 p 决定谐波次数 n，泛音频率就是
/// n × 空弦频率——不是「散音往上数几级」。按级数数会在低徽位上漏掉
/// 两三个八度（一徽 8 次谐波 = 高三个八度）。
///
/// 谐波不一定落在调内：二弦（D）三徽的 5 次谐波是 F♯，简谱写不出来。
/// 这种位置用 `None` 标掉，宁可不出候选，也不能把它当成邻音报出去。
fn harmonic_row(open: Pitch) -> [Option<Pitch>; 10] {
    let open_midi = midi_note(open);
    let mut row = [None; 10];
    row[0] = Some(open);
    for (i, &hui) in ZHENG_DIAO_HARMONIC_HUI.iter().enumerate() {
        let harmonic = f64::from(HUI_HARMONIC[(hui - 1) as usize]);
        let midi = open_midi + 12.0 * harmonic.log2();
        row[i + 1] = nearest_pitch(midi);
    }
    row
}

/// 指定调式下七弦各位置的音高表。
///
/// 索引 0 恒为散音；索引 1..=9 对应 `ZHENG_DIAO_HARMONIC_HUI`，
/// `None` 表示该徽位的泛音不在调内（简谱无法表示）。
pub fn pitch_table(tuning: Tuning) -> [[Option<Pitch>; 10]; 7] {
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

/// 候选结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export_to = "taiyin.ts")]
pub struct JianziCandidate {
    /// 舒适性评分，越高越优先。
    pub score: i32,
    /// 完整的 Rust 侧音符。
    pub note: GuqinNote,
}

/// 计算某弦散音在指定按点比例处的按音音高。
///
/// `position_ratio` 为按点到岳山的距离占弦总长比例。
/// 按音与泛音用同一套 `midi_note`/`nearest_pitch`，保证「散、泛、按」
/// 三种候选待在同一个音高坐标里，否则比出来的等于白比。
fn pressed_pitch(open_pitch: Pitch, position_ratio: f64) -> Option<Pitch> {
    let effective_length = 1.0 - position_ratio;
    if effective_length <= 0.0 {
        return None;
    }
    let semitones = 12.0 * (1.0 / effective_length).log2();
    nearest_pitch(midi_note(open_pitch) + semitones)
}

/// 八度每差一组扣的分数：音级对、位置顺，优先要「就在这一带」的落点。
const OCTAVE_PENALTY: i32 = 8;

/// 同一音级（1–7）算同一个音，八度只影响排序。
///
/// 为什么不按八度严匹配：谱面上填的简谱八度常常只是个相对记号
/// （同一首曲子里「6」既可能指二弦 D2、也可能指别处的 6），
/// 严格比八度会让一个音在琴上明明有七八个落点、却只返回零到一个。
/// 真正的音位表应该回答「这个音级在琴上哪些地方能出」。
fn same_degree(a: Pitch, b: Pitch) -> bool {
    a.number == b.number
}

/// 查找音高表中所有同音级的散音/泛音位置。
fn find_matching_positions(table: &[[Option<Pitch>; 10]; 7], target: Pitch) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for (string_idx, positions) in table.iter().enumerate() {
        for (pos_idx, pitch) in positions.iter().enumerate() {
            if pitch.is_some_and(|p| same_degree(p, target)) {
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
        string: note.string_number.get(),
        ratio,
    }
}

fn hui_to_ratio(hui: HuiPosition) -> f64 {
    let hui_idx = (hui.hui.get().saturating_sub(1)) as usize;
    if hui_idx >= HUI_RATIOS.len() {
        return 0.0;
    }
    let base = HUI_RATIOS[hui_idx];
    match hui.fen {
        Some(fen) if hui.hui.get() < 13 => {
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
    table: &[[Option<Pitch>; 10]; 7],
    target: Pitch,
) -> Vec<JianziCandidate> {
    let positions = find_matching_positions(table, target);

    positions
        .into_iter()
        .map(|(string_idx, pos_idx)| {
            let string_number = StringNumber::new((string_idx + 1) as u8)
                .expect("弦序由 string_idx(0..=6)+1 恒为 1..=7");
            if pos_idx == 0 {
                // 散音：空弦优先，右手默认用挑。
                JianziCandidate {
                    score: 150 - degree_octave_penalty(table[string_idx][pos_idx], target),
                    note: GuqinNote::open_string(RightAction::Tiao, string_number),
                }
            } else {
                // 泛音：以琴腰（七～九徽）为最好按，越往两端越靠后。
                let hui = ZHENG_DIAO_HARMONIC_HUI[pos_idx - 1];
                let hui_penalty = hui_center_penalty(hui, 3);
                JianziCandidate {
                    score: 130
                        - hui_penalty
                        - degree_octave_penalty(table[string_idx][pos_idx], target),
                    note: GuqinNote::fan_yin(
                        LeftFinger::Da,
                        HuiPosition {
                            hui: Hui::new(hui).expect("泛音徽位恒在 1..=13 内"),
                            fen: None,
                        },
                        RightAction::Tiao,
                        string_number,
                    ),
                }
            }
        })
        .collect()
}

/// 生成按音候选。
fn find_pressed_candidates(
    table: &[[Option<Pitch>; 10]; 7],
    target: Pitch,
) -> Vec<JianziCandidate> {
    let mut candidates = Vec::new();

    for (string_idx, positions) in table.iter().enumerate() {
        // 行首恒为散音，必然有音高
        let open_pitch = positions[0].expect("散音行首恒为该弦空弦音");

        // 十三徽都要算：十二、十三徽上的按音在《流水》《潇湘水云》里很常见，
        // 只算到十一徽等于把这些音从候选里抹掉。
        for hui in 1..=13 {
            let hui_idx = (hui - 1) as usize;

            // 徽位上的按音（与泛音同音高）
            if let Some(pitch) = pressed_pitch(open_pitch, HUI_RATIOS[hui_idx])
                && same_degree(pitch, target)
            {
                candidates.push(build_pressed_candidate(
                    string_idx,
                    hui,
                    None,
                    octave_penalty(pitch, target),
                ));
            }

            // 常用分位
            for &fen in &COMMON_FEN {
                if hui >= 13 {
                    continue;
                }
                let next_ratio = HUI_RATIOS[hui_idx + 1];
                let ratio =
                    HUI_RATIOS[hui_idx] + (next_ratio - HUI_RATIOS[hui_idx]) * (fen as f64 / 10.0);
                if let Some(pitch) = pressed_pitch(open_pitch, ratio)
                    && same_degree(pitch, target)
                {
                    candidates.push(build_pressed_candidate(
                        string_idx,
                        hui,
                        Some(fen),
                        octave_penalty(pitch, target),
                    ));
                }
            }
        }
    }

    candidates
}

fn build_pressed_candidate(
    string_idx: usize,
    hui: u8,
    fen: Option<u8>,
    octave_penalty: i32,
) -> JianziCandidate {
    let string_number =
        StringNumber::new((string_idx + 1) as u8).expect("弦序由 string_idx(0..=6)+1 恒为 1..=7");
    let left_finger = choose_left_finger(hui);

    // 把位友好度：七～九徽在琴腰，手最顺、音最实；
    // 一～三徽贴着岳山，按下去又硬又薄，排后面。
    let mut score: i32 = 105 - hui_center_penalty(hui, 2);
    if fen.is_some() {
        // 微分是按弦点的近似，先给整徽让路
        score -= 4;
    }
    if string_number.get() >= 5 {
        score += 5;
    }
    if matches!(left_finger, LeftFinger::Gui) {
        score -= 10;
    }
    score -= octave_penalty;

    JianziCandidate {
        score,
        note: GuqinNote::pressed(
            left_finger,
            HuiPosition {
                hui: Hui::new(hui).expect("按音徽位恒在 1..=13 内"),
                fen,
            },
            RightAction::Tiao,
            string_number,
        ),
    }
}

/// 徽位离琴腰（八徽附近）多远就扣多少分：`weight` 为每徽的扣分。
fn hui_center_penalty(hui: u8, weight: i32) -> i32 {
    (i32::from(hui) - 8).abs() * weight
}

/// 八度每差一组扣几分（越接近谱面写的那个八度，排得越前）。
fn octave_penalty(pitch: Pitch, target: Pitch) -> i32 {
    (i32::from(pitch.octave) - i32::from(target.octave)).abs() * OCTAVE_PENALTY
}

/// 表里可能没有音高（泛音不在调内）→ 不罚分，交给外层过滤。
fn degree_octave_penalty(pitch: Option<Pitch>, target: Pitch) -> i32 {
    pitch.map_or(0, |p| octave_penalty(p, target))
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
        let table = pitch_table(Tuning::ZhengDiao);
        assert_eq!(table[0][0], Some(Pitch::new(5, 0))); // 一弦散音 = 5
        assert_eq!(table[1][0], Some(Pitch::new(6, 0))); // 二弦散音 = 6
        assert_eq!(table[2][0], Some(Pitch::new(1, 1))); // 三弦散音 = 1
        assert_eq!(table[6][0], Some(Pitch::new(6, 1))); // 七弦散音 = 6·
    }

    /// 级数 + 八度 → 绝对 MIDI，与前端 `jianzi-pitch` 的物理模型对齐：
    /// 一弦 C2=36、三弦 F2=41、六弦 C3=48、七弦 D3=50。
    #[test]
    fn test_pitch_midi_frame() {
        assert_eq!(midi_note(Pitch::new(5, 0)), 36.0); // 一弦 C2
        assert_eq!(midi_note(Pitch::new(1, 1)), 41.0); // 三弦 F2
        assert_eq!(midi_note(Pitch::new(5, 1)), 48.0); // 六弦 C3
        assert_eq!(midi_note(Pitch::new(6, 1)), 50.0); // 七弦 D3
        assert_eq!(midi_note(Pitch::new(4, 1)), 46.0); // 蕤宾调五弦 B♭2
        assert_eq!(midi_note(Pitch::new(7, 0)), 40.0); // 慢角调三弦 E2
    }

    /// 泛音是谐波，不是「散音往上数几级」：一徽 8 次、七徽 2 次。
    #[test]
    fn test_harmonic_row_uses_harmonics() {
        let table = pitch_table(Tuning::ZhengDiao);
        // 一弦（C2）：一徽 8× = C5（高三个八度），七徽 2× = C3
        assert_eq!(table[0][1], Some(Pitch::new(5, 3))); // 一徽
        assert_eq!(table[0][5], Some(Pitch::new(5, 1))); // 七徽
        // 三弦（F2）：五徽 3× = C4；九徽 3× = C4
        assert_eq!(table[2][4], Some(Pitch::new(5, 2))); // 五徽
        assert_eq!(table[2][6], Some(Pitch::new(5, 2))); // 九徽
        // 二弦（D2）三徽 5× = F♯3，不在 F 调内 → 标 None，不许当成邻音
        assert_eq!(table[1][2], None);
    }

    /// 按音与泛音必须算出同一个音：三弦七徽按实 = 两倍弦长 = F3（八度 2）。
    #[test]
    fn test_pressed_pitch_matches_harmonic() {
        let open = pitch_table(Tuning::ZhengDiao)[2][0].expect("三弦散音"); // F2 = 1（八度 1）
        let pressed = pressed_pitch(open, HUI_RATIOS[6]).expect("七徽按音应落在音阶上");
        assert_eq!(pressed, Pitch::new(1, 2)); // F2 × 2 = F3
        assert_eq!(pitch_table(Tuning::ZhengDiao)[2][5], Some(Pitch::new(1, 2))); // 七徽泛音同音
    }

    /// 每个候选的实际音级都必须等于目标音级——这一条能整体防住
    /// 「散/泛/按 三套坐标各算各的」这类错（曾经按音用 1=C 坐标、
    /// 泛音行按级数算，候选看着像，弹出来全不是那个音）。
    #[test]
    fn test_every_candidate_matches_target_degree() {
        fn note_pitch(note: &GuqinNote, tuning: Tuning) -> Option<Pitch> {
            let open = tuning.open_strings()[(note.string_number.get() - 1) as usize];
            match note.note_type {
                crate::NoteType::SanYin => Some(open),
                crate::NoteType::FanYin => {
                    let hui = note.hui?.hui.get();
                    let harmonic = f64::from(HUI_HARMONIC[(hui - 1) as usize]);
                    nearest_pitch(midi_note(open) + 12.0 * harmonic.log2())
                }
                crate::NoteType::AnYin => pressed_pitch(open, hui_to_ratio(note.hui?)),
            }
        }

        for tuning in [Tuning::ZhengDiao, Tuning::RuiBin, Tuning::ManJiao] {
            for number in 1..=7u8 {
                for octave in -1..=2i8 {
                    let target = Pitch::new(number, octave);
                    for candidate in translate_jianpu(JianpuNote::new(number, octave), tuning) {
                        let actual = note_pitch(&candidate.note, tuning).expect("候选应算得出音高");
                        assert_eq!(
                            actual.number, target.number,
                            "候选 {:?} 的音级与目标 {:?} 不符",
                            candidate.note, target
                        );
                    }
                }
            }
        }
    }

    /// 一个音在琴上通常有多处落点：5 在正调下至少有散一、散六和若干按音。
    #[test]
    fn test_common_pitch_has_many_positions() {
        let candidates = translate_jianpu(JianpuNote::new(5, 0), Tuning::ZhengDiao);
        assert!(
            candidates.len() >= 5,
            "5 的候选只有 {} 个，说明散/泛/按没算全",
            candidates.len()
        );
        let has_open_one = candidates.iter().any(|c| {
            c.note.note_type == crate::NoteType::SanYin && c.note.string_number.get() == 1
        });
        let has_open_six = candidates.iter().any(|c| {
            c.note.note_type == crate::NoteType::SanYin && c.note.string_number.get() == 6
        });
        let has_pressed = candidates
            .iter()
            .any(|c| c.note.note_type == crate::NoteType::AnYin);
        assert!(has_open_one && has_open_six && has_pressed);
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
        assert_eq!(first.string_number.get(), 1);
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
    fn test_tuning_open_strings() {
        assert_eq!(Tuning::RuiBin.open_strings()[4], Pitch::new(4, 1)); // 紧五弦 3→4
        assert_eq!(Tuning::ManJiao.open_strings()[2], Pitch::new(7, 0)); // 慢三弦 1→7
        assert_eq!(Tuning::ZhengDiao.open_strings()[0], Pitch::new(5, 0));
    }

    #[test]
    fn test_ruibin_translate_open_string_five() {
        // 蕤宾调五弦散音为 4：translate(4) 应出现五弦散音候选
        let candidates = translate_jianpu(JianpuNote::new(4, 1), Tuning::RuiBin);
        let open_five = candidates.iter().any(|c| {
            c.note.note_type == crate::NoteType::SanYin && c.note.string_number.get() == 5
        });
        assert!(open_five, "蕤宾调下 4 应含五弦散音候选");
    }

    #[test]
    fn test_manjiao_translate_open_string_three() {
        // 慢角调三弦散音为 7：translate(7) 应出现三弦散音候选
        let candidates = translate_jianpu(JianpuNote::new(7, 0), Tuning::ManJiao);
        let open_three = candidates.iter().any(|c| {
            c.note.note_type == crate::NoteType::SanYin && c.note.string_number.get() == 3
        });
        assert!(open_three, "慢角调下 7 应含三弦散音候选");
    }

    #[test]
    fn test_tuning_changes_candidates() {
        // 同一简谱数字在不同调式下候选不同：4 在正调五弦无散音，在蕤宾调有
        let zheng = translate_jianpu(JianpuNote::new(4, 1), Tuning::ZhengDiao);
        let zheng_open_five = zheng.iter().any(|c| {
            c.note.note_type == crate::NoteType::SanYin && c.note.string_number.get() == 5
        });
        assert!(!zheng_open_five, "正调五弦散音为 3，不应匹配 4");
    }

    #[test]
    fn test_tuning_sequence_uses_tuning() {
        let notes = [JianpuNote::new(4, 1)];
        let result = translate_jianpu_sequence(&notes, Tuning::RuiBin);
        assert_eq!(result.len(), 1);
        assert!(result[0].iter().any(|c| {
            c.note.note_type == crate::NoteType::SanYin && c.note.string_number.get() == 5
        }));
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
