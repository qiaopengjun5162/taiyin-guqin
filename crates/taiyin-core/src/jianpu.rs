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

/// 从一个落点走到另一个落点的手部开销。
///
/// 这里刻意不复用 `context_bonus`：那是贪心用的「加分」，只能看一步；
/// 编排需要的是一个可加的**代价**，才能保证 DP 的最优性成立。
fn transition_cost(prev: &GuqinNote, curr: &GuqinNote) -> i64 {
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

    cost
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
}

/// 为整段简谱求出全局最连贯的一套指法。
///
/// 与 [`translate_jianpu_sequence`] 的区别：那一版逐音贪心，这一版把整句当成
/// 一条路径求全局最优。差别在长句上非常明显——贪心常在第一音就锁死了一个
/// 舒服但孤立的位置，后面每个音都在补偿；全局编排会牺牲一点单音舒适度，
/// 换来整句少换把、少跨弦。
///
/// 复杂度 O(n·k²)：n 是音数，k 是单音候选数（通常 10~40）。
/// 一首三百音的曲子约几十万次比较，毫秒级，可以在按键时同步跑。
pub fn arrange_sequence(notes: &[JianpuNote], tuning: Tuning) -> Arrangement {
    // 候选只按单音评分生成一次，**不**走 `translate_jianpu_sequence`：
    // 那一版会把「上一个音的贪心选择」折进每个候选的分里，再拿它当 DP 的基代价，
    // 等于把局部偏见烧进全局最优——同一个音被前后夹击算两遍，结果既不是贪心也不是最优。
    let mut candidates_per_note: Vec<Vec<JianziCandidate>> =
        notes.iter().map(|n| translate_jianpu(*n, tuning)).collect();

    let mut dp: Vec<Vec<i64>> = Vec::with_capacity(notes.len());
    let mut prev_choice: Vec<Vec<Option<usize>>> = Vec::with_capacity(notes.len());

    // 上一个**非空**候选行。某个音在琴上无合法落点时，这个音不该切断整句的连贯性，
    // 而应被跳过——后面那个音仍然要跟「最近一个真的弹得出来的音」比较手位。
    let mut last_row: Option<Vec<i64>> = None;
    let mut last_notes: Option<Vec<GuqinNote>> = None;

    for candidates in &candidates_per_note {
        if candidates.is_empty() {
            dp.push(Vec::new());
            prev_choice.push(Vec::new());
            continue;
        }

        let mut row: Vec<i64> = Vec::with_capacity(candidates.len());
        let mut back: Vec<Option<usize>> = Vec::with_capacity(candidates.len());

        for candidate in candidates {
            // 分数高于基准时（理论上不该发生）夹到 0，避免负代价
            let base = i64::from((COST_BASE - candidate.score).max(0));

            match (&last_row, &last_notes) {
                (Some(row_prev), Some(notes_prev)) => {
                    let mut best: Option<(i64, usize)> = None;
                    for (k, prev_note) in notes_prev.iter().enumerate() {
                        let total = row_prev[k] + transition_cost(prev_note, &candidate.note);
                        if best.is_none_or(|(b, _)| total < b) {
                            best = Some((total, k));
                        }
                    }
                    let (cost, k) = best.expect("非空行必然至少有一个候选");
                    row.push(cost + base);
                    back.push(Some(k));
                }
                _ => {
                    row.push(base);
                    back.push(None);
                }
            }
        }

        last_row = Some(row.clone());
        last_notes = Some(candidates.iter().map(|c| c.note.clone()).collect());
        dp.push(row);
        prev_choice.push(back);
    }

    let mut selections: Vec<Option<usize>> = vec![None; notes.len()];
    let mut total_cost: i64 = 0;

    // 从最后一行为起点回溯：末音代价最小的那条，就是整句最优路径的终点。
    if let Some(last_i) = dp.iter().rposition(|row| !row.is_empty()) {
        let row = &dp[last_i];
        let mut best_j = 0usize;
        for (j, &cost) in row.iter().enumerate() {
            if cost < row[best_j] {
                best_j = j;
            }
        }
        total_cost = row[best_j];

        let mut cursor_row = last_i;
        let mut cursor_j = best_j;
        loop {
            selections[cursor_row] = Some(cursor_j);
            let Some(prev_j) = prev_choice[cursor_row][cursor_j] else {
                break;
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
        }
    }

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
        let mut prev: Option<GuqinNote> = None;
        for note in notes {
            let Some(best) = translate_jianpu(*note, tuning).into_iter().next() else {
                continue;
            };
            total += i64::from((COST_BASE - best.score).max(0));
            if let Some(ref p) = prev {
                total += transition_cost(p, &best.note);
            }
            prev = Some(best.note);
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
}
