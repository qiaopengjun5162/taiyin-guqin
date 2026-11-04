//! # 简谱转减字规则映射
//!
//! 多调式（正调/蕤宾调/慢角调，1=F）下的简谱数字到古琴减字候选映射。
//! 输出候选按演奏舒适性评分排序，优先散音、常用弦、低徽位泛音/按音。

use serde::{Deserialize, Serialize};

use crate::{GuqinNote, Hui, HuiPosition, LeftFinger, NoteType, RightAction, StringNumber};
// ts-rs：从 Rust wire 类型生成前端 TS 类型（见 src/bin/gen_types.rs）。
use ts_rs::TS;

/// 简谱音符。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct JianpuNote {
    /// 简谱数字 1–7。
    pub number: u8,
    /// 八度偏移：0 = 中央组，+1 = 高八度 (·)，-1 = 低八度 (,)。
    pub octave: i8,
    /// 时值，单位是 1/8 拍（四分音符 = 8、八分 = 4、二分 = 16）。
    ///
    /// `None` 表示调用方没给时值：一切按四分音符处理，
    /// 不带时值的老调用方行为完全不变（编排结果与加这个字段之前一模一样）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_units: Option<u32>,
}

impl JianpuNote {
    /// 创建一个简谱音符（不带时值）。
    pub fn new(number: u8, octave: i8) -> Self {
        Self {
            number,
            octave,
            duration_units: None,
        }
    }

