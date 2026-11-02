//! 减字谱量化分析 —— 字频统计 + 写法变体归并。
//!
//! LiberWord 一文在讲完「结构化字全表」之后，点出了它最大的附加价值：
//! 「可以很方便的对所有数据**进一步量化分析**……某个字在历史过程中的演进、
//! 最早的出处、在不同时期的**流行程度**」。
//! 本文不做「历史演进」（没有古籍语料），但能先做最基础的两件事：
//!
//! 1. **字频统计**：拿到一首曲谱，统计每个减字出现了多少次、占比多少。
//! 2. **变体归并**：减字谱同一指法常有多种写法（名/夕、食/亻、勾的省写勹、
//!    挑的省写乚……）。统计时按**归一化字形**聚合，把不同写法折算成同一个减字，
//!    同时回列出该字出现过的原始写法——这正是 LiberWord「系统自动合并所有标注」
//!    的核心思想在「字」这一层的落地。
//!
//! 全部逻辑在 Rust，通过 `wasm.rs` 以 JSON 桥接；前端只渲染表格。
//!
//! 复用 `jianzi_dictionary::glyph_text` 做聚合键：它已经把 夕→名、亻→食、
//! 乚→挑、勹→勾、木→抹、丁→打 等写法归一，所以「同一个字的多种写法」天然合并。

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::jianzi_dictionary::JianziDictState;

/// 一条减字的字频统计行（按归一化字形聚合后）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JianziFreqRow {
    /// 归一化字形文本（如「大九勾四」「名九勾四」），用作稳定 id 与渲染字形。
    pub id: String,
    /// 人话读法（如「按音 大指 九徽 勾 四弦」）。
    pub label: String,
    /// 出现次数。
    pub count: usize,
    /// 占比（0–1），相对总有效音符数。
    pub ratio: f64,
    /// 代表状态的部件（已归一化，供前端重建 `JianziState` 渲染字形）。
    #[serde(rename = "toneType")]
    pub tone_type: String,
    #[serde(rename = "leftFinger")]
    pub left_finger: Option<String>,
    #[serde(rename = "rightAction")]
    pub right_action: Option<String>,
    #[serde(rename = "hui")]
    pub hui: Option<String>,
    #[serde(rename = "fen")]
    pub fen: Option<String>,
    #[serde(rename = "slide")]
    pub slide: Option<String>,
    #[serde(rename = "stringNumber")]
    pub string_number: Option<String>,
    /// 出现过的原始左手指法写法（如 ["名","夕"]）。多于 1 个即说明该字存在写法变体。
    #[serde(rename = "leftVariants")]
    pub left_variants: Vec<String>,
    /// 出现过的原始右手指法写法（如 ["勾","乚"]）。
    #[serde(rename = "actionVariants")]
    pub action_variants: Vec<String>,
}

/// 聚合累加器（内部）。
struct Acc {
    /// 该组第一个减字状态，作为渲染代表。
    rep: JianziDictState,
    count: usize,
    left_variants: HashSet<String>,
    action_variants: HashSet<String>,
}

/// 对一串音符做减字字频统计，按归一化字形聚合，返回按次数降序排列的行。
///
/// 归一化靠 `jianzi_dictionary::glyph_text`：它已把夕→名、亻→食、省写→全字，
/// 因此「名九勾四」与「夕九乚四」会落到同一行。
pub fn analyze_frequency(notes: Vec<JianziDictState>) -> Vec<JianziFreqRow> {
    let mut groups: HashMap<String, Acc> = HashMap::new();
    for n in notes {
        let id = crate::jianzi_dictionary::glyph_text(&n);
        let acc = groups.entry(id).or_insert_with(|| Acc {
            rep: n.clone(),
            count: 0,
            left_variants: HashSet::new(),
            action_variants: HashSet::new(),
        });
        acc.count += 1;
        if let Some(l) = &n.left_finger {
            acc.left_variants.insert(l.clone());
        }
        if let Some(a) = &n.right_action {
            acc.action_variants.insert(a.clone());
        }
    }

    let total: usize = groups.values().map(|g| g.count).sum();
    let mut rows: Vec<JianziFreqRow> = groups
        .into_iter()
        .map(|(id, acc)| {
            let rep = &acc.rep;
            let mut left_variants: Vec<String> = acc.left_variants.into_iter().collect();
            left_variants.sort();
            let mut action_variants: Vec<String> = acc.action_variants.into_iter().collect();
            action_variants.sort();
            JianziFreqRow {
                id,
                label: crate::jianzi_dictionary::describe(rep),
                count: acc.count,
                ratio: if total > 0 {
                    acc.count as f64 / total as f64
                } else {
                    0.0
                },
                tone_type: rep.tone_type.clone(),
                left_finger: rep.left_finger.clone(),
                right_action: rep.right_action.clone(),
                hui: rep.hui.clone(),
                fen: rep.fen.clone(),
                slide: rep.slide.clone(),
                string_number: rep.string_number.clone(),
                left_variants,
                action_variants,
            }
        })
        .collect();

    // 次数降序；同次数按字形 id 字典序，保证输出稳定可测。
    rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.id.cmp(&b.id)));
    rows
}

