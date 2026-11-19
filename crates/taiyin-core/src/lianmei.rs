//! 联袂指法——成组、同度（放合可八度）的左右手配合。
//!
//! 定义依据（成公亮《减字谱指法符号简释》，多源一致）：
//!
//! - **分开**：右手抹/勾得声 → 左指上一位 → 右指挑/剔得声 → 左指复下原位。
//!   三声、两实一虚，首尾同度，整体只占**一个**简谱位置。
//! - **同声**（带合）：左指按弹后带起/抓起得散音，**同时**右弹空弦，两声如一声。
//! - **应合**：左按弹出声后右手连弹散音，左指走手到与散音相合的音位。通常二声以上。
//! - **放合**：按徽取声后内移放开空弦，随即按弹相邻弦（高八度）与放开的空弦相应。
//!
//! # 这一层的边界
//!
//! 只做两件事：把相邻的几个音**归成一组**，以及在删除/插入之后把不合法的组**解掉**。
//! 「同声要同时发声」这类语义由播放器读 `kind` 自己处理，不塞进这里——
//! 否则这层会变成「什么都管」的上帝模块。
//!
//! # 为什么在核心库而不是前端
//!
//! 成组规则是**结果必须一致**的逻辑：同一条曲谱，网页、小程序、App 算出来的组必须完全一样，
//! 否则同一份谱在不同端显示不同的联袂标记。它只依赖输入（音符 id 与标记），
//! 不碰时间、存储、网络、UI，可用 Rust 单独测试——完全符合「该共享」的判据。

use serde::{Deserialize, Serialize};

/// 联袂四种指法。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LianmeiKind {
    /// 分开：一个音分成两声（中间走手），整体占一个简谱位置。
    分开,
    /// 同声：按音带起/抓起的同时右弹空弦，两声同时响。
    同声,
    /// 应合：右手连弹散音，左指走手去合。
    应合,
    /// 放合：放开空弦后按弹相邻弦，同度或高八度相应。
    放合,
}

impl LianmeiKind {
    /// 默认成组时带几个后续音（四种都先按最小一声）。
    pub fn member_count(self) -> usize {
        1
    }

    /// 是否允许组首与成员差八度（只有放合允许）。
    pub fn allow_octave(self) -> bool {
        matches!(self, LianmeiKind::放合)
    }

    pub fn hint(self) -> &'static str {
        match self {
            LianmeiKind::同声 => "按音带起/抓起的同时右弹空弦，两声同时响",
            LianmeiKind::应合 => "右手连弹散音，左指走手去合",
            LianmeiKind::放合 => "放开空弦后按弹相邻弦，同度或高八度相应",
            LianmeiKind::分开 => "一个音分成两声（中间走手），整体占一个简谱位置",
        }
    }
}

/// 一条联袂关系。
///
/// 组内每个音都带这个字段，靠 `head_id` 归组；组首的 `head_id` 等于自己的 id。
/// 用 id 而不是下标，是因为删音/重排之后下标会整体前移，按下标存的组会散掉。
/// 相邻性不在这里保证——由 [`normalize_lianmei`] 兜（中间插了别的音就解组）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LianmeiLink {
    pub kind: LianmeiKind,
    #[serde(rename = "headId")]
    pub head_id: String,
}

/// 一个成立的联袂组。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LianmeiGroup {
    pub kind: LianmeiKind,
    #[serde(rename = "headIndex")]
    pub head_index: usize,
    #[serde(rename = "memberIndexes")]
    pub member_indexes: Vec<usize>,
}

/// 参与联袂计算的音符视图：只需要 id 与标记。
///
/// 不直接复用前端 `NoteColumn` 的全量字段：核心库不该知道简谱、时值、歌词这些
/// 与本算法无关的东西。调用方把 `(id, lianmei)` 抽出来即可，
/// 这样同一套逻辑也能服务将来的 `Puzi` 节点树。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LianmeiNote {
    pub id: String,
    pub lianmei: Option<LianmeiLink>,
}

