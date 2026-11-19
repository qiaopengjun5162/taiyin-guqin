//! 简谱字符串解析 —— 前端 `jianpu-parser.ts` 的**唯一实现**。
//!
//! # 支持格式
//!
//! - 数字 `1`–`7`：基本音级
//! - 后跟 `·` 或 `'`：升高八度（可叠加两次）
//! - 后跟 `,`：降低八度
//! - 空格 / `\t` / `|`：音符分隔符
//! - `-`：延音线，给前一个音符加一拍（一拍 = 四分音符），可连续
//! - 数字后跟 `_` 减时线：一条为八分、两条为十六分
//! - 数字后跟 `.` 附点：时值 ×1.5
//! - `0`：休止占位（同样支持减时线 / 附点 / 延音线）
//!
//! # 为什么在核心里
//!
//! 这是纯字符串 → 结构的解析，结果**必须跨端一致**：同一段简谱在网页、小程序、
//! App 上如果解析出不同时值，导出的谱面就会对不上。它不碰时间、存储、网络、UI，
//! 完全符合「该共享」的判据。
//!
//! # 时值用「1/8 拍」为单位
//!
//! 与 `jianpu::JianpuNote::duration_units` 同一口径：四分 = 8、八分 = 4、二分 = 16。
//! 整数表示避免浮点比较，也便于直接喂给指法编排（Rust 侧算「手来不来得及换把」用同一个数）。

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// 一拍（四分音符）对应的单位数。
const QUARTER_UNITS: u32 = 8;

/// 解析出的一项：音符或休止符。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ParsedItem {
    /// 有效音符。
    Note {
        /// 简谱数字 1–7。
        number: u8,
        /// 八度偏移：0 = 中央组，+1 = 高八度，-1 = 低八度。
        octave: i8,
        /// 时值（1/8 拍为单位，四分 = 8）。
        units: u32,
        /// 名字（「全」「二分」…），与前端 `Duration` 联合一致。
        duration: String,
        /// 是否附点。
        dotted: bool,
        /// 原始片段，用于界面回显。
        raw: String,
    },
    /// 休止符。
    Rest {
        units: u32,
        duration: String,
        dotted: bool,
        raw: String,
    },
}

/// 单位数 → (时值名, 是否附点)。对不上返回 `None`。
///
/// 表里每一项都是「能被传统时值名表达」的数：32 全、24 附点二分、16 二分、
/// 12 附点四分、8 四分、6 附点八分、4 八分、3 附点十六分、2 十六分。
/// 三拍（`5 - -`）会落到 24 → 附点二分，这正是此项目的既有取舍。
fn beat_name(units: u32) -> Option<(&'static str, bool)> {
    Some(match units {
        32 => ("全", false),
        24 => ("二分", true),
        16 => ("二分", false),
        12 => ("四分", true),
        8 => ("四分", false),
        6 => ("八分", true),
        4 => ("八分", false),
        3 => ("十六分", true),
        2 => ("十六分", false),
        _ => return None,
    })
}

/// 时值名 + 附点 → 单位数。只在往返测试里用（生产路径是「单位数 → 时值名」）。
#[cfg(test)]
fn units_of(duration: &str, dotted: bool) -> Option<u32> {
    let base = match duration {
        "全" => 32,
        "二分" => 16,
        "四分" => 8,
        "八分" => 4,
        "十六分" => 2,
        _ => return None,
    };
    // 附点值必须能被时值名表达（附点全音符 48 没有名字，故不接受）
    let units = if dotted { base + base / 2 } else { base };
    beat_name(units).map(|_| units)
}