/// wasm 入口：接收 `{ notes: [...JianziDictState...] }`，返回 `{ total, rows }` JSON。
pub fn get_jianzi_frequency_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Req {
        #[serde(default)]
        notes: Vec<JianziDictState>,
    }
    let req: Req = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    let rows = analyze_frequency(req.notes);
    let total = rows.iter().map(|r| r.count).sum::<usize>();
    Ok(serde_json::json!({ "total": total, "rows": rows }).to_string())
}

/// 减字谱常见写法变体对照（同一指法的不同写法）。
///
/// 直接回应文章「搞清楚从古到今到底有多少个减字、**每个字有多少变体**」。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantGroup {
    /// 归并后的规范写法（字频聚合的落点）。
    pub canonical: String,
    /// 该写法在各种流派 / 抄本中出现过的变体形态。
    pub variants: Vec<String>,
    /// 说明（省写规则 / 同指异写）。
    pub note: String,
}

/// 返回左右手指法与右手指法的变体对照表。
///
/// 这些映射与 `jianzi_dictionary` 里 `glyph_text` 的归一规则一致：
/// 例如 `夕` 归一为 `名`、`乚` 归一为 `挑`，所以变体表里的分组就是字频统计的合并规则。
pub fn variant_groups() -> Vec<VariantGroup> {
    vec![
        VariantGroup {
            canonical: "名指".into(),
            variants: vec!["名".into(), "夕".into()],
            note: "『名』取左半作『夕』，传统减字谱两写并存".into(),
        },
        VariantGroup {
            canonical: "食指".into(),
            variants: vec!["食".into(), "亻".into()],
            note: "『食』取左半作『亻』".into(),
        },
        VariantGroup {
            canonical: "勾".into(),
            variants: vec!["勾".into(), "勹".into()],
            note: "勾的省写为包字头『勹』".into(),
        },
        VariantGroup {
            canonical: "挑".into(),
            variants: vec!["挑".into(), "乚".into()],
            note: "挑的省写为竖弯钩『乚』".into(),
        },
        VariantGroup {
            canonical: "抹".into(),
            variants: vec!["抹".into(), "木".into()],
            note: "抹的省写为『木』".into(),
        },
        VariantGroup {
            canonical: "打".into(),
            variants: vec!["打".into(), "丁".into()],
            note: "打的省写为『丁』".into(),
        },
        VariantGroup {
            canonical: "劈".into(),
            variants: vec!["劈".into(), "擘".into(), "尸".into()],
            note: "大指向内，擘 / 劈同指异写，省写作『尸』".into(),
        },
        VariantGroup {
            canonical: "托".into(),
            variants: vec!["托".into(), "乇".into()],
            note: "托的省写为『乇』".into(),
        },
    ]
}

