//! 编排结果的「说人话」文案。
//!
//! 这段文案原先写在 `apps/web/src/lib/taiyin-wasm.ts` 里，是纯 TS 函数。
//! 搬进核心的理由和 `explain.rs` 的释义一样：网页、小程序、App 要说出
//! **同一句话**。两处各写一套措辞，用户这次读到的和下次读到的不一样，
//! 只会怀疑自己记错了。
//!
//! 文案的硬约束是**不许撒谎**：
//!
//! - 没减少的项不能提（编排换了落点、移动次数没变时，说「已优化」就是邀功）；
//! - 指标变多了也要说（全局最优允许在长音之后多走一趟手，但用户数列表时
//!   会发现对不上，不说就成了另一种撒谎）；
//! - 本来就最顺时直说，别把「一样」包装成「更好」。
//!
//! 一旦这层开始邀功，用户下次就不信这个按钮了。所以每条措辞都在下面的
//! `#[cfg(test)]` 里逐字钉死——改一个字都要有理由。

use serde::Deserialize;

use crate::jianpu::{PathStats, PhraseSpan};

/// 「说人话」需要的全部输入。
///
/// 刻意不收整个 [`crate::jianpu::Arrangement`]：候选列表与落点索引对文案毫无
/// 用处，却占载荷的绝大部分（长曲里是几百个候选对象）。前端只挑这四个字段
/// 发过来，既省带宽，也让「文案依赖什么」在类型上就写死——将来谁想拿候选
/// 列表编一句更花哨的话，得先改这里。
#[derive(Debug, Deserialize)]
pub struct DescribeInput {
    pub stats: PathStats,
    pub greedy_stats: PathStats,
    pub identical_to_greedy: bool,
    pub phrases: Vec<PhraseSpan>,
}

/// 两个活动量之差：正数表示编排省下了，负数表示多花了。
fn saved(before: u32, after: u32) -> i64 {
    i64::from(before) - i64::from(after)
}

/// 分句那一句人话。只有一句（或没分句）时返回空串。
///
/// 短曲上标「第 1 句」纯属噪声，用户还会以为按钮坏了——所以一句就闭嘴。
///
/// 排序只按**一个**指标：快句里赶不上的换手次数。它决定「这一句能不能弹下来」，
/// 换弦次数只是它的粗略代理。不看抽象总代价——那个分数涨跌对弹琴的人没有意义。
pub fn describe_phrases(phrases: &[PhraseSpan]) -> String {
    if phrases.len() < 2 {
        return String::new();
    }

    // 与 TS 版 `reduce` 逐字对齐：先比快句换手，平手再比换弦，全平手保留先出现的。
    let hardest = phrases
        .iter()
        .reduce(|a, b| {
            if b.stats.rushed_moves != a.stats.rushed_moves {
                if b.stats.rushed_moves > a.stats.rushed_moves {
                    b
                } else {
                    a
                }
            } else if b.stats.string_changes > a.stats.string_changes {
                b
            } else {
                a
            }
        })
        .expect("phrases.len() >= 2 保证至少有一个元素");

    let head = format!("全曲 {} 句", phrases.len());
    let rushed = hardest.stats.rushed_moves;
    if rushed > 0 {
        let index = hardest.index + 1;
        format!("{head}，第 {index} 句最赶（快句里换手 {rushed} 次），先慢练这句")
    } else {
        format!("{head}，没有哪一句赶不上手")
    }
}