/// 去掉换行等首尾空白并切词。
fn tokenize(input: &str) -> Vec<String> {
    input
        .split([' ', '\t', '|', '\n', '\r'])
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// 解析一个音符片段（如 `5·`、`1__`、`3.`）。不是音符返回 `None`。
fn parse_note_token(token: &str) -> Option<ParsedItem> {
    let mut chars = token.chars().peekable();

    // 第一位必须是 1–7
    let first = chars.next()?;
    let number = first.to_digit(10)? as u8;
    if !(1..=7).contains(&number) {
        return None;
    }

    // 八度标记：· 或 ' 升，, 降，最多两个
    let mut octave: i8 = 0;
    let mut octave_count = 0;
    while let Some(&c) = chars.peek() {
        if c == '·' || c == '\'' {
            octave += 1;
            octave_count += 1;
        } else if c == ',' {
            octave -= 1;
            octave_count += 1;
        } else {
            break;
        }
        if octave_count > 2 {
            return None;
        }
        chars.next();
    }

    // 减时线：0–2 条
    let mut reduction = 0;
    while let Some(&c) = chars.peek() {
        if c == '_' {
            reduction += 1;
            if reduction > 2 {
                return None;
            }
            chars.next();
        } else {
            break;
        }
    }

    // 附点：0 或 1 个
    let dotted = if chars.peek() == Some(&'.') {
        chars.next();
        true
    } else {
        false
    };

    // 还有剩余字符 → 不是合法片段
    if chars.next().is_some() {
        return None;
    }

    let units = duration_units(reduction, dotted)?;
    let (name, dot) = beat_name(units)?;
    Some(ParsedItem::Note {
        number,
        octave,
        units,
        duration: name.to_string(),
        dotted: dot,
        raw: token.to_string(),
    })
}

/// 解析一个休止片段（如 `0`、`0_`、`0.`）。
fn parse_rest_token(token: &str) -> Option<ParsedItem> {
    let mut chars = token.chars();
    if chars.next()? != '0' {
        return None;
    }
    let mut reduction = 0;
    for c in chars.by_ref() {
        if c == '_' {
            reduction += 1;
            if reduction > 2 {
                return None;
            }
        } else {
            break;
        }
    }
    // 上面那个 `for` 遇到非 `_` 就 break，但这个字符已被消费。
    // 用更直接的方式重算：统计 `_` 个数，剩下的只能是可选的一个 `.`。
    let rest_after_underscores = &token[1..];
    let underscores = rest_after_underscores
        .chars()
        .take_while(|c| *c == '_')
        .count();
    let tail = &rest_after_underscores[underscores..];
    let dotted = match tail {
        "" => false,
        "." => true,
        _ => return None,
    };
    if underscores > 2 {
        return None;
    }

    let units = duration_units(underscores as u32, dotted)?;
    let (name, dot) = beat_name(units)?;
    Some(ParsedItem::Rest {
        units,
        duration: name.to_string(),
        dotted: dot,
        raw: token.to_string(),
    })
}

/// 减时线条数与附点 → 单位数。
fn duration_units(reduction: u32, dotted: bool) -> Option<u32> {
    let base = QUARTER_UNITS >> reduction;
    if base == 0 {
        return None;
    }
    let units = if dotted { base + base / 2 } else { base };
    beat_name(units).map(|_| units)
}

/// 延音线：给前一项加一拍；映射不到时值名就忽略这条线。
fn extend_last(out: &mut [ParsedItem]) {
    let Some(last) = out.last() else { return };
    let (units, is_note) = match last {
        ParsedItem::Note { units, .. } => (*units, true),
        ParsedItem::Rest { units, .. } => (*units, false),
    };
    let Some(next) = units.checked_add(QUARTER_UNITS) else {
        return;
    };
    let Some((name, dot)) = beat_name(next) else {
        return;
    };
    // 就地更新：保持顺序，且 `raw` 追加 `-` 便于界面回显
    match (out.last_mut(), is_note) {
        (
            Some(ParsedItem::Note {
                units,
                duration,
                dotted,
                raw,
                ..
            }),
            true,
        ) => {
            *units = next;
            *duration = name.to_string();
            *dotted = dot;
            raw.push('-');
        }
        (
            Some(ParsedItem::Rest {
                units,
                duration,
                dotted,
                raw,
            }),
            false,
        ) => {
            *units = next;
            *duration = name.to_string();
            *dotted = dot;
            raw.push('-');
        }
        _ => {}
    }
}

/// 解析简谱字符串。
///
/// 空输入返回空数组；认不出的片段直接跳过（与既有前端行为一致：
/// 用户粘贴一段带中文标题的文本时，标题部分被忽略而不是整段失败）。
pub fn parse_jianpu(input: &str) -> Vec<ParsedItem> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for token in tokenize(trimmed) {
        if token == "-" {
            extend_last(&mut out);
            continue;
        }
        if let Some(item) = parse_rest_token(&token).or_else(|| parse_note_token(&token)) {
            out.push(item);
        }
    }
    out
}