/// 清理结果。`changed == false` 时调用方应沿用原数组引用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NormalizeResult {
    pub notes: Vec<LianmeiNote>,
    pub changed: bool,
}

/// 清掉不成立的联袂关系。
///
/// 判为不成立的情形，都是在编辑过程中**必然出现**的：
///
/// 1. `head_id` 指向的音已经不在了（组首被删）。
/// 2. 成员与组首不再相邻（中间插进了别的音）。
/// 3. 组首自己带着别人当 `head_id`（链条指向不存在的组）。
/// 4. 组内 `kind` 不一致（只可能来自手改存档）。
///
/// 返回 `changed == false` 表示没有任何要清的——调用方据此**沿用原引用**。
/// 这在渲染路径上很重要：每次返回新数组会让 React 认为谱面一直在变。
pub fn normalize_lianmei(notes: &[LianmeiNote]) -> NormalizeResult {
    use std::collections::HashMap;

    let index_by_id: HashMap<&str, usize> = notes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();

    // 组首是否成立：至少有一个紧随其后的成员，且成员与它同类同组。
    let head_is_valid = |head_idx: usize| -> bool {
        let head = &notes[head_idx];
        let Some(link) = &head.lianmei else {
            return false;
        };
        if link.head_id != head.id {
            return false;
        }
        match notes.get(head_idx + 1).and_then(|n| n.lianmei.as_ref()) {
            Some(f) => f.head_id == head.id && f.kind == link.kind,
            None => false,
        }
    };

    let mut changed = false;
    let mut next: Vec<LianmeiNote> = Vec::with_capacity(notes.len());

    for (i, note) in notes.iter().enumerate() {
        let Some(link) = &note.lianmei else {
            next.push(note.clone());
            continue;
        };

        let Some(&head_idx) = index_by_id.get(link.head_id.as_str()) else {
            changed = true;
            next.push(without_lianmei(note));
            continue;
        };

        let is_head = link.head_id == note.id;
        let head = &notes[head_idx];
        let head_link_ok =
            matches!(&head.lianmei, Some(h) if h.head_id == head.id && h.kind == link.kind);
        let position_ok = if is_head { head_idx == i } else { head_idx < i };

        if !head_link_ok || !position_ok {
            changed = true;
            next.push(without_lianmei(note));
            continue;
        }

        // 相邻性：组首到本音之间，每一列都必须是同一组的成员
        let contiguous = notes[(head_idx + 1)..=i].iter().all(|mid| {
            matches!(&mid.lianmei, Some(m) if m.head_id == link.head_id && m.kind == link.kind)
        });
        if !contiguous || (is_head && !head_is_valid(i)) {
            changed = true;
            next.push(without_lianmei(note));
            continue;
        }

        next.push(note.clone());
    }

    NormalizeResult {
        notes: next,
        changed,
    }
}

fn without_lianmei(note: &LianmeiNote) -> LianmeiNote {
    LianmeiNote {
        id: note.id.clone(),
        lianmei: None,
    }
}

/// 解析出所有成立的联袂组。
///
/// 只认「组首 + 紧随其后的连续成员」这一段：不连续的（中间隔音）直接忽略，
/// 与 [`normalize_lianmei`] 的判定保持一致，避免「这里算组、那里不算」。
pub fn lianmei_groups(notes: &[LianmeiNote]) -> Vec<LianmeiGroup> {
    let mut groups = Vec::new();

    for (i, note) in notes.iter().enumerate() {
        let Some(link) = &note.lianmei else {
            continue;
        };
        if link.head_id != note.id {
            continue;
        }

        let kind = link.kind;
        let mut member_indexes = Vec::new();
        for (j, later) in notes.iter().enumerate().skip(i + 1) {
            match &later.lianmei {
                Some(l) if l.head_id == note.id && l.kind == kind => member_indexes.push(j),
                _ => break,
            }
        }
        if !member_indexes.is_empty() {
            groups.push(LianmeiGroup {
                kind,
                head_index: i,
                member_indexes,
            });
        }
    }

    groups
}