/// 把编排结果说成一句人话。
///
/// 只说琴人能直接感觉到的五件事，按「弹得动 / 弹不动」的重要性排序：
/// 快句换手 → 散音连缀 → 换弦 → 音色切换 → 挪手。前三项的顺序不是随机的：
/// 换手是分界线，散音连缀说的不是手好不好动、而是这一句听起来连不连
/// （一串空弦音高全对，却没有走手相连，这是排谱的人最容易被忽略的毛病）。
///
/// 长曲再补一句分句的账：整首的总数再漂亮，回到琴上还是得知道从哪一句开始练。
pub fn describe_arrangement(input: &DescribeInput) -> String {
    let phrase_note = describe_phrases(&input.phrases);
    let with_phrases = |text: String| {
        if phrase_note.is_empty() {
            text
        } else {
            format!("{text}。{phrase_note}")
        }
    };

    if input.identical_to_greedy {
        return with_phrases("这条已经是最顺的走法，逐音挑选和整句编排选的是同一个".to_string());
    }

    let stats: &PathStats = &input.stats;
    let greedy: &PathStats = &input.greedy_stats;
    let rushed_saved = saved(greedy.rushed_moves, stats.rushed_moves);
    let string_saved = saved(greedy.string_changes, stats.string_changes);
    let tone_saved = saved(greedy.technique_switches, stats.technique_switches);
    let shift_saved = saved(greedy.finger_shifts, stats.finger_shifts);

    let mut parts: Vec<String> = Vec::new();
    // 急处换手排最前：它是「弹得动 / 弹不动」的分界线，换弦次数只是它的粗略代理。
    if rushed_saved > 0 {
        parts.push(format!("快句里少 {rushed_saved} 次换手"));
    }
    // 散音连缀紧跟其后：它说的不是手好不好动，而是这一句听起来连不连。
    if greedy.longest_open_run > stats.longest_open_run {
        parts.push(format!(
            "最长一串散音从 {} 个缩到 {} 个",
            greedy.longest_open_run, stats.longest_open_run
        ));
    }
    if string_saved > 0 {
        parts.push(format!("少 {string_saved} 次换弦"));
    }
    if tone_saved > 0 {
        parts.push(format!("少 {tone_saved} 次音色切换"));
    }
    if shift_saved > 0 {
        parts.push(format!("少 {shift_saved} 次挪手"));
    }

    if parts.is_empty() {
        return with_phrases("已重排：落点换了，手的移动次数和逐音挑选一样".to_string());
    }

    // 有得有失时不许只报喜：多花的换手也要报个数，但要指出它不在急处。
    let extra = (-string_saved).max(0) + (-shift_saved).max(0);
    let caveat = if extra > 0 {
        format!("；换手总数多 {extra} 次，但都落在来得及的地方")
    } else {
        String::new()
    };
    with_phrases(format!("已编排：{}{caveat}", parts.join("、")))
}

/// 入口：`{"phrases":[...]}` → 一句中文（没分句时为空串）。
///
/// 与 `explain.rs::describe_hui_position_json` 同约定：成功返回**裸文本**，
/// 失败返回 `{"error":"…"}`，由前端判 `"error"` 后降级。
pub fn describe_phrases_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        #[serde(default)]
        phrases: Vec<PhraseSpan>,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    Ok(describe_phrases(&req.phrases))
}

