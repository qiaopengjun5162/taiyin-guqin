//! 谱字节点树（`Puzi`）。
//!
//! # 为什么需要这一层
//!
//! `GuqinNote` 是**扁平的单音**：一个音色 + 一个左手位置 + 一个右手动作 + 一根弦。
//! 它能描述的真实谱字，减字谱里还有三类装不下（`docs/architecture/borrowings.md` 第一节）：
//!
//! 1. **撮式**：一句话同时弹两根弦（如「撮大七七三散四」）。拆成两个 `GuqinNote`
//!    就把「这是同一个谱字、同一拍」的语义丢了。
//! 2. **旁注**：主音之后的两步走手落点（「上七徽九分」「二上七六」）。
//!    塞进 `ornaments` 只是字形，丢掉了「走到哪个徽位」的结构。
//! 3. **独体**：不发声、但单独占一个谱字位的谱面记号（少息、再作等）。
//!
//! 对应 alephpi/jianzipu 归纳的四类语法形式，第四类（联袂指法）**故意不在这里**：
//! 联袂在 `crates/taiyin-core/src/lianmei.rs` 已经是「音符之间的关系」，
//! 做成 `Puzi` 的一个变体就会有两套互相竞争的成组模型。记号是谱字本身，
//! 联袂是谱字之间的关系——这个区别要守住。
//!
//! # 兼容策略：`untagged` + `Simple` 打头
//!
//! 所有已存曲谱的 `notes` 都是裸 `GuqinNote` JSON。`#[serde(untagged)]` 让它们
//! 原样反序列化成 `Puzi::Simple`，序列化回去逐字段不变；`Simple` 必须排第一，
//! 否则一个裸音符可能被后面的变体抢走。`Puzi` 的完整测试在文件末尾。

use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

use crate::{GuqinNote, GuqinScore, HuiPosition, StructureMark};

fn error_json(message: &str) -> String {
    json!({ "error": message }).to_string()
}

/// 一个谱字。叶子是 `GuqinNote`，复杂形式在这里分层承载。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, TS)]
#[ts(export_to = "Puzi.ts")]
#[serde(untagged)]
pub enum Puzi {
    /// 简单形式：一个谱字一个音。所有旧曲谱音符都落在这里。
    Simple(GuqinNote),

    /// 撮式：同一拍两个发声点，整体是一个谱字。
    /// 用 `Box` 是为了不让大变体把枚举撑大（`GuqinNote` 带 Vec 字段）。
    Cuochuo {
        first: Box<GuqinNote>,
        second: Box<GuqinNote>,
    },

    /// 旁注：主音之后的走手落点序列，按出现顺序。
    /// 空 `moves` 没有意义，但不是错误——它可能来自「只写了主音、旁注还没填」。
    Annotation {
        note: Box<GuqinNote>,
        moves: Vec<HuiPosition>,
    },

    /// 独体：不发声、单独占位的谱面记号。
    Standalone { mark: StructureMark },
}

impl From<GuqinNote> for Puzi {
    fn from(note: GuqinNote) -> Self {
        Self::Simple(note)
    }
}

/// 只有简单形式能无损压回单音。复杂形式宁可报错，也不悄悄丢掉一半。
impl TryFrom<Puzi> for GuqinNote {
    type Error = String;

    fn try_from(puzi: Puzi) -> Result<Self, Self::Error> {
        match puzi {
            Puzi::Simple(note) => Ok(note),
            Puzi::Cuochuo { .. } => {
                Err("撮式是一个谱字两个发声点，压成单个音符会丢掉同时发声的语义".to_string())
            }
            Puzi::Annotation { .. } => {
                Err("旁注是走手落点序列，压成单个音符会丢掉落点".to_string())
            }
            Puzi::Standalone { .. } => Err("谱面记号不发声，没有对应的单个音符".to_string()),
        }
    }
}

/// 把一个 `Puzi` 压回单音的 JSON 桥接（供 WASM / HTTP 绑定层调用）。
///
/// 输入：`{"puzi": <Puzi JSON>}`；输出：`{"note": <GuqinNote>}` 或 `{"error": "..."}`。
/// 复杂形式给错误而不是降级成第一个音——「丢一半」比报错难查。
pub fn to_note_json(input_json: &str) -> String {
    #[derive(Deserialize)]
    struct Input {
        puzi: Puzi,
    }
    let input = match serde_json::from_str::<Input>(input_json) {
        Ok(v) => v,
        Err(e) => return error_json(&format!("谱字 JSON 解析失败：{e}")),
    };
    match GuqinNote::try_from(input.puzi) {
        Ok(note) => json!({ "note": note }).to_string(),
        Err(e) => error_json(&e),
    }
}