    /// 补上时值（1/8 拍为单位）。用于让编排知道「这个音留了多少时间给手」。
    pub fn with_duration(mut self, units: u32) -> Self {
        self.duration_units = Some(units);
        self
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
/// 以正调三弦（F2 = 41）为宫：散音三弦记作 1，一弦 C2 记作低八度的 5，
/// 与琴人对着谱面唱出来的音高一致。若把 1 记成 F1（29），
/// 整张谱会系统性低一个八度——简谱行看着「没问题」，一听就低了一整组。
/// 八度编号以「三弦所在组」为 0。
const PITCH_BASE_MIDI: i32 = 41;

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

// ──────────────────────────────────────────────
// 全局指法编排（Viterbi 动态规划）
// ──────────────────────────────────────────────
//
// 上面那版 `translate_jianpu_sequence` 是**贪心**的：每个音单独评分，
// 只拿「上一个音选中的那一个候选」做上下文加分。它有两个治不好的毛病：
//
// 1. **没有前瞻**。第一音为了自己舒服选了散一弦，后面整句都得跟着跑；
//    换一个只低 2 分的落点，后十个音可能全都顺。
// 2. **局部最优会累积**。贪心一旦在某处拐错，后面每个音都在为这个错误买单，
//    而谱面单看每个字都「有分」，问题要到弹的时候才暴露——手在琴上东奔西跑。
//
// 打谱最难的就是这件事：古琴一个音常有二三十个落点，选哪一处不是看这个音本身，
// 而是看**整句怎么走最顺**。这是一个标准的最短路径问题，用 Viterbi 求全局最优：
// 状态 = 某个音的某个候选，转移代价 = 从上一个落点走到这个落点的手部开销。

/// 单音代价值：把「舒适性评分」翻成「代价」。
///
/// 评分越高越舒服，代价反过来。基准取 160——散音满分 150、泛音 130、按音 105，
/// 留一点余量保证任何候选的代价都不为负：负代价等于给 DP 发钱，
/// 它会主动去找最差的落点，只为了把这笔钱赚回来。
const COST_BASE: i32 = 160;

/// 每跨一弦的代价。
///
/// 七根弦张在约 18cm 的琴面上，换弦要抬腕挪臂，比同弦内挪指贵得多。
/// 取 14：比「散 → 按」的技法切换（18）略低，比八度偏差（8）高。
/// 这个比例决定了 DP 在「同弦挪远徽」与「跨两弦找近徽」之间怎么选——
/// 前者累计到 60 分以上时，跨弦反而更便宜，也确实是琴人的实际选择。
const STRING_STEP_COST: i64 = 14;

/// 弦上横向挪动「一个整弦长」的代价（ratio 从 0 到 1）。
///
/// 实际按点范围约 0~0.875（十三徽），所以真实跨度最多约 105 分，
/// 与横跨七弦（98 分）同量级——这正是古琴的实情：从一徽滑到十三徽，
/// 手要走的距离不亚于扫过整个琴面。
const RATIO_STEP_COST: f64 = 120.0;

/// 同一根手指换把的代价。
///
/// 一根手指能无痛覆盖的徽位跨度很小（大指跨两三徽已经勉强），
/// 超出阈值就必然整手挪位。换一根手指只是重新落指，换把却是整只手重来，
/// 所以这一项必须显著高于普通位移，否则 DP 会排出「大指在三四徽之间反复横跳」
/// 这种谱面看着连贯、实际弹不动的指法。
const SAME_FINGER_SHIFT_COST: i64 = 45;
/// 同指无痛覆盖的徽位跨度（ratio）。约合一个徽位。
const SAME_FINGER_SHIFT_RATIO: f64 = 0.12;

/// 技法切换代价：散音要落指（左手从空中下来），按音结束要抬手。
const TECH_SWITCH_COST: i64 = 18;

/// 泛音 ↔ 按音的切换更贵：轻触与按实是两套完全不同的手型，
/// 而且换过来时左手高度、力度、触弦点全要重来。
const HARMONIC_PRESSED_SWITCH_COST: i64 = 36;

/// 同一位置原样重弹的轻微惩罚。
///
/// 不禁止——重弹同一个音（如一弦散音连弹）在琴上完全合法，
/// 但连续两个音落在同一弦同一徽，多数情况说明该用「上/下/进复」走手，
/// 或者该换一处落点。轻轻罚一点，让 DP 在「有更顺的替代」时才挪。
const REPEAT_SAME_SPOT_COST: i64 = 6;

/// 连续散音到第三个以后，每多一个要付的「没走手」费。
///
/// 正调七根空弦恰好是 5 6 1 2 3 5 6——五声音阶的旋律写成简谱后，
/// **每个音都能在空弦上找到**。只按单音舒适度算，`5 6 1 2 3 5 6` 会整句排成
/// 一串散音：音高全对，听着却像在干敲七根弦，没有走手的连贯，也没有吟猱的余地。
///
/// 但散音本身不是错：三个四个散音连起来（琶音、句尾落音）非常常见，
/// 一味躲散音反而把好弹的地方改难。所以前两个散音不罚，从第三个起每多一个
/// 付一笔固定费——真正的门槛出现在**连续五个**：
///
/// 把串中间一个音换成泛音，实测多花约 67：单音舒适度差 31（散 10 → 泛 41），
/// 两端转移各多一次技法切换（18 + 18），再加上一点跨弦。换成按音更贵，
/// 所以 DP 自然优先选泛音。
///
/// 连续 5 个散音罚 3 × 26 = 78 > 67，够断开一处；连续 4 个只罚 52，动不了。
/// 七个全散音的音阶断一次后剩下 4 + 2：再断一次只省 52 < 67，于是停手——
/// 最终只把**一个**音改走泛音，其余六个仍是散音，不会把整句泛音化。
///
/// 实测罚值取 24~30 结果完全一样（都只断一次），这个平台区是**故意**选的：
/// 参数稍有调整，编排不会在「断」与「不断」之间突然翻面。
const SAN_YIN_RUN_COST: i64 = 26;

/// 连续散音状态的封顶值：0 / 1 / 2（2 表示「已经是第二个或更多」）。
///
/// 只需区分到 2：惩罚从第三个散音起每音一笔，再细分状态只会让 DP 变宽，
/// 惩罚值不会变。
const SAN_RUN_CAP: u8 = 2;

/// 走一个音之后，「连续散音」的状态与本次应付的惩罚。
///
/// 与 [`PathStats::longest_open_run`] 同一套判定（`NoteType::SanYin`），
/// 否则界面说「散音连缀缩到 4 个」、算法却在按另一件事优化。
fn san_run_step(is_san_yin: bool, prev_run: u8) -> (u8, i64) {
    if !is_san_yin {
        return (0, 0);
    }
    let next = (prev_run + 1).min(SAN_RUN_CAP);
    let penalty = if prev_run >= SAN_RUN_CAP {
        SAN_YIN_RUN_COST
    } else {
        0
    };
    (next, penalty)
}

/// 「半拍及更短」的时值上限（1/8 拍为单位）：八分 = 4、附点八分 = 6。
const FAST_NOTE_UNITS: u32 = 6;

/// 「一拍半及更长」的时值下限：附点四分 = 12、二分 = 16、全音符 = 32。
const SLOW_NOTE_UNITS: u32 = 12;

/// 气口的判据：前一个音留了**两拍及以上**（二分 = 16、附点二分 = 24、全音符 = 32）。
///
/// 古琴谱上没有「换气记号」，气口是从时值上读出来的：一个音按住两拍，
/// 弹的人一定会把这个音放足、抬手、再落下。于是前后两句之间**没有手位传承**——
/// 上一句最后落在十徽还是二徽，跟下一句从哪起手毫无关系。
///
/// 之前整段当一条路径排，DP 会为了「下一句好接」牺牲这一句内部的舒适：
/// 明明这一句走五徽最顺，却为了跨过气口接到一句起手在九徽的旋律，
/// 把整句往七徽上拽。代价付了，人却不领情——他中间抬手了。
///
/// 取两拍而不是一拍半（[`SLOW_NOTE_UNITS`]）：附点四分常常是句中的伸展，
/// 手不一定离开；两拍才是真正的呼吸。两个阈值各管一件事，不要合并。
const PHRASE_BREATH_UNITS: u32 = 16;

/// 这个音是不是一处气口之后的第一个音（即新乐句的起点）。
///
/// 只看**前一个音的时值**，与本音无关：气口是「上一句放足了」这个动作，
/// 不是「这一句从长音开始」。所以曲首也算起点（前面没有音）。
///
/// 判据必须与 [`time_pressure`] 分开写：那一处描述「手有没有时间做动作」，
/// 这一处描述「手是不是已经离开了琴面」。两件事恰好都跟时值有关，
/// 但阈值故意不同（12 / 16），合并成一个常量会让调一处时另一处跟着漂。
fn starts_phrase(notes: &[JianpuNote], idx: usize) -> bool {
    if idx == 0 {
        return true;
    }
    notes[idx - 1]
        .duration_units
        .is_some_and(|units| units >= PHRASE_BREATH_UNITS)
}

/// 时间紧时的代价倍率：同样的动作，在八分连八分的句子里要贵一半。
const RUSHED_FACTOR: f64 = 1.5;

/// 有气口时的代价倍率：按住一个二分音符，手有的是时间走过去。
const RELAXED_FACTOR: f64 = 0.6;

/// 这个音留给左手多少时间。
///
/// 古琴上「来不来得及换把」几乎完全由**前一个音**的时值决定：八分连八分时，
/// 手没有时间去挪，只能就近落指；一个二分音符按住两拍，整只手足够从三徽走到十徽。
///
/// 原来的代价表对所有相邻音一视同仁，等于假设每个音都一样赶。后果是系统性的：
/// DP 会为了避开一次「其实来得及」的换把，让前后好几个音都待在别扭的位置上——
/// 谱面看着连贯，弹起来却处处别扭。反过来，快句里的换把只被记了轻描淡写的分，
/// 排出来的指法在手上根本来不及。
///
/// 返回值是**位移代价的倍率**：>1 表示时间紧（同样的动作更贵），<1 表示有气口。
/// 没给时值（`None`）按四分音符处理，倍率 1.0，与加这个维度之前完全一致。
fn time_pressure(units: Option<u32>) -> f64 {
    match units {
        Some(units) if units <= FAST_NOTE_UNITS => RUSHED_FACTOR,
        Some(units) if units >= SLOW_NOTE_UNITS => RELAXED_FACTOR,
        _ => 1.0,
    }
}

/// 从一个落点走到另一个落点的手部开销。
///
/// 这里刻意不复用 `context_bonus`：那是贪心用的「加分」，只能看一步；
/// 编排需要的是一个可加的**代价**，才能保证 DP 的最优性成立。
fn transition_cost(prev: &GuqinNote, prev_units: Option<u32>, curr: &GuqinNote) -> i64 {
    let prev_pos = position_from_note(prev);
    let curr_pos = position_from_note(curr);

    let string_gap = i64::from(prev_pos.string.abs_diff(curr_pos.string));
    let mut cost = string_gap * STRING_STEP_COST;

    // 横向位移只在「两边都按在弦上」时成立。
    //
    // 散音的 ratio 记 0（岳山端），若照字面算，「散一弦 → 按七徽」会被记成
    // 挪了半个琴身（60 分），可实际动作只是抬手落指。这一项算错，
    // DP 会系统性地避开所有散音起头的乐句——而散音恰恰是古琴最常用的音。
    let both_stopped = prev.note_type != NoteType::SanYin && curr.note_type != NoteType::SanYin;

    if both_stopped {
        let ratio_gap = (prev_pos.ratio - curr_pos.ratio).abs();
        cost += (ratio_gap * RATIO_STEP_COST).round() as i64;

        if let (Some(a), Some(b)) = (prev.left_finger, curr.left_finger)
            && a == b
            && ratio_gap > SAME_FINGER_SHIFT_RATIO
        {
            cost += SAME_FINGER_SHIFT_COST;
        }
    } else if prev.note_type == NoteType::SanYin
        && curr.note_type == NoteType::SanYin
        && string_gap == 0
    {
        // 同一根空弦连弹：位置没动，记一笔轻罚（见 REPEAT_SAME_SPOT_COST）
        cost += REPEAT_SAME_SPOT_COST;
    }

    cost += match (prev.note_type, curr.note_type) {
        (a, b) if a == b => 0,
        (NoteType::FanYin, NoteType::AnYin) | (NoteType::AnYin, NoteType::FanYin) => {
            HARMONIC_PRESSED_SWITCH_COST
        }
        _ => TECH_SWITCH_COST,
    };

    // 同弦同徽同技法：原样重弹
    if both_stopped
        && prev.note_type == curr.note_type
        && string_gap == 0
        && (prev_pos.ratio - curr_pos.ratio).abs() < 0.01
    {
        cost += REPEAT_SAME_SPOT_COST;
    }

    // 最后再按「前一个音留了多少时间」缩放整体开销。
    //
    // 放在最后乘、而不是给每一项单独乘：这个倍率描述的是「手有没有时间做这一整套动作」，
    // 换弦、挪徽、抬手落指都在这段时间里完成，没有哪一项能免票。
    (cost as f64 * time_pressure(prev_units)).round() as i64
}

/// 一条指法路径的「活动量」——用来把编排的效果说成人话。
///
/// 只统计**琴人能直接感觉到**的四件事：换弦、同指挪位（整只手要动）、技法切换、
/// 以及「快句里还硬要换手」这种听着就手忙脚乱的地方。
/// 刻意不报总代价：那是个抽象分数，涨了跌了对弹琴的人没有意义。
/// 用户要的是「这一版手少跑几趟」，不是「代价从 1234 降到 1102」。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct PathStats {
    /// 换弦次数（相邻两音弦序不同）。
    pub string_changes: u32,
    /// 同指挪位：同一根手指跨过阈值，手必须整只移动。
    pub finger_shifts: u32,
    /// 技法切换次数（散 / 泛 / 按 之间切换）。
    pub technique_switches: u32,
    /// 赶不上的换手：前一个音是八分或更短，手却要换弦或挪位。
    ///
    /// 这个数比「换弦次数」更贴近琴人的抱怨。同一段谱里换三次弦，
    /// 落在二分音符之间叫从容，落在十六分连奏里叫弹不出来。
    pub rushed_moves: u32,
    /// 最长的一串连续散音有几个音（没有散音时为 0）。
    ///
    /// 散音连着四五个以上，听着就是一路空弦「干敲」：每根弦音色不同、
    /// 音与音之间没有走手相连。编排会把这串散音断开一处改走按音/泛音，
    /// 这个数就是界面上「最长一串散音从 7 个缩到 3 个」的来源——
    /// 只有它真的变小了，才该说编排改善了音色连贯。
    pub longest_open_run: u32,
}

/// 这两个落点之间，手是不是真的要移动。
///
/// 换弦当然算；同一根弦上的横向移动要超过 [`SAME_FINGER_SHIFT_RATIO`] 才算——
/// 一两分的徽位微调是「走手」，手指自己就够，谈不上整只手要跑。
fn position_moved(prev: &GuqinNote, curr: &GuqinNote) -> bool {
    let prev_pos = position_from_note(prev);
    let curr_pos = position_from_note(curr);
    if prev_pos.string != curr_pos.string {
        return true;
    }
    let both_stopped = prev.note_type != NoteType::SanYin && curr.note_type != NoteType::SanYin;
    both_stopped && (prev_pos.ratio - curr_pos.ratio).abs() > SAME_FINGER_SHIFT_RATIO
}

/// 统计一条已定的音序的活动量。
///
/// 每项都带上对应简谱音的时值，`rushed_moves` 才知道「当时手上有多少时间」。
///
/// 判定条件必须与 [`transition_cost`] 里的完全一致，否则「省了几次换弦」
/// 会跟算法实际优化的目标对不上——界面说省了三次，实际是另一件事。
fn path_stats(notes: &[(Option<u32>, GuqinNote)]) -> PathStats {
    let mut stats = PathStats::default();

    // 连续散音要正着扫一遍：它不是「相邻两音」的属性，而是一段长度，
    // 用 windows(2) 数不出来（三个散音只有两次转移，长度却是 3）。
    //
    // 跨气口要重新起算：二分音符放足之后抬手再落，两个散音之间隔着一次呼吸，
    // 听起来不是「一路空弦干敲」。这与 DP 在气口处把串长归零是同一套判定，
    // 否则界面报的串长和算法优化的不是一件事。
    let mut run = 0u32;
    for (idx, (_, note)) in notes.iter().enumerate() {
        if idx > 0
            && notes[idx - 1]
                .0
                .is_some_and(|units| units >= PHRASE_BREATH_UNITS)
        {
            run = 0;
        }
        if note.note_type == NoteType::SanYin {
            run += 1;
            stats.longest_open_run = stats.longest_open_run.max(run);
        } else {
            run = 0;
        }
    }

    for pair in notes.windows(2) {
        let (prev_units, prev) = (&pair[0].0, &pair[0].1);
        let curr = &pair[1].1;
        let prev_pos = position_from_note(prev);
        let curr_pos = position_from_note(curr);

        if prev_pos.string != curr_pos.string {
            stats.string_changes += 1;
        }
        if prev.note_type != curr.note_type {
            stats.technique_switches += 1;
        }

        let both_stopped = prev.note_type != NoteType::SanYin && curr.note_type != NoteType::SanYin;
        if both_stopped
            && let (Some(a), Some(b)) = (prev.left_finger, curr.left_finger)
            && a == b
            && (prev_pos.ratio - curr_pos.ratio).abs() > SAME_FINGER_SHIFT_RATIO
        {
            stats.finger_shifts += 1;
        }

        // 「急处换手」的判定：与代价表同一个倍率来源，否则统计和优化各说各话。
        if time_pressure(*prev_units) > 1.0 && position_moved(prev, curr) {
            stats.rushed_moves += 1;
        }
    }
    stats
}

/// 某个音的全部候选，在三种「连续散音状态」下各自的最小代价。
///
/// 外层按候选下标索引，内层按状态（0 / 1 / 2）索引，`None` 表示该状态无路可达。
type RunCostRow = Vec<[Option<i64>; 3]>;

/// 回溯表：对每个候选、每个状态，记下「从哪个状态、哪个候选走过来」。
type RunBackRow = Vec<[Option<(u8, usize)>; 3]>;

/// 一行里代价最小的那个落点（连同它处在哪个散音串状态）。
///
/// 一句的终点没有「下一个音」来约束它，所以只能自己挑最小的；
/// `None` 表示这一行没有任何可达状态（理论上不会发生）。
fn row_min(rows: &RunCostRow) -> Option<(i64, u8, usize)> {
    let mut best: Option<(i64, u8, usize)> = None;
    for (j, row) in rows.iter().enumerate() {
        for (state, cost) in row.iter().enumerate() {
            let Some(cost) = *cost else { continue };
            if best.is_none_or(|(b, _, _)| cost < b) {
                best = Some((cost, state as u8, j));
            }
        }
    }
    best
}

/// 一个乐句的编排结果。
///
/// 长曲一句一句地练，是琴人真实的工作方式：整首弹不下来的地方，永远是某一句。
/// 所以编排不只报「全曲省了几次换手」，还要报**每一句各自的账**——
/// 否则用户看着一个漂亮的总数，回到琴上仍不知道从哪一句开始练。
///
/// `start` / `end` 是**传进 `arrange_sequence` 的那个数组**的下标（含两端）。
/// 前端若把休止符滤掉再送进来，就要自己把它映射回带休止符的行号；
/// 这里不做猜测——猜错一步，整行音符都会错位。
#[derive(Debug, Clone, serde::Serialize)]
pub struct PhraseSpan {
    /// 第几句（0 起）。
    pub index: usize,
    /// 起始音下标（含）。
    pub start: usize,
    /// 结束音下标（含）。
    pub end: usize,
    /// 这一句有几个音（含排不出落点的音——它仍占谱面一行）。
    pub note_count: usize,
    /// 这一句内部的活动量。跨气口的那次转移不算进任何一句。
    pub stats: PathStats,
}

/// 全局编排结果。
#[derive(Debug, Clone, serde::Serialize)]
pub struct Arrangement {
    /// 每个音按「整句代价」整理过的候选（被选中的那一个恒排首位）。
    ///
    /// 与 [`Arrangement::selections`]**同源**：两个字段来自同一次计算，
    /// 前端照单全收即可，不需要按索引去猜另一份数据。
    pub candidates_per_note: Vec<Vec<JianziCandidate>>,
    /// 每个音选中的候选下标（指向 `candidates_per_note` 的同一位置）。
    /// 该音在琴上找不到合法落点时为空（`None`），前端据此保留简谱、减字留空。
    pub selections: Vec<Option<usize>>,
    /// 整条路径的总代价，越小越顺。没有可编排的音时为 0。
    pub total_cost: i64,
    /// 编排结果的活动量。
    pub stats: PathStats,
    /// 同一段简谱改用「逐音取第一名」时的活动量，作为对照。
    pub greedy_stats: PathStats,
    /// 按气口切出来的乐句，逐句报账。
    ///
    /// 全曲只有一句时也照常返回一条（整段就是一句），前端据此判断
    /// 「这首短得没必要分句」——返回空数组会让人分不清「没分句」和「没算」。
    pub phrases: Vec<PhraseSpan>,
    /// 编排结果与逐音挑选是否**完全一样**（每个音的落点都相同）。
    ///
    /// 这个字段是给界面说真话用的：短句或本来就很顺的旋律，全局最优可能就是
    /// 逐音最优，这时候不该编一句「已优化」来邀功。
    pub identical_to_greedy: bool,
}

/// 为整段简谱求出全局最连贯的一套指法。
///
/// 与 [`translate_jianpu_sequence`] 的区别：那一版逐音贪心，这一版把整句当成
/// 一条路径求全局最优。差别在长句上非常明显——贪心常在第一音就锁死了一个
/// 舒服但孤立的位置，后面每个音都在补偿；全局编排会牺牲一点单音舒适度，
/// 换来整句少换把、少跨弦。
///
/// 「整句」是按气口切的（见 [`starts_phrase`]）：一处气口就是一次抬手，
/// 前后没有手位传承，所以优化在气口处**重新开始**，同时按句报账
/// （[`Arrangement::phrases`]）。没有气口的短句等价于整段一条路径，
/// 与加这个维度之前完全一样。
///
/// 复杂度 O(n·k²)：n 是音数，k 是单音候选数（通常 10~40）。
/// 一首三百音的曲子约几十万次比较，毫秒级，可以在按键时同步跑。
pub fn arrange_sequence(notes: &[JianpuNote], tuning: Tuning) -> Arrangement {
    // 候选只按单音评分生成一次，**不**走 `translate_jianpu_sequence`：
    // 那一版会把「上一个音的贪心选择」折进每个候选的分里，再拿它当 DP 的基代价，
    // 等于把局部偏见烧进全局最优——同一个音被前后夹击算两遍，结果既不是贪心也不是最优。
    let mut candidates_per_note: Vec<Vec<JianziCandidate>> =
        notes.iter().map(|n| translate_jianpu(*n, tuning)).collect();

    // 状态 = (某个候选, 连续散音进度)。多这一维是为了认出「散音串得太长」：
    // 这件事不是相邻两音的性质，只看转移算不出来，必须把「已经连了几个」带在状态里。
    let mut dp: Vec<RunCostRow> = Vec::with_capacity(notes.len());
    let mut prev_choice: Vec<RunBackRow> = Vec::with_capacity(notes.len());

    // 上一个**非空**候选行。某个音在琴上无合法落点时，这个音不该切断整句的连贯性，
    // 而应被跳过——后面那个音仍然要跟「最近一个真的弹得出来的音」比较手位。
    // 散音的连续计数同理：跳过的音不算「换了口气」，串长原样带过去。
    let mut last_row: Option<RunCostRow> = None;
    let mut last_notes: Option<Vec<GuqinNote>> = None;
    // 上一个非空行的时值。同一个音的每个候选时值相同，所以只存一份，
    // 不必跟 `last_notes` 一一配对。
    let mut last_units: Option<u32> = None;

    for (note_idx, candidates) in candidates_per_note.iter().enumerate() {
        if candidates.is_empty() {
            dp.push(Vec::new());
            prev_choice.push(Vec::new());
            continue;
        }
        let units = notes[note_idx].duration_units;
        // 气口之后是新的一句：不接上一句的手位，也不接着数上一句的散音串。
        // 一句之内的接续仍然照常计费，所以「整段最优」退化成「逐句最优」，
        // 而不是退化成「逐音最优」——句内的取舍一分都没少。
        let new_phrase = starts_phrase(notes, note_idx);

        let mut rows: RunCostRow = Vec::with_capacity(candidates.len());
        let mut backs: RunBackRow = Vec::with_capacity(candidates.len());

        for candidate in candidates {
            // 分数高于基准时（理论上不该发生）夹到 0，避免负代价
            let base = i64::from((COST_BASE - candidate.score).max(0));
            let is_san = candidate.note.note_type == NoteType::SanYin;

            let mut row = [None; 3];
            let mut back = [None; 3];

            // 这个候选能落到哪些「连续散音状态」上：非散音只会把计数归零；
            // 散音则取决于上一个音已经连了几个（0 → 1，1 或 2 → 2）。
            let reachable: &[u8] = if is_san { &[1, 2] } else { &[0] };
            for &state in reachable {
                match (&last_row, &last_notes) {
                    (Some(row_prev), Some(notes_prev)) if !new_phrase => {
                        let mut best: Option<(i64, (u8, usize))> = None;
                        for (k, prev_note) in notes_prev.iter().enumerate() {
                            for (prev_state_idx, prev_cost) in row_prev[k].iter().enumerate() {
                                let Some(prev_cost) = *prev_cost else {
                                    continue;
                                };
                                let prev_state = prev_state_idx as u8;
                                let (next_state, run_penalty) = san_run_step(is_san, prev_state);
                                if next_state != state {
                                    continue;
                                }
                                let total = prev_cost
                                    + transition_cost(prev_note, last_units, &candidate.note)
                                    + run_penalty;
                                if best.is_none_or(|(b, _)| total < b) {
                                    best = Some((total, (prev_state, k)));
                                }
                            }
                        }
                        // 某个状态可能**无路可达**：上一个音是散音时，「连了 0 个」这个状态
                        // 根本不存在，那么当前散音就不可能落到「刚好第 1 个」。
                        // 这不是错误，记 None 即可——每个候选至少有一个可达状态
                        // （非散音恒可从任意状态回到 0，散音恒可续成 2）。
                        if let Some((cost, from)) = best {
                            row[state as usize] = Some(cost + base);
                            back[state as usize] = Some(from);
                        }
                    }
                    _ => {
                        // 首音或**气口之后的第一个音**：没有来路。
                        // 气口处不接上一句的手位，是因为弹的人已经抬手换过气了，
                        // 上一句落在哪跟他这一句从哪起手无关；硬接过去会让 DP
                        // 为了一个不存在的手位约束，把整句往不合适的地方拽。
                        //
                        // `san_run_step(_, 0)` 的罚恒为 0，这里只是照常走一遍。
                        let (first_state, run_penalty) = san_run_step(is_san, 0);
                        if first_state == state {
                            row[state as usize] = Some(base + run_penalty);
                            back[state as usize] = None;
                        }
                    }
                }
            }

            rows.push(row);
            backs.push(back);
        }

        last_row = Some(rows.clone());
        last_notes = Some(candidates.iter().map(|c| c.note.clone()).collect());
        last_units = units;
        dp.push(rows);
        prev_choice.push(backs);
    }

    let mut selections: Vec<Option<usize>> = vec![None; notes.len()];
    let mut total_cost: i64 = 0;

    // 从最后一行为起点回溯：末音代价最小的那条（连同它的散音串状态），
    // 就是最后一句最优路径的终点。
    //
    // 分句之后回溯要能**跨过气口**：气口那一行的 `back` 是 `None`（它没有来路），
    // 若照旧 `break`，前面几句就全成了空选。所以遇到 `None` 不是结束，
    // 而是「上一句到这儿为止」——回头在上一句的末行里另取一个最小值，
    // 把那一句的最优配直接接上。
    if let Some(last_i) = dp.iter().rposition(|row| !row.is_empty()) {
        let (cost, mut cursor_state, mut cursor_j) =
            row_min(&dp[last_i]).expect("非空行必然至少有一个可达状态");
        total_cost = cost;

        let mut cursor_row = last_i;
        loop {
            selections[cursor_row] = Some(cursor_j);
            let Some((prev_state, prev_j)) =
                prev_choice[cursor_row][cursor_j][cursor_state as usize]
            else {
                // 这一句到头了（曲首，或刚跨过一处气口）。找上一句的末行。
                let Some(p) = (0..cursor_row).rev().find(|&p| !dp[p].is_empty()) else {
                    break;
                };
                let (cost, state, j) = row_min(&dp[p]).expect("非空行必然至少有一个可达状态");
                total_cost += cost;
                cursor_row = p;
                cursor_j = j;
                cursor_state = state;
                continue;
            };
            // 跳过中间的空候选行，落到最近一个真的非空的行
            let mut p = cursor_row;
            while p > 0 {
                p -= 1;
                if !dp[p].is_empty() {
                    break;
                }
            }
            if p == cursor_row || dp[p].is_empty() {
                break;
            }
            cursor_row = p;
            cursor_j = prev_j;
            cursor_state = prev_state;
        }
    }

    // 贪心基线：每个音都取自己单音评分第一名的那个落点。
    //
    // 必须在重排之前取——重排会把 DP 选中的候选挪到首位，之后再取就成了
    // 「拿编排结果当自己的对照组」，差值永远为零。
    // 必须带上每个音的时值才算得出「急处换手」，所以这里是 (时值, 落点) 配对，
    // 而不是光秃秃的 GuqinNote。
    let greedy_notes: Vec<(Option<u32>, GuqinNote)> = candidates_per_note
        .iter()
        .enumerate()
        .filter_map(|(i, cands)| {
            cands
                .first()
                .map(|c| (notes[i].duration_units, c.note.clone()))
        })
        .collect();

    // 编排路径本身（顺序与 greedy_notes 相同：都跳过没落点的音）。
    // 同样在重排前取，此时 selections 还是原始候选下标，语义最直白。
    let arranged_notes: Vec<(Option<u32>, GuqinNote)> = selections
        .iter()
        .enumerate()
        .filter_map(|(i, sel)| {
            sel.map(|j| {
                (
                    notes[i].duration_units,
                    candidates_per_note[i][j].note.clone(),
                )
            })
        })
        .collect();

    // 逐句报账。切片按**原始下标**切，句内只保留真的排得出落点的音——
    // 排不出落点的音在谱面上留空，不该被当成「这一句少了一个音」，
    // 但它两头也不构成转移（转移要两个真的能弹的音）。
    let phrase_starts: Vec<usize> = (0..notes.len())
        .filter(|&i| starts_phrase(notes, i))
        .collect();
    let phrases: Vec<PhraseSpan> = phrase_starts
        .iter()
        .enumerate()
        .map(|(index, &start)| {
            let end = phrase_starts
                .get(index + 1)
                .map_or(notes.len() - 1, |&next| next - 1);
            let path: Vec<(Option<u32>, GuqinNote)> = (start..=end)
                .filter_map(|i| {
                    selections[i].map(|j| {
                        (
                            notes[i].duration_units,
                            candidates_per_note[i][j].note.clone(),
                        )
                    })
                })
                .collect();
            PhraseSpan {
                index,
                start,
                end,
                note_count: end - start + 1,
                stats: path_stats(&path),
            }
        })
        .collect();

    // 把选中的候选提到首位，其余保持单音评分顺序。
    //
    // 不整体按 dp 值重排：那样「150 分」会排在「90 分」后面，
    // 用户盯着卡片上的分数会觉得排序坏了——位置应该说明「这条路径选了它」，
    // 分数说明「单看这个音它多舒服」，两件事不能混在一个序号里。
    for (i, row) in dp.iter().enumerate() {
        let Some(chosen) = selections[i] else {
            continue;
        };
        if row.is_empty() || chosen == 0 || chosen >= candidates_per_note[i].len() {
            continue;
        }
        let picked = candidates_per_note[i].remove(chosen);
        candidates_per_note[i].insert(0, picked);
        selections[i] = Some(0);
    }

    Arrangement {
        stats: path_stats(&arranged_notes),
        greedy_stats: path_stats(&greedy_notes),
        identical_to_greedy: arranged_notes == greedy_notes,
        phrases,
        candidates_per_note,
        selections,
        total_cost,
    }
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
        // 1=F2（三弦为宫）：一弦 C2 落在低八度（5,），三弦 F2 就是 1。
        assert_eq!(midi_note(Pitch::new(5, -1)), 36.0); // 一弦 C2
        assert_eq!(midi_note(Pitch::new(1, 0)), 41.0); // 三弦 F2
        assert_eq!(midi_note(Pitch::new(5, 0)), 48.0); // 六弦 C3
        assert_eq!(midi_note(Pitch::new(6, 0)), 50.0); // 七弦 D3
        assert_eq!(midi_note(Pitch::new(4, 0)), 46.0); // 蕤宾调五弦 B♭2
        assert_eq!(midi_note(Pitch::new(7, -1)), 40.0); // 慢角调三弦 E2
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

    // ── 全局编排 ──────────────────────────────

    /// 贪心路径（每个音都取自己单音评分第一名的那个落点）的总代价。
    ///
    /// 这是 DP 的对照组：全局最优的定义就是「不可能比任何一条合法路径更差」，
    /// 所以这条断言一旦失败，说明 DP 的转移或回溯写错了——不是算法不够聪明。
    fn greedy_path_cost(notes: &[JianpuNote], tuning: Tuning) -> i64 {
        let mut total = 0i64;
        let mut prev: Option<(Option<u32>, GuqinNote)> = None;
        // 贪心基线必须与 DP 用**同一套目标函数**：散音串的惩罚也得算进去，
        // 否则「编排不比贪心差」就成了拿两把尺子量同一件事。
        // 气口同样要断：DP 在那一处不接上一句的手位，贪心若照接，
        // 基线就凭空贵了一截，胜出成了假象。
        let mut run = 0u8;
        for (idx, note) in notes.iter().enumerate() {
            let Some(best) = translate_jianpu(*note, tuning).into_iter().next() else {
                continue;
            };
            total += i64::from((COST_BASE - best.score).max(0));
            let breath = starts_phrase(notes, idx);
            if breath {
                run = 0;
            }
            let (next_run, run_penalty) =
                san_run_step(best.note.note_type == NoteType::SanYin, run);
            run = next_run;
            total += run_penalty;
            if let (Some((units, p)), false) = (&prev, breath) {
                total += transition_cost(p, *units, &best.note);
            }
            prev = Some((note.duration_units, best.note));
        }
        total
    }

    /// 供编排测试复用的几段代表性乐句。
    fn sample_melodies() -> Vec<Vec<JianpuNote>> {
        vec![
            // 五声音阶上下行（最典型的练习曲）
            vec![
                JianpuNote::new(5, 0),
                JianpuNote::new(6, 0),
                JianpuNote::new(1, 1),
                JianpuNote::new(2, 1),
                JianpuNote::new(3, 1),
                JianpuNote::new(5, 1),
                JianpuNote::new(6, 1),
                JianpuNote::new(5, 1),
                JianpuNote::new(3, 1),
                JianpuNote::new(2, 1),
                JianpuNote::new(1, 1),
                JianpuNote::new(6, 0),
            ],
            // 同音反复（考验「重弹还是走手」的判断）
            vec![JianpuNote::new(5, 0); 6],
            // 大幅跳进（考验跨弦与换把的取舍）
            vec![
                JianpuNote::new(5, -1),
                JianpuNote::new(5, 2),
                JianpuNote::new(6, -1),
                JianpuNote::new(1, 1),
                JianpuNote::new(3, 2),
                JianpuNote::new(2, 0),
            ],
            // 单音
            vec![JianpuNote::new(1, 1)],
        ]
    }

    #[test]
    fn test_arrange_never_worse_than_greedy() {
        let mut strictly_better = 0;
        for melody in sample_melodies() {
            for tuning in [Tuning::ZhengDiao, Tuning::RuiBin, Tuning::ManJiao] {
                let arranged = arrange_sequence(&melody, tuning);
                let greedy = greedy_path_cost(&melody, tuning);
                assert!(
                    arranged.total_cost <= greedy,
                    "全局编排（{}）不该比贪心（{}）更差：{:?} / {:?}",
                    arranged.total_cost,
                    greedy,
                    melody,
                    tuning
                );
                if arranged.total_cost < greedy {
                    strictly_better += 1;
                    // 代价严格更小必然意味着换了落点；若这里报 false，
                    // 说明 identical 判定取错了路径（比如拿重排后的候选去比）。
                    assert!(
                        !arranged.identical_to_greedy,
                        "代价更小却报告「与逐音挑选一致」：{:?} / {:?}",
                        melody, tuning
                    );
                }
            }
        }
        // 只会「≤」还不够：如果转移代价没真正参与打分（比如恒为 0、或 DP 退化成
        // 逐音取第一名），这条断言就能把「看起来接上了、其实没生效」的实现挡下来。
        assert!(
            strictly_better > 0,
            "DP 在所有用例上都没优于贪心，说明转移代价没生效"
        );
    }

    #[test]
    fn test_arrange_returns_one_selection_per_note() {
        for melody in sample_melodies() {
            let arranged = arrange_sequence(&melody, Tuning::ZhengDiao);
            assert_eq!(arranged.selections.len(), melody.len());
            assert_eq!(arranged.candidates_per_note.len(), melody.len());
        }
    }

    /// `selections` 必须与 `candidates_per_note` 同源：选中的那个恒排在首位。
    ///
    /// 前端拿到这份数据就直接 setState，不会再按索引二次查找。
    /// 一旦「选中的在首位」这个不变量破了，谱面上会静默换成另一个落点——
    /// 字看着正常，弹出来是别的音。
    #[test]
    fn test_arrange_promotes_selected_to_front() {
        for melody in sample_melodies() {
            for tuning in [Tuning::ZhengDiao, Tuning::RuiBin, Tuning::ManJiao] {
                let arranged = arrange_sequence(&melody, tuning);
                for (i, selection) in arranged.selections.iter().enumerate() {
                    match selection {
                        Some(idx) => assert_eq!(*idx, 0, "第 {} 音被选中的候选应排首位", i),
                        None => assert!(
                            arranged.candidates_per_note[i].is_empty(),
                            "第 {} 音没有选中项，候选列表却非空",
                            i
                        ),
                    }
                }
            }
        }
    }

    /// 编排选出的每个落点，实际音级都必须等于该音的目标音级。
    ///
    /// 这条防的是「DP 只优化代价、不校验音高」——那样排出来的谱会很顺，
    /// 但音全错了。所有候选都来自 `translate_jianpu`，理论上天然成立，
    /// 但重排（把选中项提首位）时一旦下标错位，就会出现这种灾难性错误。
    #[test]
    fn test_arrange_selected_notes_match_target_pitch() {
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

        for melody in sample_melodies() {
            for tuning in [Tuning::ZhengDiao, Tuning::RuiBin, Tuning::ManJiao] {
                let arranged = arrange_sequence(&melody, tuning);
                for (i, selection) in arranged.selections.iter().enumerate() {
                    let Some(idx) = selection else { continue };
                    let note = &arranged.candidates_per_note[i][*idx].note;
                    let actual = note_pitch(note, tuning).expect("候选应算得出音高");
                    assert_eq!(
                        actual.number, melody[i].number,
                        "第 {} 音的落点音级不对：{:?}",
                        i, note
                    );
                }
            }
        }
    }

    #[test]
    fn test_arrange_empty_input() {
        let arranged = arrange_sequence(&[], Tuning::ZhengDiao);
        assert!(arranged.selections.is_empty());
        assert!(arranged.candidates_per_note.is_empty());
        assert_eq!(arranged.total_cost, 0);
    }

    /// 长乐句不该被拆断：每个音都要给出选中项。
    #[test]
    fn test_arrange_covers_every_note_in_a_phrase() {
        let melody: Vec<JianpuNote> = [5u8, 6, 1, 2, 3, 5, 6]
            .iter()
            .map(|&n| JianpuNote::new(n, 1))
            .collect();
        let arranged = arrange_sequence(&melody, Tuning::ZhengDiao);
        assert!(
            arranged.selections.iter().all(Option::is_some),
            "五声音阶七个音都该有落点：{:?}",
            arranged.selections
        );
    }

    /// 连续相同的音，编排不该让手在两处落点之间来回横跳。
    ///
    /// 允许「同位置重弹」（这是合法的），但不接受「A → B → A → B」——
    /// 那说明 DP 只算了单音代价，没把回到原位的开销算进去。
    #[test]
    fn test_arrange_avoids_ping_pong_on_repeated_note() {
        let melody = [JianpuNote::new(5, 0); 4];
        let arranged = arrange_sequence(&melody, Tuning::ZhengDiao);
        // 选中项恒在首位（见 test_arrange_promotes_selected_to_front）
        let strings: Vec<u8> = arranged
            .candidates_per_note
            .iter()
            .map(|cands| cands[0].note.string_number.get())
            .collect();
        assert!(
            strings.windows(2).all(|w| w[0] == w[1]),
            "同音反复不该换弦横跳：{:?}",
            strings
        );
    }

    // ── 散音连缀（别把整句排成一串空弦） ──────────────

    /// 正调下 5 6 1 2 3 5 6 恰好全是空弦音——这正是「整句排成空弦」最容易发生的形状。
    ///
    /// 逐音挑第一名会一个不落地选散音（散音单音分最高），编排则必须认出
    /// 「这串太长了」，拿一个泛音把它断开——只断一次：把六个音全改成泛音
    /// 是另一种极端，比一串空弦更像机器排的。
    #[test]
    fn test_arrange_breaks_long_open_string_run() {
        let melody: Vec<JianpuNote> = [(5, 0), (6, 0), (1, 1), (2, 1), (3, 1), (5, 1), (6, 1)]
            .into_iter()
            .map(|(number, octave)| JianpuNote::new(number, octave))
            .collect();

        // 前提：这段谱逐音挑第一名确实是一串散音，否则这条测试测不到东西。
        assert_eq!(
            arrange_sequence(&melody, Tuning::ZhengDiao)
                .greedy_stats
                .longest_open_run,
            7,
            "测试前提不成立：这段音阶没有被逐音挑选排成 7 个散音"
        );

        let arranged = arrange_sequence(&melody, Tuning::ZhengDiao);
        assert!(
            arranged.stats.longest_open_run <= 4,
            "7 个连续散音应该被断开，实际仍是最长 {} 个",
            arranged.stats.longest_open_run
        );
        // 只改一个音：7 个音里恰好 1 个不是散音（断一次 = 两次技法切换）。
        let non_open = arranged
            .candidates_per_note
            .iter()
            .filter(|c| c[0].note.note_type != NoteType::SanYin)
            .count();
        assert_eq!(
            non_open, 1,
            "断一次就够了，不该把整句泛音化（实际改了 {} 个音）",
            non_open
        );
    }

    /// 四个连续散音仍在「像话」的范围里：琶音、句尾落音都长这样。
    ///
    /// 编排不该为了走手而硬换泛音——那会把本来好弹的地方改难。
    /// 门槛在连续五个：5 个散音罚 3 × 26 = 78，超过插一个泛音的约 67；
    /// 4 个只罚 52，够不着。
    #[test]
    fn test_arrange_keeps_short_open_string_run() {
        let melody: Vec<JianpuNote> = [(5, 0), (6, 0), (5, 0), (6, 0)]
            .into_iter()
            .map(|(number, octave)| JianpuNote::new(number, octave))
            .collect();
        let arranged = arrange_sequence(&melody, Tuning::ZhengDiao);
        assert_eq!(
            arranged.stats.longest_open_run,
            4,
            "四个连续散音不该被拆：{:?}",
            arranged
                .candidates_per_note
                .iter()
                .map(|c| c[0].note.note_type)
                .collect::<Vec<_>>()
        );
    }

    /// 统计口径：串长按音数算，不按转移数算。
    #[test]
    fn test_path_stats_reports_longest_open_run() {
        let san = |string: u8| {
            GuqinNote::open_string(
                RightAction::Tiao,
                StringNumber::new(string).expect("弦序 1..=7"),
            )
        };
        let pressed = GuqinNote::pressed(
            LeftFinger::Da,
            HuiPosition {
                hui: Hui::new(7).expect("七徽"),
                fen: None,
            },
            RightAction::Tiao,
            StringNumber::new(3).expect("三弦"),
        );

        // 散 散 散 按 散 散 → 最长一串 3（三个散音只有两次转移，按转移数会少算一个）
        let path: Vec<(Option<u32>, GuqinNote)> = vec![
            (None, san(1)),
            (None, san(2)),
            (None, san(3)),
            (None, pressed.clone()),
            (None, san(5)),
            (None, san(6)),
        ];
        assert_eq!(path_stats(&path).longest_open_run, 3);

        // 全按音没有散音串
        let stopped: Vec<(Option<u32>, GuqinNote)> = vec![(None, pressed.clone()), (None, pressed)];
        assert_eq!(path_stats(&stopped).longest_open_run, 0);
    }

    // ── 活动量统计（界面上的「省了几次换弦」） ──────────

    #[test]
    fn test_path_stats_counts_what_it_says() {
        let note = |string: u8| {
            GuqinNote::open_string(
                RightAction::Tiao,
                StringNumber::new(string).expect("弦序 1..=7"),
            )
        };
        // 一弦 → 三弦：换一次弦，都是散音，没有按点
        let stats = path_stats(&[(None, note(1)), (None, note(3))]);
        assert_eq!(stats.string_changes, 1);
        assert_eq!(stats.technique_switches, 0);
        assert_eq!(stats.finger_shifts, 0);
        // 没给时值时按四分音符算，不算「急处换手」
        assert_eq!(stats.rushed_moves, 0);

        // 同一根弦连弹：换弦 / 挪手 / 换手都不算——但仍是一串两个散音
        let same = path_stats(&[(None, note(2)), (None, note(2))]);
        assert_eq!(
            same,
            PathStats {
                longest_open_run: 2,
                ..PathStats::default()
            }
        );
    }

    /// 八分连八分里换弦 = 急处换手；同样的两个音挪到二分音符之间就不算。
    ///
    /// 这条是「时间维度」的最小可验证断言：同样一次换弦，时值不同，
    /// 在统计里必须是两种事实。
    #[test]
    fn test_path_stats_flags_rushed_moves_by_duration() {
        let note = |string: u8| {
            GuqinNote::open_string(
                RightAction::Tiao,
                StringNumber::new(string).expect("弦序 1..=7"),
            )
        };
        // 八分 = 4 单位（半拍）
        let rushed = path_stats(&[(Some(4), note(1)), (Some(4), note(3))]);
        assert_eq!(rushed.string_changes, 1);
        assert_eq!(rushed.rushed_moves, 1, "半拍之内换弦，手来不及");

        // 二分 = 16 单位（两拍），同样的换弦从容得很
        let relaxed = path_stats(&[(Some(16), note(1)), (Some(16), note(3))]);
        assert_eq!(relaxed.string_changes, 1);
        assert_eq!(relaxed.rushed_moves, 0);

        // 同一根弦上原地重弹，不算「换手」
        let still = path_stats(&[(Some(4), note(2)), (Some(4), note(2))]);
        assert_eq!(still.rushed_moves, 0);

        // 不换弦但整只手要挪（七徽 → 九徽，同一根手指），同样算急处换手
        let pressed = |hui: u8| {
            GuqinNote::pressed(
                LeftFinger::Da,
                HuiPosition {
                    hui: Hui::new(hui).expect("徽位 1..=13"),
                    fen: None,
                },
                RightAction::Gou,
                StringNumber::new(1).expect("弦序 1..=7"),
            )
        };
        let slide = path_stats(&[(Some(2), pressed(7)), (Some(2), pressed(9))]);
        assert_eq!(slide.string_changes, 0, "没换弦");
        assert_eq!(slide.rushed_moves, 1, "十六分里整手从七徽挪到九徽，来不及");
    }

    /// 时值确实参与代价：同一个转移，前一个音越短，代价越高。
    ///
    /// 不验证具体倍数（那是调参），只验证**方向**与单调性——
    /// 这条一旦反了，整个「快句不换把」的假设就是假的。
    #[test]
    fn test_transition_cost_scales_with_previous_duration() {
        let from =
            GuqinNote::open_string(RightAction::Tiao, StringNumber::new(1).expect("弦序 1..=7"));
        let to =
            GuqinNote::open_string(RightAction::Tiao, StringNumber::new(4).expect("弦序 1..=7"));

        let fast = transition_cost(&from, Some(2), &to);
        let normal = transition_cost(&from, Some(8), &to);
        let slow = transition_cost(&from, Some(32), &to);
        let unspecified = transition_cost(&from, None, &to);

        assert!(fast > normal, "十六分里跨三根弦该更贵：{fast} vs {normal}");
        assert!(
            slow < normal,
            "全音符后跨三根弦该更便宜：{slow} vs {normal}"
        );
        assert_eq!(
            unspecified, normal,
            "没给时值必须与四分音符完全等价，否则老调用方的结果会悄悄变"
        );
    }

    /// 时值真的走到了 DP 里，没有在 JSON 边界上被静默丢掉。
    ///
    /// 只断言「两次结果不同」和「不给时值等价于四分音符」：
    /// 具体差多少是调参，写死数字会让每次调阈值都红一遍，反而没人敢改。
    #[test]
    fn test_arrange_consumes_durations() {
        let pitches = [
            JianpuNote::new(5, 0),
            JianpuNote::new(6, 0),
            JianpuNote::new(1, 1),
            JianpuNote::new(3, 1),
            JianpuNote::new(5, 1),
            JianpuNote::new(2, 1),
            JianpuNote::new(6, 0),
            JianpuNote::new(5, 0),
        ];
        let with = |units: u32| -> Vec<JianpuNote> {
            pitches.iter().map(|n| n.with_duration(units)).collect()
        };

        let fast = arrange_sequence(&with(2), Tuning::ZhengDiao);
        let slow = arrange_sequence(&with(32), Tuning::ZhengDiao);
        assert_ne!(
            fast.total_cost, slow.total_cost,
            "时值没进代价表：八分连奏与全音符算出了一模一样的代价"
        );

        // 向后兼容：不给时值必须与「全四分」完全等价，
        // 否则每个老调用方的结果都会在不知不觉中变掉。
        let unspecified = arrange_sequence(&pitches, Tuning::ZhengDiao);
        let quarters = arrange_sequence(&with(8), Tuning::ZhengDiao);
        assert_eq!(unspecified.total_cost, quarters.total_cost);
        assert_eq!(unspecified.stats, quarters.stats);
    }

    /// 单音序列必然「与逐音挑选一致」——没有第二个音，就没有可优化的移动。
    ///
    /// 这也是界面文案的分水岭：这种情况不该说「已优化」。
    #[test]
    fn test_arrange_single_note_is_identical_to_greedy() {
        let arranged = arrange_sequence(&[JianpuNote::new(1, 1)], Tuning::ZhengDiao);
        assert!(arranged.identical_to_greedy);
        assert_eq!(arranged.stats, arranged.greedy_stats);
        assert_eq!(arranged.stats.string_changes, 0);
    }

    /// 两个统计字段必须自洽：报告「一致」时，活动量也一定相同。
    #[test]
    fn test_arrange_stats_consistent_with_identical_flag() {
        for melody in sample_melodies() {
            for tuning in [Tuning::ZhengDiao, Tuning::RuiBin, Tuning::ManJiao] {
                let arranged = arrange_sequence(&melody, tuning);
                if arranged.identical_to_greedy {
                    assert_eq!(
                        arranged.stats, arranged.greedy_stats,
                        "{:?} 报告与逐音挑选一致，活动量却不同",
                        melody
                    );
                }
                // 换弦次数不可能超过相邻音对数
                let pairs = melody.len().saturating_sub(1) as u32;
                assert!(arranged.stats.string_changes <= pairs);
                assert!(arranged.greedy_stats.string_changes <= pairs);
            }
        }
    }

    // ── 分句（气口） ─────────────────────────────

    /// 两拍及以上的长音之后就是新的一句；一拍半的不算。
    ///
    /// 这条钉住的是阈值本身：附点四分（12）常常只是句中的伸展，
    /// 手不一定会离开琴面；两拍（16）才是真正的呼吸。
    #[test]
    fn test_phrase_split_follows_breath() {
        let mut notes: Vec<JianpuNote> = (0..4)
            .map(|_| JianpuNote::new(5, 0).with_duration(8))
            .collect();
        // 第四个音放足两拍 → 下一个音起新句
        notes[3] = JianpuNote::new(5, 0).with_duration(16);
        notes.extend((0..3).map(|_| JianpuNote::new(6, 0).with_duration(8)));

        let arranged = arrange_sequence(&notes, Tuning::ZhengDiao);
        let spans: Vec<(usize, usize, usize)> = arranged
            .phrases
            .iter()
            .map(|p| (p.start, p.end, p.note_count))
            .collect();
        assert_eq!(spans, vec![(0, 3, 4), (4, 6, 3)]);

        // 附点四分（12）不到两拍：不分句
        let mut dotted: Vec<JianpuNote> = (0..3)
            .map(|_| JianpuNote::new(5, 0).with_duration(8))
            .collect();
        dotted[2] = JianpuNote::new(5, 0).with_duration(12);
        dotted.push(JianpuNote::new(6, 0).with_duration(8));
        let arranged = arrange_sequence(&dotted, Tuning::ZhengDiao);
        assert_eq!(arranged.phrases.len(), 1, "附点四分不该被当成气口");
    }

    /// 气口处散音串重新起算：隔着一口呼吸的两个散音不是「一串干敲」。
    #[test]
    fn test_phrase_run_resets_at_breath() {
        let san = |string: u8| {
            GuqinNote::open_string(
                RightAction::Tiao,
                StringNumber::new(string).expect("弦序 1..=7"),
            )
        };
        // 散 散 散（两拍）散 散：中间抬手换过气，最长一串是 3，不是 5
        let path: Vec<(Option<u32>, GuqinNote)> = vec![
            (Some(4), san(1)),
            (Some(4), san(2)),
            (Some(16), san(3)),
            (Some(4), san(4)),
            (Some(4), san(5)),
        ];
        assert_eq!(path_stats(&path).longest_open_run, 3);

        // 没有长音时照旧整串数：同样五个散音，最长一串就是 5
        let continuous: Vec<(Option<u32>, GuqinNote)> =
            (1..=5).map(|s| (Some(4), san(s))).collect();
        assert_eq!(path_stats(&continuous).longest_open_run, 5);
    }

    /// 每一句都排满，不许因为回溯在气口处提前收手而留空。
    ///
    /// 这条是分句改动最容易踩的坑：气口那一行的回溯指针是 `None`，
    /// 若照旧 `break`，前面几句会静默变成「没有落点」——谱面上就是一片空。
    #[test]
    fn test_every_phrase_gets_selected() {
        let mut notes: Vec<JianpuNote> = (0..5)
            .map(|i| JianpuNote::new((i % 5 + 1) as u8, 1).with_duration(8))
            .collect();
        notes[4] = JianpuNote::new(1, 1).with_duration(16);
        notes.extend((0..5).map(|i| JianpuNote::new((i % 3 + 1) as u8, 1).with_duration(8)));

        let arranged = arrange_sequence(&notes, Tuning::ZhengDiao);
        assert_eq!(arranged.phrases.len(), 2);
        for (i, sel) in arranged.selections.iter().enumerate() {
            assert!(
                sel.is_some(),
                "第 {i} 个音被漏掉了：{:?}",
                arranged.selections
            );
        }
    }

    /// 分句是**真的独立**：一句的落点不因为后面接了别的曲子而改变。
    ///
    /// 这是「气口处不接上一句的手位」的可验证后果。反过来说，
    /// 如果实现只把气口的转移代价打折、没有断开，后半段就会被前半段牵着走，
    /// 这条断言会红。
    #[test]
    fn test_phrase_arrangement_is_local() {
        let mut first: Vec<JianpuNote> = (0..6)
            .map(|i| JianpuNote::new((i % 4 + 1) as u8, 0).with_duration(8))
            .collect();
        first[5] = JianpuNote::new(6, -1).with_duration(16); // 句尾放足两拍
        let second: Vec<JianpuNote> = (0..6)
            .map(|i| JianpuNote::new((i % 3 + 5) as u8, 1).with_duration(8))
            .collect();

        let alone = arrange_sequence(&second, Tuning::ZhengDiao);
        let together: Vec<JianpuNote> = first.iter().chain(second.iter()).copied().collect();
        let joined = arrange_sequence(&together, Tuning::ZhengDiao);

        // 后一句的每个落点都应与单独排时一致
        for (i, sel) in alone.selections.iter().enumerate() {
            assert_eq!(
                joined.selections[first.len() + i],
                *sel,
                "第 {i} 个音被上一句牵扯了：{:?} vs {:?}",
                joined.selections,
                alone.selections
            );
        }
        // 总代价同样是两段各自最优之和
        let head = arrange_sequence(&first, Tuning::ZhengDiao);
        assert_eq!(joined.total_cost, head.total_cost + alone.total_cost);
    }

    /// 没有气口就还是一句；空输入没有句子。分句不该改变老行为。
    #[test]
    fn test_phrase_edge_cases() {
        let quarters: Vec<JianpuNote> = (0..4)
            .map(|i| JianpuNote::new((i % 5 + 1) as u8, 0).with_duration(8))
            .collect();
        let arranged = arrange_sequence(&quarters, Tuning::ZhengDiao);
        assert_eq!(arranged.phrases.len(), 1);
        assert_eq!(arranged.phrases[0].note_count, 4);

        let empty = arrange_sequence(&[], Tuning::ZhengDiao);
        assert!(empty.phrases.is_empty());
    }
}