/// 某一下标在联袂里的角色；不在任何组里返回 `None`。
pub fn lianmei_role_at(notes: &[LianmeiNote], index: usize) -> Option<(LianmeiKind, bool)> {
    let link = notes.get(index)?.lianmei.as_ref()?;
    let head = notes.iter().find(|n| n.id == link.head_id)?;
    head.lianmei.as_ref()?;
    Some((link.kind, link.head_id == notes[index].id))
}

/// 把 `head_index` 起的 `member_count` 个后续音与组首连成一组。
///
/// 越界时不硬凑：返回原数组。宁可「点了没反应」，也不要拿最后一个音凑一组——
/// 那会造出一组合法性没人能解释的谱。
pub fn link_lianmei(
    notes: &[LianmeiNote],
    head_index: usize,
    kind: LianmeiKind,
    member_count: Option<usize>,
) -> Vec<LianmeiNote> {
    let count = member_count.unwrap_or_else(|| kind.member_count());
    // 越界就不成组（含 count 为 0 的情况）
    if count < 1 || head_index + count > notes.len().saturating_sub(1) {
        return notes.to_vec();
    }

    let head_id = notes[head_index].id.clone();
    let mut next: Vec<LianmeiNote> = notes.to_vec();

    // 一次遍历同时完成「从旧组摘出」与「写入新组」，
    // 否则会出现「一员属两组」。顺序无关紧要，两步都在同一个下标上覆盖。
    for n in next.iter_mut().skip(head_index).take(count + 1) {
        n.lianmei = Some(LianmeiLink {
            kind,
            head_id: head_id.clone(),
        });
    }
    next
}

/// 解除以该下标为首（或该下标所在）的整组联袂。
pub fn clear_lianmei(notes: &[LianmeiNote], index: usize) -> Vec<LianmeiNote> {
    let Some(link) = notes.get(index).and_then(|n| n.lianmei.as_ref()) else {
        return notes.to_vec();
    };
    let head_id = link.head_id.clone();
    notes
        .iter()
        .map(|n| match &n.lianmei {
            Some(l) if l.head_id == head_id => without_lianmei(n),
            _ => n.clone(),
        })
        .collect()
}

/// 两个音的频率关系，用于判断这组联袂写不写得通。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LianmeiRelation {
    同度,
    八度,
    不合,
}

/// 判断频率关系。
///
/// 用**比例**而不是绝对差：绝对差在高音区太宽松（差 5Hz 在低音是一整个半音，
/// 在高音只是几音分），拿它判同度会把明显不同的音判成同度。
pub fn lianmei_relation(freq_a: Option<f64>, freq_b: Option<f64>) -> LianmeiRelation {
    let (Some(a), Some(b)) = (freq_a, freq_b) else {
        return LianmeiRelation::不合;
    };
    // 显式排除 NaN 与 Infinity：`a > 0.0` 对 NaN 为 false，但写法上直说更清楚，
    // 也让「推算不出音高」与「音高非法」走同一条路。
    if !a.is_finite() || !b.is_finite() || a <= 0.0 || b <= 0.0 {
        return LianmeiRelation::不合;
    }
    let ratio = a.max(b) / a.min(b);
    // 同度容差 1%：约 17 音分，宽出人耳能分辨的范围一点，用来吃掉浮点误差与
    // 徽位分的小数换算误差，但不足以把半音（6%）判成同度。
    if (ratio - 1.0).abs() <= 0.01 {
        LianmeiRelation::同度
    } else if (ratio - 2.0).abs() <= 0.02 {
        LianmeiRelation::八度
    } else {
        LianmeiRelation::不合
    }
}

/// 该关系是否符合这种联袂指法的要求。
pub fn relation_fits(kind: LianmeiKind, rel: LianmeiRelation) -> bool {
    match rel {
        LianmeiRelation::同度 => true,
        LianmeiRelation::八度 => kind.allow_octave(),
        LianmeiRelation::不合 => false,
    }
}