/// 统计一首曲子里四种谱字形式各有多少。
///
/// 输入：`GuqinScore` JSON；输出：`{"total":n,"simple":n,"cuochuo":n,"annotation":n,"standalone":n}`。
/// 这是旧谱与新谱的**可观测分界**：旧谱全部落 simple，出现其它三种才说明有人真的用了新模型。
/// 编辑器将来要提示「这一句里有撮式，当前渲染器还画不出来」，靠的就是这个计数。
pub fn score_summary_json(input_json: &str) -> String {
    let score = match serde_json::from_str::<GuqinScore>(input_json) {
        Ok(v) => v,
        Err(e) => return error_json(&format!("曲谱 JSON 解析失败：{e}")),
    };
    let (mut simple, mut cuochuo, mut annotation, mut standalone) = (0, 0, 0, 0);
    for puzi in &score.notes {
        match puzi {
            Puzi::Simple(_) => simple += 1,
            Puzi::Cuochuo { .. } => cuochuo += 1,
            Puzi::Annotation { .. } => annotation += 1,
            Puzi::Standalone { .. } => standalone += 1,
        }
    }
    json!({
        "total": score.notes.len(),
        "simple": simple,
        "cuochuo": cuochuo,
        "annotation": annotation,
        "standalone": standalone,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RightAction, StringNumber};
    use serde_json::{Value, json};

    fn san_gou_san() -> GuqinNote {
        GuqinNote::open_string(RightAction::Gou, StringNumber::new(3).unwrap())
    }

    fn san_tiao_wu() -> GuqinNote {
        GuqinNote::open_string(RightAction::Tiao, StringNumber::new(5).unwrap())
    }

    #[test]
    fn old_note_json_is_simple_and_roundtrips_byte_for_byte() {
        // 这是「旧曲谱不破」的核心断言：裸 GuqinNote JSON 经过 Puzi 往返后，
        // 作为 JSON 值逐字段相等（不依赖字段顺序，但一个字段都不能多/少/变）。
        let old = serde_json::to_value(san_gou_san()).unwrap();
        let puzi: Puzi = serde_json::from_value(old.clone()).unwrap();
        assert_eq!(puzi, Puzi::Simple(san_gou_san()));
        assert_eq!(serde_json::to_value(&puzi).unwrap(), old);
    }

    #[test]
    fn old_score_json_with_plain_notes_still_deserializes() {
        // 老 score 的 notes 是 [{...GuqinNote...}]，没有 kind 字段。
        // 这一条若红，说明每次打开旧谱都要先迁移，那就不是「兼容」了。
        let note = serde_json::to_value(san_tiao_wu()).unwrap();
        let old = json!({
            "title": "练习曲", "author": "太音", "tuning": "ZhengDiao",
            "beat_numerator": 4, "beat_denominator": 4, "bpm": 80, "version": 1,
            "notes": [note.clone(), note.clone()],
        });
        let score: crate::GuqinScore = serde_json::from_value(old.clone()).unwrap();
        assert_eq!(score.notes.len(), 2);
        assert!(score.notes.iter().all(|n| matches!(n, Puzi::Simple(_))));
        assert_eq!(serde_json::to_value(&score).unwrap(), old);
    }

    #[test]
    fn from_note_then_try_into_note_is_identity() {
        let note = san_gou_san();
        let back = GuqinNote::try_from(Puzi::from(note.clone())).unwrap();
        assert_eq!(back, note);
    }

    #[test]
    fn cuochuo_keeps_both_plucks_in_one_puzi() {
        let p = Puzi::Cuochuo {
            first: Box::new(san_gou_san()),
            second: Box::new(san_tiao_wu()),
        };
        let json = serde_json::to_value(&p).unwrap();
        let back: Puzi = serde_json::from_value(json).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn annotation_keeps_hui_positions() {
        let p = Puzi::Annotation {
            note: Box::new(san_gou_san()),
            moves: vec![HuiPosition {
                hui: crate::Hui::new(7).unwrap(),
                fen: Some(9),
            }],
        };
        let json = serde_json::to_value(&p).unwrap();
        let back: Puzi = serde_json::from_value(json).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn standalone_keeps_structure_mark() {
        let p = Puzi::Standalone {
            mark: StructureMark::ShaoXi,
        };
        let json = serde_json::to_value(&p).unwrap();
        let back: Puzi = serde_json::from_value(json).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn complex_forms_refuse_to_collapse_into_one_note() {
        // 降级必须是显式错误，不能悄悄只留第一个音——那正是「丢一半」的 bug。
        for (puzi, hint) in [
            (
                Puzi::Cuochuo {
                    first: Box::new(san_gou_san()),
                    second: Box::new(san_tiao_wu()),
                },
                "两个发声点",
            ),
            (
                Puzi::Annotation {
                    note: Box::new(san_gou_san()),
                    moves: vec![],
                },
                "走手落点",
            ),
            (
                Puzi::Standalone {
                    mark: StructureMark::ShaoXi,
                },
                "不发声",
            ),
        ] {
            let err = GuqinNote::try_from(puzi).unwrap_err();
            assert!(err.contains(hint), "错误要说清为什么不能压：{err}");
        }
    }

    #[test]
    fn simple_wins_when_a_raw_note_has_unknown_extra_fields() {
        // untagged 按顺序匹配；Simple 放第一，且 GuqinNote 没开 deny_unknown_fields，
        // 所以将来加字段不会让旧 note 落到后面的变体上。
        let mut value = serde_json::to_value(san_gou_san()).unwrap();
        value["future_field"] = json!("whatever");
        let p: Puzi = serde_json::from_value(value).unwrap();
        assert!(matches!(p, Puzi::Simple(_)));
    }

    #[test]
    fn malformed_puzi_is_an_error_not_a_silent_simple() {
        // 乱写 kind 的复合形式不能因为「字段不够」就被 Simple 吞掉。
        let bad = json!({ "kind": "cuochuo", "first": null });
        assert!(serde_json::from_value::<Puzi>(bad).is_err());
    }

    #[test]
    fn to_note_json_collapses_only_simple() {
        let note = san_gou_san();
        let simple = json!({ "puzi": note });
        let out: Value = serde_json::from_str(&to_note_json(&simple.to_string())).unwrap();
        assert_eq!(out["note"], serde_json::to_value(&note).unwrap());
        assert!(out.get("error").is_none());

        let complex = json!({
            "puzi": { "first": note, "second": san_tiao_wu() }
        });
        let out: Value = serde_json::from_str(&to_note_json(&complex.to_string())).unwrap();
        assert!(out["error"].as_str().unwrap().contains("两个发声点"));
        assert!(out.get("note").is_none());

        let bad = serde_json::from_str::<Value>(&to_note_json("not json")).unwrap();
        assert!(bad["error"].as_str().unwrap().contains("解析失败"));
    }

    #[test]
    fn score_summary_counts_every_form() {
        let simple = serde_json::to_value(san_gou_san()).unwrap();
        let old = json!({
            "title": "旧谱", "author": "", "tuning": "ZhengDiao",
            "beat_numerator": 4, "beat_denominator": 4, "bpm": 80, "version": 1,
            "notes": [simple.clone(), simple.clone()],
        });
        let out: Value = serde_json::from_str(&score_summary_json(&old.to_string())).unwrap();
        assert_eq!(
            out,
            json!({
                "total": 2, "simple": 2, "cuochuo": 0, "annotation": 0, "standalone": 0,
            })
        );

        let mixed = json!({
            "title": "新谱", "author": "", "tuning": "ZhengDiao",
            "beat_numerator": 4, "beat_denominator": 4, "bpm": 80, "version": 1,
            "notes": [
                simple,
                { "first": san_gou_san(), "second": san_tiao_wu() },
                { "note": san_tiao_wu(), "moves": [] },
                { "mark": "少息" }
            ],
        });
        let out: Value = serde_json::from_str(&score_summary_json(&mixed.to_string())).unwrap();
        assert_eq!(
            out,
            json!({
                "total": 4, "simple": 1, "cuochuo": 1, "annotation": 1, "standalone": 1,
            })
        );
    }
}
