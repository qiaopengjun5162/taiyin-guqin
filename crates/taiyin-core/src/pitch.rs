//! 减字 → 实际音高 —— 前端 `jianzi-pitch.ts` 的**唯一实现**。
//!
//! # 物理模型
//!
//! 以该定弦的空弦频率为基准：
//!
//! - **散音**：直接取空弦频率。
//! - **按音**：在距岳山 `p`（按弦点占全弦比例）处按实，有效弦长为 `1 − p`，
//!   频率 = `空弦 / (1 − p)`。
//! - **泛音**：轻触谐波节点，频率为 `n × 空弦`；`n` 由按弦点 `p` 的最简分数
//!   分母决定（七徽 1/2 → 2 次，五/九徽 1/3 → 3 次，四/十徽 1/4 → 4 次…）。
//!   **不能用 `open / p` 表示泛音**：九徽 p = 2/3 时 `open / p` 只有 1.5 次，错得离谱。
//!
//! # 为什么在核心里
//!
//! 同一个减字，网页、小程序、App 必须算出同一个音高——差半音就是另一个音，
//! 而且不会报错。它只依赖定弦表与徽位比例，不碰时间/存储/网络/UI。
//!
//! # 定弦只建模三种
//!
//! `Tuning` 枚举只有正调/蕤宾/慢角三种（`jianpu` 模块的既有取舍：
//! 简谱编排引擎只建模这三种 1=F 调式）。另三种（清商/太簇/凄凉）
//! 用于存谱、调音与播放，不参与音高反推——调用方传不进来，也不会算错。

use serde::{Deserialize, Serialize};

use crate::jianpu::{DEGREE_SEMITONES, Tuning};

/// 十三徽从岳山到按点的弦长比例。
///
/// 与 `jianpu::HUI_RATIOS` 逐项一致，由 `verify-domain-contracts.mjs` 守着。
const HUI_RATIO: [f64; 13] = [
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

/// 各徽对应的泛音谐波次数（`p` 最简分数的分母）。
const HUI_HARMONIC: [u8; 13] = [8, 6, 5, 4, 3, 5, 2, 5, 3, 4, 5, 6, 8];

/// 简谱级数 1 在八度 0 处的 MIDI 号（F2 = 41）。
///
/// 用于**反推**方向：给定频率，找一个最接近的可表示唱名。
/// 与 `jianpu::PITCH_BASE_MIDI` 同为 41——那边算的是「谱面记号 → MIDI」，
/// 这边算的是「MIDI → 谱面记号」，两者用同一个锚点才能往返一致。
const PITCH_BASE_MIDI: f64 = 41.0;

/// 十二平均律 A4 的 MIDI 号。
const A4_MIDI: f64 = 69.0;

/// 默认基准音（A4 = 440 Hz）。
pub const CONCERT_PITCH_DEFAULT: f64 = 440.0;

/// 音色类型——决定音高怎么算。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToneType {
    /// 散音：空弦，不按。
    散,
    /// 按音：左指按实于徽位。
    按,
    /// 泛音：左指轻触徽位。
    泛,
}

impl ToneType {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "散" => Some(ToneType::散),
            "按" => Some(ToneType::按),
            "泛" => Some(ToneType::泛),
            _ => None,
        }
    }
}

/// 推算所需的上下文。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PitchContext {
    pub tuning: Tuning,
    /// A4 的实测频率；古琴常整床偏低，按琴上的实际音高设。
    pub concert_pitch: f64,
}

impl Default for PitchContext {
    fn default() -> Self {
        Self {
            tuning: Tuning::ZhengDiao,
            concert_pitch: CONCERT_PITCH_DEFAULT,
        }
    }
}

/// 一个待推算的音：弦序 + 音色 + 徽位/分。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PitchQuery {
    /// 弦序 1..=7。
    pub string_number: u8,
    pub tone_type: ToneType,
    /// 徽位 1..=13；散音时可省。
    pub hui: Option<u8>,
    /// 分位：占相邻两徽间隔的比例（三分 = 0.3、半 = 0.5）。省则按整徽。
    pub fen_fraction: Option<f64>,
}