// ──────────────────────────────────────────────
// JSON 桥接（WASM / HTTP 共用）
// ──────────────────────────────────────────────

/// 四种指法的元数据，供客户端渲染按钮而不必抄一份。
pub fn options_json() -> String {
    let all = [
        LianmeiKind::同声,
        LianmeiKind::应合,
        LianmeiKind::放合,
        LianmeiKind::分开,
    ];
    let out: Vec<serde_json::Value> = all
        .iter()
        .map(|k| {
            serde_json::json!({
                "kind": k,
                "hint": k.hint(),
                "memberCount": k.member_count(),
                "allowOctave": k.allow_octave(),
            })
        })
        .collect();
    serde_json::json!({ "options": out }).to_string()
}

/// 输入 JSON：`{"notes":[{"id":"a","lianmei":{"kind":"同声","headId":"a"}}]}`。
/// 输出：`{"notes":[...],"changed":false}`
pub fn normalize_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        notes: Vec<LianmeiNote>,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let result = normalize_lianmei(&req.notes);
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// 输入 JSON：`{"notes":[...]}` → `{"groups":[...]}`。
pub fn groups_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        notes: Vec<LianmeiNote>,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let groups = lianmei_groups(&req.notes);
    serde_json::to_string(&serde_json::json!({ "groups": groups })).map_err(|e| e.to_string())
}

/// 输入 JSON：`{"notes":[...],"headIndex":0,"kind":"同声","memberCount":1}`
/// 输出：`{"notes":[...],"changed":bool}`
///
/// `changed == false`（含越界不硬凑）时调用方应**沿用原数组引用**。
pub fn link_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        notes: Vec<LianmeiNote>,
        #[serde(rename = "headIndex")]
        head_index: usize,
        kind: LianmeiKind,
        #[serde(rename = "memberCount", default)]
        member_count: Option<usize>,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let out = link_lianmei(&req.notes, req.head_index, req.kind, req.member_count);
    let changed = out != req.notes;
    serde_json::to_string(&serde_json::json!({ "notes": out, "changed": changed }))
        .map_err(|e| e.to_string())
}

/// 输入 JSON：`{"notes":[...],"index":0}` → `{"notes":[...],"changed":bool}`
pub fn clear_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        notes: Vec<LianmeiNote>,
        index: usize,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let out = clear_lianmei(&req.notes, req.index);
    let changed = out != req.notes;
    serde_json::to_string(&serde_json::json!({ "notes": out, "changed": changed }))
        .map_err(|e| e.to_string())
}