/// wasm 入口：返回变体对照表 JSON。
pub fn get_jianzi_variant_groups_json() -> String {
    serde_json::to_string(&variant_groups()).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(
        tone: &str,
        action: &str,
        string: &str,
        left: Option<&str>,
        hui: Option<&str>,
    ) -> JianziDictState {
        JianziDictState {
            tone_type: tone.to_string(),
            left_finger: left.map(str::to_string),
            hui: hui.map(str::to_string),
            fen: None,
            slide: None,
            right_action: Some(action.to_string()),
            string_number: Some(string.to_string()),
        }
    }

    #[test]
    fn test_merges_left_variants() {
        // 名指 与 夕 应合并为同一减字
        let notes = vec![
            note("按", "勾", "四", Some("名"), Some("九")),
            note("按", "勾", "四", Some("夕"), Some("九")),
            note("按", "勾", "四", Some("夕"), Some("九")),
        ];
        let rows = analyze_frequency(notes);
        assert_eq!(rows.len(), 1, "名/夕 应合并为一条");
        assert_eq!(rows[0].count, 3);
        assert_eq!(rows[0].id, "名九勾四", "归一化 id 应取『名』");
        assert_eq!(rows[0].left_variants.len(), 2);
        assert!(rows[0].left_variants.contains(&"名".to_string()));
        assert!(rows[0].left_variants.contains(&"夕".to_string()));
    }

    #[test]
    fn test_merges_action_radicals() {
        // 勾 的省写 勹 应与 勾 合并（注意：勹=勾、乚=挑）
        let notes = vec![
            note("散", "勾", "三", None, None),
            note("散", "勹", "三", None, None),
        ];
        let rows = analyze_frequency(notes);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].count, 2);
        assert_eq!(rows[0].id, "散勾三");
        assert_eq!(rows[0].action_variants.len(), 2);
        assert!(rows[0].action_variants.contains(&"勾".to_string()));
        assert!(rows[0].action_variants.contains(&"勹".to_string()));
    }

    #[test]
    fn test_ratio_and_sort() {
        let notes = vec![
            note("散", "勾", "三", None, None),
            note("散", "勾", "三", None, None),
            note("散", "勾", "三", None, None),
            note("散", "挑", "三", None, None),
        ];
        let rows = analyze_frequency(notes);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "散勾三");
        assert_eq!(rows[0].count, 3);
        assert!((rows[0].ratio - 0.75).abs() < 1e-9);
        assert_eq!(rows[1].id, "散挑三");
        assert!((rows[1].ratio - 0.25).abs() < 1e-9);
    }

    #[test]
    fn test_distinct_glyphs_kept_separate() {
        // 不同徽位属不同减字，不能混为一谈
        let notes = vec![
            note("按", "勾", "四", Some("大"), Some("九")),
            note("按", "勾", "四", Some("大"), Some("十")),
        ];
        let rows = analyze_frequency(notes);
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn test_san_note_ignores_left_and_hui() {
        // 散音不参与左手/徽位，即便传了也应归一成同一散音字
        let notes = vec![
            note("散", "勾", "三", Some("大"), Some("九")),
            note("散", "勾", "三", None, None),
        ];
        let rows = analyze_frequency(notes);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "散勾三");
    }

    #[test]
    fn test_get_json_roundtrip() {
        let notes = vec![
            note("散", "勾", "三", None, None),
            note("散", "勹", "三", None, None),
        ];
        let input = serde_json::json!({ "notes": notes }).to_string();
        let out = get_jianzi_frequency_json(&input).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["total"], 2);
        assert_eq!(v["rows"].as_array().unwrap().len(), 1);
        assert_eq!(v["rows"][0]["id"], "散勾三");
        assert_eq!(v["rows"][0]["count"], 2);
        assert!(v["rows"][0]["label"].is_string());
    }

    #[test]
    fn test_empty_notes() {
        let rows = analyze_frequency(vec![]);
        assert!(rows.is_empty());
        let out = get_jianzi_frequency_json("{}").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["total"], 0);
        assert_eq!(v["rows"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_variant_groups() {
        let groups = variant_groups();
        assert!(
            groups
                .iter()
                .any(|g| g.canonical == "名指" && g.variants.len() == 2)
        );
        assert!(
            groups
                .iter()
                .any(|g| g.canonical == "勾" && g.variants.contains(&"勹".to_string()))
        );
        assert!(
            groups
                .iter()
                .any(|g| g.canonical == "挑" && g.variants.contains(&"乚".to_string()))
        );
        // 劈 的规范落点与 glyph_text 的归一一致（尸 是省写）
        assert!(
            groups
                .iter()
                .any(|g| g.canonical == "劈" && g.variants.contains(&"尸".to_string()))
        );
        let json = get_jianzi_variant_groups_json();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.as_array().unwrap().len() >= 6);
    }
}