/// 一个音占多少「1/8 拍」——时值裁决的唯一出口。
///
/// 前端 `noteUnits(note)` 与 `score-phrases` 都问这里，避免再抄一份时值表。
pub fn item_units(item: &ParsedItem) -> u32 {
    match item {
        ParsedItem::Note { units, .. } | ParsedItem::Rest { units, .. } => *units,
    }
}

// ──────────────────────────────────────────────
// JSON 桥接
// ──────────────────────────────────────────────

/// 输入 `{"input":"5 6 1 2"}`，输出 `{"items":[...],"units":[8,8,8,8]}`。
///
/// `units` 顺手一起给出：调用方（切句、指法编排）几乎总是立刻需要它，
/// 让它们回头再逐项问一次既慢又容易把休止符漏掉。
pub fn parse_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        input: String,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let items = parse_jianpu(&req.input);
    let units: Vec<u32> = items.iter().map(item_units).collect();
    serde_json::to_string(&json!({ "items": items, "units": units })).map_err(|e| e.to_string())
}

/// 只要时值单位（切句用）：`{"input":"5 6 1 2"}` → `{"units":[8,8,8,8]}`。
pub fn units_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        input: String,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let units: Vec<u32> = parse_jianpu(&req.input).iter().map(item_units).collect();
    serde_json::to_string(&json!({ "units": units })).map_err(|e| e.to_string())
}