/// 输入 JSON：`{"freqA":440.0,"freqB":880.0}` → `{"relation":"八度"}`。
pub fn relation_json(input_json: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Request {
        #[serde(rename = "freqA")]
        freq_a: Option<f64>,
        #[serde(rename = "freqB")]
        freq_b: Option<f64>,
    }
    let req: Request =
        serde_json::from_str(input_json).map_err(|e| format!("请求体解析失败：{e}"))?;
    let rel = lianmei_relation(req.freq_a, req.freq_b);
    serde_json::to_string(&serde_json::json!({ "relation": rel })).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str) -> LianmeiNote {
        LianmeiNote {
            id: id.to_string(),
            lianmei: None,
        }
    }

    fn linked(id: &str, kind: LianmeiKind, head: &str) -> LianmeiNote {
        LianmeiNote {
            id: id.to_string(),
            lianmei: Some(LianmeiLink {
                kind,
                head_id: head.to_string(),
            }),
        }
    }

    #[test]
    fn only_fanghe_allows_octave() {
        assert!(LianmeiKind::放合.allow_octave());
        for k in [LianmeiKind::分开, LianmeiKind::同声, LianmeiKind::应合] {
            assert!(!k.allow_octave(), "{k:?} 不该允许八度");
        }
        assert_eq!(LianmeiKind::同声.member_count(), 1);
    }

    #[test]
    fn link_shares_head_id() {
        let notes = vec![note("a"), note("b")];
        let out = link_lianmei(&notes, 0, LianmeiKind::同声, None);
        assert_eq!(out[0].lianmei.as_ref().unwrap().head_id, "a");
        assert_eq!(out[1].lianmei.as_ref().unwrap().head_id, "a");
    }

    #[test]
    fn link_out_of_bounds_returns_original() {
        let notes = vec![note("a"), note("b")];
        // 组首已是最后一音
        let out = link_lianmei(&notes, 1, LianmeiKind::同声, None);
        assert_eq!(out, notes);
        // 负数式越界（count 为 0）
        let out = link_lianmei(&notes, 0, LianmeiKind::同声, Some(0));
        assert_eq!(out, notes);
    }

    #[test]
    fn link_supports_multiple_members() {
        let notes = vec![note("a"), note("b"), note("c")];
        let out = link_lianmei(&notes, 0, LianmeiKind::应合, Some(2));
        assert_eq!(out[1].lianmei.as_ref().unwrap().head_id, "a");
        assert_eq!(out[2].lianmei.as_ref().unwrap().head_id, "a");
    }

    #[test]
    fn linking_detaches_from_old_group() {
        // 先 a+b 成组，再让 b+c 成组 → a 的组只剩自己（标记仍在，等归一化清理）
        let notes = vec![note("a"), note("b"), note("c"), note("d")];
        let first = link_lianmei(&notes, 0, LianmeiKind::同声, None);
        let second = link_lianmei(&first, 1, LianmeiKind::分开, None);

        assert_eq!(second[1].lianmei.as_ref().unwrap().head_id, "b");
        assert_eq!(second[2].lianmei.as_ref().unwrap().head_id, "b");
        // 组首 a 的孤立标记此刻还在——这是刻意留给归一化的
        assert_eq!(second[0].lianmei.as_ref().unwrap().head_id, "a");

        // 归一化必须把 a 的孤立标记清掉
        let normalized = normalize_lianmei(&second);
        assert!(normalized.changed);
        assert!(normalized.notes[0].lianmei.is_none());
        assert_eq!(
            normalized.notes[1].lianmei.as_ref().unwrap().kind,
            LianmeiKind::分开
        );
    }

    #[test]
    fn clear_removes_whole_group() {
        let notes = vec![
            linked("a", LianmeiKind::同声, "a"),
            linked("b", LianmeiKind::同声, "a"),
            note("c"),
        ];
        let out = clear_lianmei(&notes, 0);
        assert!(out[0].lianmei.is_none());
        assert!(out[1].lianmei.is_none());
        // 从成员处解除也一样
        let out2 = clear_lianmei(&notes, 1);
        assert!(out2[0].lianmei.is_none());
    }

    #[test]
    fn clear_on_unlinked_returns_original() {
        let notes = vec![note("a")];
        assert_eq!(clear_lianmei(&notes, 0), notes);
    }

    #[test]
    fn groups_finds_contiguous_run() {
        let notes = vec![
            linked("a", LianmeiKind::同声, "a"),
            linked("b", LianmeiKind::同声, "a"),
            note("c"),
        ];
        let groups = lianmei_groups(&notes);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].head_index, 0);
        assert_eq!(groups[0].member_indexes, vec![1]);
    }

    #[test]
    fn lone_head_is_not_a_group() {
        let notes = vec![linked("a", LianmeiKind::同声, "a"), note("b")];
        assert!(lianmei_groups(&notes).is_empty());
    }

    #[test]
    fn normalize_clears_orphan_after_head_deleted() {
        let notes = vec![linked("b", LianmeiKind::同声, "gone")];
        let result = normalize_lianmei(&notes);
        assert!(result.changed);
        assert!(result.notes[0].lianmei.is_none());
    }

    #[test]
    fn normalize_breaks_group_when_note_inserted() {
        let notes = vec![
            linked("a", LianmeiKind::同声, "a"),
            note("x"),
            linked("b", LianmeiKind::同声, "a"),
        ];
        let result = normalize_lianmei(&notes);
        assert!(result.changed);
        assert!(result.notes[2].lianmei.is_none(), "不相邻的成员应被解组");
    }

    #[test]
    fn normalize_breaks_kind_mismatch() {
        let notes = vec![
            linked("a", LianmeiKind::同声, "a"),
            linked("b", LianmeiKind::放合, "a"),
        ];
        let result = normalize_lianmei(&notes);
        assert!(result.changed);
        assert!(result.notes[1].lianmei.is_none());
    }

    #[test]
    fn normalize_reports_unchanged_when_clean() {
        let notes = vec![
            linked("a", LianmeiKind::同声, "a"),
            linked("b", LianmeiKind::同声, "a"),
        ];
        let result = normalize_lianmei(&notes);
        assert!(
            !result.changed,
            "无变化时 changed 必须为 false，供调用方沿用原引用"
        );
        assert_eq!(result.notes, notes);
    }

    #[test]
    fn role_distinguishes_head_and_member() {
        let notes = vec![
            linked("a", LianmeiKind::同声, "a"),
            linked("b", LianmeiKind::同声, "a"),
        ];
        assert_eq!(lianmei_role_at(&notes, 0), Some((LianmeiKind::同声, true)));
        assert_eq!(lianmei_role_at(&notes, 1), Some((LianmeiKind::同声, false)));
    }

    #[test]
    fn relation_same_pitch() {
        assert_eq!(
            lianmei_relation(Some(440.0), Some(440.0)),
            LianmeiRelation::同度
        );
    }

    #[test]
    fn relation_octave() {
        assert_eq!(
            lianmei_relation(Some(440.0), Some(880.0)),
            LianmeiRelation::八度
        );
    }

    #[test]
    fn relation_semitone_is_not_unison() {
        // 半音约 6%，不能被 1% 容差吃成同度
        assert_eq!(
            lianmei_relation(Some(440.0), Some(466.16)),
            LianmeiRelation::不合
        );
    }

    #[test]
    fn relation_unknown_pitch_is_not_fit() {
        assert_eq!(lianmei_relation(None, Some(440.0)), LianmeiRelation::不合);
        assert_eq!(
            lianmei_relation(Some(0.0), Some(440.0)),
            LianmeiRelation::不合
        );
    }

    #[test]
    fn relation_fits_rules() {
        for k in [
            LianmeiKind::分开,
            LianmeiKind::同声,
            LianmeiKind::应合,
            LianmeiKind::放合,
        ] {
            assert!(relation_fits(k, LianmeiRelation::同度), "{k:?} 同度应成立");
        }
        for k in [LianmeiKind::分开, LianmeiKind::同声, LianmeiKind::应合] {
            assert!(
                !relation_fits(k, LianmeiRelation::八度),
                "{k:?} 八度不该成立"
            );
        }
        assert!(relation_fits(LianmeiKind::放合, LianmeiRelation::八度));
        for k in [
            LianmeiKind::分开,
            LianmeiKind::同声,
            LianmeiKind::应合,
            LianmeiKind::放合,
        ] {
            assert!(!relation_fits(k, LianmeiRelation::不合));
        }
    }

    #[test]
    fn json_bridge_round_trips() {
        let out =
            normalize_json(r#"{"notes":[{"id":"a","lianmei":{"kind":"同声","headId":"gone"}}]}"#)
                .unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["changed"], serde_json::json!(true));
        assert_eq!(v["notes"][0]["lianmei"], serde_json::Value::Null);
    }

    #[test]
    fn options_json_lists_four() {
        let v: serde_json::Value = serde_json::from_str(&options_json()).unwrap();
        assert_eq!(v["options"].as_array().unwrap().len(), 4);
    }
}