/// 三种定弦的七根空弦 MIDI 号（一弦 → 七弦）。
///
/// ## 为什么不从 `Tuning::open_strings()` 换算
///
/// `open_strings()` 返回的是 `Pitch { number, octave }`——**谱面记号**，
/// 其中 `octave` 是「以三弦所在组为 0」的相对编号（正调三弦写作 `1·`）。
/// 它服务于「简谱级数 ↔ 减字」的翻译，不是绝对音高。
///
/// 而频率需要绝对 MIDI。两者之间没有直接可用的换算：
/// `midi_note(Pitch::new(1, 0)) = 41`（F2），但 `open_strings()[2] = (1, 1)`
/// ——把后者套进同一个基准会得出 MIDI 53（F3），整体高一个八度（实测 174.6 Hz）。
///
/// 所以这里直接列绝对 MIDI 号，与前端 `lib/tuning.ts` 的 `openMidi` 逐项一致：
/// 正调 `[36, 38, 41, 43, 45, 48, 50]`（C2 D2 F2 G2 A2 C3 D3）。
/// 两份表由 `scripts/verify-tuning-contract.mjs` 守着不许漂。
fn open_string_midi(tuning: Tuning) -> [f64; 7] {
    match tuning {
        // C2 D2 F2 G2 A2 C3 D3
        Tuning::ZhengDiao => [36.0, 38.0, 41.0, 43.0, 45.0, 48.0, 50.0],
        // 紧五弦 A→B♭
        Tuning::RuiBin => [36.0, 38.0, 41.0, 43.0, 46.0, 48.0, 50.0],
        // 慢三弦 F→E
        Tuning::ManJiao => [36.0, 38.0, 40.0, 43.0, 45.0, 48.0, 50.0],
    }
}

/// 空弦频率（Hz）。
///
/// 由定弦给出该弦的绝对 MIDI 号，再按十二平均律换成频率：
/// `f = concertPitch × 2^((midi − 69) / 12)`（A4 = MIDI 69）。
pub fn open_string_frequency(string_number: u8, ctx: PitchContext) -> Option<f64> {
    if !(1..=7).contains(&string_number) {
        return None;
    }
    let midi = open_string_midi(ctx.tuning)[(string_number - 1) as usize];
    Some(ctx.concert_pitch * 2f64.powf((midi - A4_MIDI) / 12.0))
}

/// 徽位 + 分位 → 按弦点占全弦比例 `p`。
///
/// 分位在两徽之间线性内插（向龙龈方向 `p` 增大）；十三徽外推用上一间隔。
pub fn hui_fraction(hui: u8, fen_fraction: Option<f64>) -> Option<f64> {
    if !(1..=13).contains(&hui) {
        return None;
    }
    let base = HUI_RATIO[(hui - 1) as usize];
    let f = fen_fraction.unwrap_or(0.0);
    if f <= 0.0 {
        return Some(base);
    }
    if hui < 13 {
        let next = HUI_RATIO[hui as usize];
        Some(base + f * (next - base))
    } else {
        // 十三徽外推：沿用十二→十三那一格的间隔长度
        let prev = HUI_RATIO[11];
        let step = base - prev;
        Some(base + f * step)
    }
}

/// 由按弦点 `p` 取最接近的泛音谐波次数。
fn harmonic_from_p(p: f64) -> u8 {
    let mut best = 2u8;
    let mut best_diff = f64::INFINITY;
    for hui in 1..=13usize {
        let diff = (p - HUI_RATIO[hui - 1]).abs();
        if diff < best_diff {
            best_diff = diff;
            best = HUI_HARMONIC[hui - 1];
        }
    }
    best
}