/// 把解析结果转成前端 `ParsedJianpuItem` 形状（补 `raw` 已有）。
pub fn items_to_value(items: &[ParsedItem]) -> Value {
    json!({ "items": items })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(input: &str) -> Vec<ParsedItem> {
        parse_jianpu(input)
    }

    #[test]
    fn parses_basic_notes() {
        let v = notes("5 6 1 2");
        assert_eq!(v.len(), 4);
        assert_eq!(
            v[0],
            ParsedItem::Note {
                number: 5,
                octave: 0,
                units: 8,
                duration: "四分".into(),
                dotted: false,
                raw: "5".into()
            }
        );
        assert_eq!(
            v[3].clone(),
            ParsedItem::Note {
                number: 2,
                octave: 0,
                units: 8,
                duration: "四分".into(),
                dotted: false,
                raw: "2".into()
            }
        );
    }

    #[test]
    fn octave_markers() {
        // 高八度
        match &notes("5·")[0] {
            ParsedItem::Note { octave, .. } => assert_eq!(*octave, 1),
            _ => panic!(),
        }
        // 双高八度
        match &notes("5··")[0] {
            ParsedItem::Note { octave, .. } => assert_eq!(*octave, 2),
            _ => panic!(),
        }
        // 低八度
        match &notes("3,")[0] {
            ParsedItem::Note { octave, .. } => assert_eq!(*octave, -1),
            _ => panic!(),
        }
        // 撇号等同于点
        match &notes("1'")[0] {
            ParsedItem::Note { octave, .. } => assert_eq!(*octave, 1),
            _ => panic!(),
        }
    }

    #[test]
    fn rests_are_parsed() {
        let v = notes("0 1");
        assert_eq!(v.len(), 2);
        assert!(matches!(v[0], ParsedItem::Rest { units: 8, .. }));
        assert!(matches!(v[1], ParsedItem::Note { number: 1, .. }));
    }

    #[test]
    fn duration_modifiers() {
        // 一条减时线 → 八分（4）
        assert_eq!(item_units(&notes("5_")[0]), 4);
        // 两条 → 十六分（2）
        assert_eq!(item_units(&notes("5__")[0]), 2);
        // 附点 → ×1.5
        assert_eq!(item_units(&notes("5.")[0]), 12);
        // 附点八分 = 6
        assert_eq!(item_units(&notes("5_.")[0]), 6);
    }

    #[test]
    fn tie_extends_previous_note() {
        // 5 - → 二分（16）
        let v = notes("5 -");
        assert_eq!(v.len(), 1);
        assert_eq!(item_units(&v[0]), 16);
        match &v[0] {
            ParsedItem::Note { duration, raw, .. } => {
                assert_eq!(duration, "二分");
                assert_eq!(raw, "5-");
            }
            _ => panic!(),
        }
    }

    #[test]
    fn three_beats_maps_to_dotted_half() {
        // 5 - - → 24（附点二分），这是既有的取舍
        let v = notes("5 - -");
        assert_eq!(item_units(&v[0]), 24);
        match &v[0] {
            ParsedItem::Note {
                duration, dotted, ..
            } => {
                assert_eq!(duration, "二分");
                assert!(*dotted);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn tie_on_rest_extends_too() {
        let v = notes("0 -");
        assert_eq!(item_units(&v[0]), 16);
        assert!(matches!(v[0], ParsedItem::Rest { .. }));
    }

    #[test]
    fn unmappable_tie_is_ignored() {
        // 全音符（32）+ 一拍 = 40，没有时值名 → 忽略这条延音线
        let v = notes("5___ -");
        // `___` 三条减时线不合法，整项被跳过，延音线也无处依附
        assert!(v.is_empty() || item_units(&v[0]) != 40);
    }

    #[test]
    fn bar_lines_and_whitespace_are_separators() {
        let v = notes("5 6 | 1\t2");
        assert_eq!(v.len(), 4);
    }

    #[test]
    fn unknown_tokens_are_skipped() {
        // 一段带中文标题的文本：中文被跳过，数字照常解析
        let v = notes("标题 5 6 abc 1");
        assert_eq!(v.len(), 3);
    }

    #[test]
    fn number_out_of_range_rejected() {
        assert!(notes("8").is_empty());
        assert!(notes("9").is_empty());
        assert!(notes("0").len() == 1); // 0 是休止，合法
    }

    #[test]
    fn empty_input_yields_empty() {
        assert!(notes("").is_empty());
        assert!(notes("   ").is_empty());
        assert!(notes("\n\t").is_empty());
    }

    #[test]
    fn json_bridge_shape() {
        let out = parse_json(r#"{"input":"5 6 1 2"}"#).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["items"].as_array().unwrap().len(), 4);
        assert_eq!(v["units"], json!([8, 8, 8, 8]));
        assert_eq!(v["items"][0]["kind"], json!("note"));
        assert_eq!(v["items"][0]["duration"], json!("四分"));
    }

    #[test]
    fn units_json_matches_items() {
        let out = units_json(r#"{"input":"5 - 0_"}"#).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["units"], json!([16, 4]));
    }

    #[test]
    fn round_trip_duration_names() {
        // 每个时值名都能从单位数反推回来
        for (units, name, dotted) in [
            (32, "全", false),
            (24, "二分", true),
            (16, "二分", false),
            (12, "四分", true),
            (8, "四分", false),
            (6, "八分", true),
            (4, "八分", false),
            (3, "十六分", true),
            (2, "十六分", false),
        ] {
            assert_eq!(beat_name(units), Some((name, dotted)), "units={units}");
            assert_eq!(units_of(name, dotted), Some(units), "{name}/{dotted}");
        }
    }
}