/// 入口：`{"stats":…,"greedy_stats":…,"identical_to_greedy":…,"phrases":[…]}` → 一句中文。
pub fn describe_arrangement_json(input_json: &str) -> Result<String, String> {
    let req: DescribeInput =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    Ok(describe_arrangement(&req))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(
        string_changes: u32,
        finger_shifts: u32,
        technique: u32,
        rushed: u32,
        open: u32,
    ) -> PathStats {
        PathStats {
            string_changes,
            finger_shifts,
            technique_switches: technique,
            rushed_moves: rushed,
            longest_open_run: open,
        }
    }

    /// 默认对照：逐音挑选换了 3 次弦、2 次音色、1 次挪手，编排一次都不用。
    fn base() -> DescribeInput {
        DescribeInput {
            stats: stats(0, 0, 0, 0, 0),
            greedy_stats: stats(3, 1, 2, 0, 0),
            identical_to_greedy: false,
            phrases: Vec::new(),
        }
    }

    fn phrase(index: usize, start: usize, stats: PathStats) -> PhraseSpan {
        PhraseSpan {
            index,
            start,
            end: start + 3,
            note_count: 4,
            stats,
        }
    }

    #[test]
    fn only_reports_what_actually_dropped() {
        assert_eq!(
            describe_arrangement(&base()),
            "已编排：少 3 次换弦、少 2 次音色切换、少 1 次挪手"
        );
    }

    #[test]
    fn tone_only_improvement_omits_string_changes() {
        let input = DescribeInput {
            stats: stats(3, 1, 0, 0, 0),
            ..base()
        };
        let text = describe_arrangement(&input);
        assert_eq!(text, "已编排：少 2 次音色切换");
        assert!(!text.contains("换弦"));
    }

    #[test]
    fn unchanged_move_counts_do_not_claim_optimization() {
        let input = DescribeInput {
            stats: stats(3, 1, 2, 0, 0),
            ..base()
        };
        assert_eq!(
            describe_arrangement(&input),
            "已重排：落点换了，手的移动次数和逐音挑选一样"
        );
    }

    #[test]
    fn identical_path_says_already_best() {
        let input = DescribeInput {
            identical_to_greedy: true,
            ..base()
        };
        assert_eq!(
            describe_arrangement(&input),
            "这条已经是最顺的走法，逐音挑选和整句编排选的是同一个"
        );
    }

    #[test]
    fn rushed_saved_leads_even_when_strings_unchanged() {
        let input = DescribeInput {
            stats: stats(3, 1, 2, 0, 0),
            greedy_stats: stats(3, 1, 2, 4, 0),
            ..base()
        };
        assert_eq!(describe_arrangement(&input), "已编排：快句里少 4 次换手");
    }

    #[test]
    fn extra_moves_are_disclosed_as_harmless() {
        let input = DescribeInput {
            stats: stats(4, 1, 2, 1, 0),
            greedy_stats: stats(3, 1, 2, 3, 0),
            ..base()
        };
        assert_eq!(
            describe_arrangement(&input),
            "已编排：快句里少 2 次换手；换手总数多 1 次，但都落在来得及的地方"
        );
    }

    #[test]
    fn open_run_shortening_reports_before_and_after() {
        let input = DescribeInput {
            stats: stats(6, 0, 2, 0, 4),
            greedy_stats: stats(6, 0, 0, 0, 7),
            ..base()
        };
        assert_eq!(
            describe_arrangement(&input),
            "已编排：最长一串散音从 7 个缩到 4 个"
        );
    }

    #[test]
    fn unchanged_open_run_is_not_mentioned() {
        let input = DescribeInput {
            stats: stats(2, 0, 0, 0, 3),
            greedy_stats: stats(3, 0, 0, 0, 3),
            ..base()
        };
        let text = describe_arrangement(&input);
        assert_eq!(text, "已编排：少 1 次换弦");
        assert!(!text.contains("散音"));
    }

    #[test]
    fn single_phrase_stays_silent() {
        assert_eq!(describe_phrases(&[]), "");
        assert_eq!(describe_phrases(&[phrase(0, 0, stats(0, 0, 0, 3, 0))]), "");
    }

    #[test]
    fn names_the_hardest_phrase_by_rushed_moves() {
        let phrases = vec![
            phrase(0, 0, stats(9, 0, 0, 1, 0)),
            phrase(1, 4, stats(0, 0, 0, 3, 0)),
            phrase(2, 8, stats(5, 0, 0, 0, 0)),
        ];
        assert_eq!(
            describe_phrases(&phrases),
            "全曲 3 句，第 2 句最赶（快句里换手 3 次），先慢练这句"
        );
    }

    #[test]
    fn no_phrase_blamed_when_all_manageable() {
        let phrases = vec![
            phrase(0, 0, stats(6, 0, 0, 0, 0)),
            phrase(1, 4, stats(2, 0, 0, 0, 0)),
        ];
        assert_eq!(describe_phrases(&phrases), "全曲 2 句，没有哪一句赶不上手");
    }

    #[test]
    fn phrase_note_follows_with_period() {
        let input = DescribeInput {
            stats: stats(0, 0, 0, 0, 0),
            greedy_stats: stats(2, 0, 0, 0, 0),
            identical_to_greedy: false,
            phrases: vec![
                phrase(0, 0, stats(0, 0, 0, 0, 0)),
                phrase(1, 4, stats(0, 0, 0, 2, 0)),
            ],
        };
        assert_eq!(
            describe_arrangement(&input),
            "已编排：少 2 次换弦。全曲 2 句，第 2 句最赶（快句里换手 2 次），先慢练这句"
        );
    }

    #[test]
    fn json_bridge_accepts_trimmed_payload() {
        let json = r#"{
            "stats": {"string_changes":0,"finger_shifts":0,"technique_switches":0,
                      "rushed_moves":0,"longest_open_run":0},
            "greedy_stats": {"string_changes":2,"finger_shifts":0,"technique_switches":0,
                             "rushed_moves":0,"longest_open_run":0},
            "identical_to_greedy": false,
            "phrases": []
        }"#;
        assert_eq!(
            describe_arrangement_json(json).unwrap(),
            "已编排：少 2 次换弦"
        );

        let phrases_json = r#"{"phrases":[
            {"index":0,"start":0,"end":3,"note_count":4,
             "stats":{"string_changes":0,"finger_shifts":0,"technique_switches":0,
                      "rushed_moves":0,"longest_open_run":0}},
            {"index":1,"start":4,"end":7,"note_count":4,
             "stats":{"string_changes":0,"finger_shifts":0,"technique_switches":0,
                      "rushed_moves":2,"longest_open_run":0}}
        ]}"#;
        assert_eq!(
            describe_phrases_json(phrases_json).unwrap(),
            "全曲 2 句，第 2 句最赶（快句里换手 2 次），先慢练这句"
        );
        assert_eq!(describe_phrases_json("{}").unwrap(), "");
    }

    #[test]
    fn json_bridge_rejects_bad_payload() {
        assert!(describe_arrangement_json("{}").is_err());
        assert!(describe_arrangement_json("not json").is_err());
    }
}