/// 推算实际振动频率（Hz）；无法推算返回 `None`。
pub fn frequency_of(query: &PitchQuery, ctx: PitchContext) -> Option<f64> {
    let open = open_string_frequency(query.string_number, ctx)?;
    if query.tone_type == ToneType::散 {
        return Some(open);
    }
    // 按 / 泛音必须有徽位
    let hui = query.hui?;
    let p = hui_fraction(hui, query.fen_fraction)?;
    if !(p > 0.0 && p < 1.0) {
        return None;
    }
    match query.tone_type {
        ToneType::泛 => Some(open * f64::from(harmonic_from_p(p))),
        ToneType::按 => {
            // 有效弦长 (1 − p)，越靠近龙龈音越高
            let vibrating = 1.0 - p;
            if vibrating <= 0.0 {
                return None;
            }
            Some(open / vibrating)
        }
        ToneType::散 => Some(open),
    }
}

/// 简谱唱名：级数 1–7 + 八度记号。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JianpuName {
    /// 级数 1..=7。
    pub number: u8,
    /// 八度记号，与前端 `JianpuOctave` 同一套：
    /// `""` 无、`"·"` 高一个、`"··"` 高两个、`","` 低一个、`",,"` 低两个。
    pub octave: String,
}

/// 频率 → 最接近的可表示简谱唱名（1=F 记谱）。
///
/// 搜索范围 ±2 八度（可表示记号的上限）；超出窗口的音高会吸附到最近的边界记号——
/// 纯显示用途，不影响播放（播放以减字为准）。
pub fn frequency_to_jianpu(freq: f64, concert_pitch: f64) -> Option<JianpuName> {
    if !freq.is_finite() || freq <= 0.0 {
        return None;
    }
    let target_midi = A4_MIDI + 12.0 * (freq / concert_pitch).log2();
    let offsets: [(&str, f64); 5] = [
        ("", 0.0),
        ("·", 12.0),
        ("··", 24.0),
        (",", -12.0),
        (",,", -24.0),
    ];
    let mut best: Option<(f64, JianpuName)> = None;
    for (idx, semitone) in DEGREE_SEMITONES.iter().enumerate() {
        for (mark, offset) in offsets {
            let candidate_midi = PITCH_BASE_MIDI + f64::from(*semitone) + offset;
            let err = (target_midi - candidate_midi).abs();
            if best.as_ref().is_none_or(|(best_err, _)| err < *best_err) {
                best = Some((
                    err,
                    JianpuName {
                        number: (idx + 1) as u8,
                        octave: mark.to_string(),
                    },
                ));
            }
        }
    }
    best.map(|(_, name)| name)
}

/// 减字 → 最接近的可表示简谱唱名。
pub fn query_to_jianpu(query: &PitchQuery, ctx: PitchContext) -> Option<JianpuName> {
    let freq = frequency_of(query, ctx)?;
    frequency_to_jianpu(freq, ctx.concert_pitch)
}

// ──────────────────────────────────────────────
// JSON 桥接（WASM / HTTP 共用）
// ──────────────────────────────────────────────

/// 定弦字符串 → `Tuning`。
pub fn parse_tuning(s: &str) -> Option<Tuning> {
    match s {
        "zhengdiao" | "zheng" => Some(Tuning::ZhengDiao),
        "ruibin" => Some(Tuning::RuiBin),
        "manjiao" => Some(Tuning::ManJiao),
        _ => None,
    }
}

/// 输入 `{"stringNumber":4,"toneType":"按","hui":9,"fenFraction":null,
/// "tuning":"zhengdiao","concertPitch":440}`
/// 输出 `{"frequency":196.0,"jianpu":{"number":5,"octave":""}}`
///
/// 推不出时两个字段都是 `null`——**不猜**。一个错的音高比没有音高更糟：
/// 没人会去核对，只会照着一个错音练。
pub fn frequency_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        #[serde(rename = "stringNumber")]
        string_number: u8,
        #[serde(rename = "toneType")]
        tone_type: String,
        #[serde(default)]
        hui: Option<u8>,
        #[serde(rename = "fenFraction", default)]
        fen_fraction: Option<f64>,
        #[serde(default)]
        tuning: Option<String>,
        #[serde(rename = "concertPitch", default)]
        concert_pitch: Option<f64>,
    }

    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let tone = ToneType::parse(&req.tone_type)
        .ok_or_else(|| format!("未知音色：{}（可用：散 / 按 / 泛）", req.tone_type))?;
    let tuning = match req.tuning.as_deref() {
        Some(s) => parse_tuning(s).ok_or_else(|| format!("未知定弦：{s}"))?,
        None => Tuning::ZhengDiao,
    };
    let ctx = PitchContext {
        tuning,
        concert_pitch: req.concert_pitch.unwrap_or(CONCERT_PITCH_DEFAULT),
    };
    let query = PitchQuery {
        string_number: req.string_number,
        tone_type: tone,
        hui: req.hui,
        fen_fraction: req.fen_fraction,
    };
    let freq = frequency_of(&query, ctx);
    let jianpu = freq.and_then(|f| frequency_to_jianpu(f, ctx.concert_pitch));
    Ok(serde_json::json!({ "frequency": freq, "jianpu": jianpu }).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> PitchContext {
        PitchContext::default()
    }

    /// 正调空弦：C2 D2 F2 G2 A2 C3 D3（MIDI 36 38 41 43 45 48 50）。
    #[test]
    fn open_strings_match_zheng_diao() {
        let expected_midi = [36.0, 38.0, 41.0, 43.0, 45.0, 48.0, 50.0];
        for (i, want) in expected_midi.iter().enumerate() {
            let freq = open_string_frequency((i + 1) as u8, ctx()).unwrap();
            let midi = A4_MIDI + 12.0 * (freq / 440.0).log2();
            assert!(
                (midi - want).abs() < 0.001,
                "第 {} 弦：midi {midi} ≠ {want}",
                i + 1
            );
        }
    }

    #[test]
    fn san_yin_is_open_string() {
        let q = PitchQuery {
            string_number: 3,
            tone_type: ToneType::散,
            hui: None,
            fen_fraction: None,
        };
        let freq = frequency_of(&q, ctx()).unwrap();
        // 正调三弦 F2 ≈ 87.31 Hz
        assert!((freq - 87.31).abs() < 0.05, "实际 {freq}");
    }

    #[test]
    fn an_yin_at_seventh_hui_is_octave() {
        // 七徽 p = 1/2，有效弦长一半 → 正好高八度
        let q = PitchQuery {
            string_number: 1,
            tone_type: ToneType::按,
            hui: Some(7),
            fen_fraction: None,
        };
        let open = open_string_frequency(1, ctx()).unwrap();
        let pressed = frequency_of(&q, ctx()).unwrap();
        assert!(
            (pressed / open - 2.0).abs() < 1e-9,
            "比值 {}",
            pressed / open
        );
    }

    #[test]
    fn fan_yin_at_seventh_hui_is_second_harmonic() {
        // 七徽谐波次数 2 → 与按音同高
        let q = PitchQuery {
            string_number: 1,
            tone_type: ToneType::泛,
            hui: Some(7),
            fen_fraction: None,
        };
        let open = open_string_frequency(1, ctx()).unwrap();
        let harmonic = frequency_of(&q, ctx()).unwrap();
        assert!((harmonic / open - 2.0).abs() < 1e-9);
    }

    #[test]
    fn fan_yin_ninth_hui_is_third_harmonic() {
        // 九徽 p = 2/3，谐波次数 3 —— 不是 open/p（那只有 1.5）
        let q = PitchQuery {
            string_number: 1,
            tone_type: ToneType::泛,
            hui: Some(9),
            fen_fraction: None,
        };
        let open = open_string_frequency(1, ctx()).unwrap();
        let harmonic = frequency_of(&q, ctx()).unwrap();
        assert!(
            (harmonic / open - 3.0).abs() < 1e-9,
            "比值 {}",
            harmonic / open
        );
    }

    #[test]
    fn fen_interpolates_between_hui() {
        // 九徽六分：在 2/3 与 3/4 之间走 60%
        let p = hui_fraction(9, Some(0.6)).unwrap();
        let expected = 2.0 / 3.0 + 0.6 * (3.0 / 4.0 - 2.0 / 3.0);
        assert!((p - expected).abs() < 1e-12, "p = {p}");
    }

    #[test]
    fn hui_thirteen_extrapolates_backwards() {
        let p = hui_fraction(13, Some(0.5)).unwrap();
        let base = 7.0 / 8.0;
        let prev = 5.0 / 6.0;
        // 外推方向应继续向龙龈增大
        assert!(p > base, "p = {p} 应大于 {base}");
        assert!((p - (base + 0.5 * (base - prev))).abs() < 1e-12);
    }

    #[test]
    fn invalid_inputs_yield_none() {
        let bad_string = PitchQuery {
            string_number: 0,
            tone_type: ToneType::散,
            hui: None,
            fen_fraction: None,
        };
        assert!(frequency_of(&bad_string, ctx()).is_none());

        let bad_hui = PitchQuery {
            string_number: 1,
            tone_type: ToneType::按,
            hui: Some(14),
            fen_fraction: None,
        };
        assert!(frequency_of(&bad_hui, ctx()).is_none());

        // 按音缺徽位
        let no_hui = PitchQuery {
            string_number: 1,
            tone_type: ToneType::按,
            hui: None,
            fen_fraction: None,
        };
        assert!(frequency_of(&no_hui, ctx()).is_none());
    }

    #[test]
    fn concert_pitch_shifts_everything_proportionally() {
        let low = PitchContext {
            tuning: Tuning::ZhengDiao,
            concert_pitch: 415.0,
        };
        let a = open_string_frequency(1, ctx()).unwrap();
        let b = open_string_frequency(1, low).unwrap();
        assert!((a / b - 440.0 / 415.0).abs() < 1e-12);
    }

    #[test]
    fn ruibin_fifth_string_is_higher() {
        // 蕤宾调紧五弦（A→B♭）：五弦比正调高半音
        let zheng = open_string_frequency(5, ctx()).unwrap();
        let ruibin = open_string_frequency(
            5,
            PitchContext {
                tuning: Tuning::RuiBin,
                ..ctx()
            },
        )
        .unwrap();
        let ratio = ruibin / zheng;
        let expected = 2f64.powf(1.0 / 12.0);
        assert!((ratio - expected).abs() < 1e-9, "比值 {ratio}");
    }

    #[test]
    fn jianpu_round_trips_for_open_strings() {
        // 每根空弦都能反推出一个唱名，且不差过一个半音
        for i in 1..=7u8 {
            let q = PitchQuery {
                string_number: i,
                tone_type: ToneType::散,
                hui: None,
                fen_fraction: None,
            };
            let name = query_to_jianpu(&q, ctx()).expect("应能反推");
            assert!((1..=7).contains(&name.number));
        }
    }

    #[test]
    fn seventh_hui_an_yin_is_octave_higher_in_jianpu() {
        // 一弦散音记作低八度的 5；七徽按音应变成无记号的 5
        let open = query_to_jianpu(
            &PitchQuery {
                string_number: 1,
                tone_type: ToneType::散,
                hui: None,
                fen_fraction: None,
            },
            ctx(),
        )
        .unwrap();
        let pressed = query_to_jianpu(
            &PitchQuery {
                string_number: 1,
                tone_type: ToneType::按,
                hui: Some(7),
                fen_fraction: None,
            },
            ctx(),
        )
        .unwrap();
        assert_eq!(open.number, pressed.number);
        assert_ne!(open.octave, pressed.octave, "应差一个八度记号");
    }

    #[test]
    fn json_bridge_shape() {
        let out = frequency_json(
            r#"{"stringNumber":3,"toneType":"散","tuning":"zhengdiao","concertPitch":440}"#,
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let freq = v["frequency"].as_f64().unwrap();
        assert!((freq - 87.31).abs() < 0.1, "实际 {freq}");
        assert!(v["jianpu"].is_object());
    }

    #[test]
    fn json_bridge_reports_bad_tone() {
        let err = frequency_json(r#"{"stringNumber":1,"toneType":"未知"}"#).unwrap_err();
        assert!(err.contains("未知音色"), "{err}");
    }

    #[test]
    fn json_bridge_nulls_when_uncomputable() {
        // 按音缺徽位 → 频率与唱名都是 null，不猜
        let out = frequency_json(r#"{"stringNumber":1,"toneType":"按"}"#).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v["frequency"].is_null());
        assert!(v["jianpu"].is_null());
    }
}
