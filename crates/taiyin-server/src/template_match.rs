//! 电子谱面减字「模板匹配」识别 —— 不走视觉大模型的确定性路径。
//!
//! 视觉大模型（DeepSeek 等）在 42 条字体真字上 exact_match = 0%（模板坍缩，
//! 在背提示词示例，见 `tools/eval-jianzi/README.md`）。而电子谱面（本项目字体
//! 渲染出的干净减字图）分布封闭确定：字体里一共 268 个可读字形。把每个字形
//! 渲染成模板，识别就是「最近邻匹配」——确定性、瞬时、零成本。
//!
//! 诚实边界：只对**该字体渲染的干净图**有效（训练=测试分布）。拍照/扫描件
//! 有噪声、笔画粘连、光照差异，不在适用范围 —— 那类输入仍走 LLM 路径。
//!
//! 索引由 `tools/eval-jianzi/template_match.py export-rust` 从字体生成：
//! `data/template_index.json`。归一化算法与 Python 端逐行等价（半像素中心
//! 双线性、3x3 中值去斑、外接框裁剪补方），保证两端匹配结果一致。

use std::sync::LazyLock;

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::Deserialize;

/// 归一化后的模板边长。
pub const SIZE: usize = 64;

#[derive(Debug, Deserialize)]
struct RawEntry {
    name: String,
    #[serde(default)]
    truths: Vec<String>,
    pixels: String,
}

#[derive(Debug, Deserialize)]
struct RawIndex {
    size: usize,
    entries: Vec<RawEntry>,
}

/// 一个模板字形。
#[derive(Debug)]
pub struct TemplateEntry {
    pub name: String,
    /// 等价文本写法（第一个是规范文本，其余是异体，如「半涓/半蠲」）。
    pub truths: Vec<String>,
    /// 归一化 64x64 灰度像素（0..255）。
    pub pixels: Vec<u8>,
}

/// 全量模板索引（编译期内嵌，启动时解析一次）。
#[derive(Debug)]
pub struct TemplateIndex {
    pub size: usize,
    pub entries: Vec<TemplateEntry>,
}

static RAW_INDEX: &str = include_str!("../data/template_index.json");

pub static INDEX: LazyLock<TemplateIndex> = LazyLock::new(|| {
    let raw: RawIndex = serde_json::from_str(RAW_INDEX).expect("template_index.json must parse");
    let entries = raw
        .entries
        .into_iter()
        .map(|e| {
            let pixels = B64
                .decode(&e.pixels)
                .expect("template pixels must be base64");
            TemplateEntry {
                name: e.name,
                truths: e.truths,
                pixels,
            }
        })
        .collect();
    TemplateIndex {
        size: raw.size,
        entries,
    }
});

/// 最近邻匹配结果。
#[derive(Debug, Clone)]
pub struct TemplateMatch {
    /// 字形名（如 `lg_yangtuo`）。
    pub name: String,
    /// 规范减字文本（如「仰托」）。
    pub text: String,
    /// 与最佳模板的欧氏距离。
    pub distance: f32,
    /// 与次优模板的距离差（越大越可信）。
    pub margin: f32,
}

impl TemplateMatch {
    /// 诚实置信度：`1 - d1/d2`（最佳距离 / 次优距离），top-2 难分时接近 0。
    /// 与 Python 端 `margin / (distance + margin)` 同一公式。
    pub fn confidence(&self) -> f32 {
        let d2 = self.distance + self.margin;
        if d2 <= f32::EPSILON {
            1.0
        } else {
            (1.0 - self.distance / d2).clamp(0.0, 1.0)
        }
    }
}

/// 3x3 中值滤波（边缘钳位）：去掉椒盐噪声的孤立噪点，干净图上近乎恒等。
/// 整页切分（`sheet_segment`）复用，Python 端 `median3_clamp` 同一公式。
pub(crate) fn median3(width: usize, height: usize, src: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; width * height];
    for y in 0..height {
        for x in 0..width {
            let mut win = [0u8; 9];
            let mut k = 0;
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    let yy = (y as i32 + dy).clamp(0, height as i32 - 1) as usize;
                    let xx = (x as i32 + dx).clamp(0, width as i32 - 1) as usize;
                    win[k] = src[yy * width + xx];
                    k += 1;
                }
            }
            win.sort_unstable();
            out[y * width + x] = win[4];
        }
    }
    out
}

/// 半像素中心双线性缩放（与 Python 端 `_bilinear_resize` 同一公式）。
fn bilinear_resize(canvas: &[f32], w: usize, h: usize, size: usize) -> Vec<f32> {
    let mut out = vec![0f32; size * size];
    let sy = h as f32 / size as f32;
    let sx = w as f32 / size as f32;
    for oy in 0..size {
        let fy = ((oy as f32 + 0.5) * sy - 0.5).clamp(0.0, h as f32 - 1.0);
        let y0 = fy.floor() as usize;
        let y1 = (y0 + 1).min(h - 1);
        let wy = fy - y0 as f32;
        for ox in 0..size {
            let fx = ((ox as f32 + 0.5) * sx - 0.5).clamp(0.0, w as f32 - 1.0);
            let x0 = fx.floor() as usize;
            let x1 = (x0 + 1).min(w - 1);
            let wx = fx - x0 as f32;
            let top = canvas[y0 * w + x0] * (1.0 - wx) + canvas[y0 * w + x1] * wx;
            let bot = canvas[y1 * w + x0] * (1.0 - wx) + canvas[y1 * w + x1] * wx;
            out[oy * size + ox] = top * (1.0 - wy) + bot * wy;
        }
    }
    out
}

/// 归一化：中值去斑 → 阈值 128 取墨迹 → 裁外接框 → 补正方形 → 双线性缩放。
/// 返回 0..255 灰度（与 `export-rust` 的模板同源）。
pub fn normalize_gray(width: usize, height: usize, luma: &[u8], size: usize) -> Vec<u8> {
    assert_eq!(luma.len(), width * height, "luma buffer size mismatch");
    let smooth = median3(width, height, luma);

    // 墨迹外接框
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    for y in 0..height {
        for x in 0..width {
            if smooth[y * width + x] < 128 {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }
    if min_x > max_x {
        return vec![0u8; size * size]; // 全白：空图
    }

    let cw = max_x - min_x + 1;
    let ch = max_y - min_y + 1;
    let side = cw.max(ch);
    let mut canvas = vec![0f32; side * side];
    let oy = (side - ch) / 2;
    let ox = (side - cw) / 2;
    for y in 0..ch {
        for x in 0..cw {
            if smooth[(min_y + y) * width + min_x + x] < 128 {
                canvas[(oy + y) * side + (ox + x)] = 1.0;
            }
        }
    }
    bilinear_resize(&canvas, side, side, size)
        .into_iter()
        .map(|v| (v * 255.0).round().clamp(0.0, 255.0) as u8)
        .collect()
}

fn euclid(a: &[u8], b: &[u8]) -> f32 {
    let mut acc = 0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        let d = *x as f32 - *y as f32;
        acc += d * d;
    }
    acc.sqrt()
}

/// 在索引里给归一化像素找最近邻。
pub fn match_pixels(index: &TemplateIndex, query: &[u8]) -> TemplateMatch {
    let mut dists: Vec<(usize, f32)> = index
        .entries
        .iter()
        .enumerate()
        .map(|(i, e)| (i, euclid(&e.pixels, query)))
        .collect();
    dists.sort_by(|a, b| a.1.partial_cmp(&b.1).expect("distances are finite"));
    let (bi, bd) = dists[0];
    let second = dists.get(1).map(|(_, d)| *d).unwrap_or(bd);
    let entry = &index.entries[bi];
    TemplateMatch {
        name: entry.name.clone(),
        text: entry
            .truths
            .first()
            .cloned()
            .unwrap_or_else(|| entry.name.clone()),
        distance: bd,
        margin: second - bd,
    }
}

/// 解码图片字节（png/jpeg/webp）→ 归一化 → 最近邻。
pub fn match_image_bytes(bytes: &[u8]) -> anyhow::Result<TemplateMatch> {
    let img = image::load_from_memory(bytes)?.to_luma8();
    let pixels = normalize_gray(
        img.width() as usize,
        img.height() as usize,
        img.as_raw(),
        SIZE,
    );
    Ok(match_pixels(&INDEX, &pixels))
}

/// 识别路径选择。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecognizeMode {
    /// 模板置信度达标用模板，否则落 LLM（默认）。
    Auto,
    /// 只用模板匹配。
    Template,
    /// 只用 LLM。
    Llm,
}

/// 识别策略（来自环境变量）。
#[derive(Debug, Clone, Copy)]
pub struct RecognizeStrategy {
    pub mode: RecognizeMode,
    /// auto 模式接受模板结果的最低置信度（margin 比）。
    pub min_margin_ratio: f32,
}

impl RecognizeStrategy {
    /// `RECOGNIZE_MODE`：`auto`（默认）/ `template` / `llm`。
    /// `RECOGNIZE_TEMPLATE_MIN_MARGIN`：默认 0.3。
    pub fn from_env() -> Self {
        let mode = match std::env::var("RECOGNIZE_MODE")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "template" => RecognizeMode::Template,
            "llm" => RecognizeMode::Llm,
            _ => RecognizeMode::Auto,
        };
        let min_margin_ratio = std::env::var("RECOGNIZE_TEMPLATE_MIN_MARGIN")
            .ok()
            .and_then(|v| v.parse::<f32>().ok())
            .unwrap_or(0.3);
        Self {
            mode,
            min_margin_ratio,
        }
    }
}

/// auto 模式下模板结果是否够可信、可直接采用（不打扰 LLM）。
pub fn prefer_template(strategy: &RecognizeStrategy, margin_ratio: f32) -> bool {
    match strategy.mode {
        RecognizeMode::Template => true,
        RecognizeMode::Llm => false,
        RecognizeMode::Auto => margin_ratio >= strategy.min_margin_ratio,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn black_square(w: usize, h: usize, x0: usize, y0: usize, s: usize) -> Vec<u8> {
        let mut v = vec![255u8; w * h];
        for y in y0..(y0 + s).min(h) {
            for x in x0..(x0 + s).min(w) {
                v[y * w + x] = 0;
            }
        }
        v
    }

    #[test]
    fn median3_removes_isolated_speckle() {
        // 3x3 全白，中心一个黑点 → 中值滤波后应消失
        let mut src = vec![255u8; 9];
        src[4] = 0;
        let out = median3(3, 3, &src);
        assert!(
            out.iter().all(|&v| v == 255),
            "孤立噪点应被中值滤掉: {out:?}"
        );
    }

    #[test]
    fn median3_keeps_stroke() {
        // 横向笔画（3 像素宽）应保留
        let mut src = vec![255u8; 25];
        for x in 0..5 {
            src[2 * 5 + x] = 0;
            src[3 * 5 + x] = 0;
        }
        let out = median3(5, 5, &src);
        assert_eq!(out[2 * 5 + 2], 0);
        assert_eq!(out[3 * 5 + 2], 0);
    }

    #[test]
    fn normalize_blank_image_is_all_zero() {
        let out = normalize_gray(4, 4, &[255u8; 16], SIZE);
        assert!(out.iter().all(|&v| v == 0));
    }

    #[test]
    fn normalize_centers_square_and_thresholds() {
        // 10x8 画布上 4x4 黑方块，应被裁剪补方后居中、墨迹为 255
        let luma = black_square(10, 8, 3, 2, 4);
        let out = normalize_gray(10, 8, &luma, SIZE);
        assert_eq!(out.len(), SIZE * SIZE);
        let center = out[SIZE / 2 * SIZE + SIZE / 2];
        assert_eq!(center, 255, "中心应是墨");
        assert_eq!(out[0], 0, "角落应是空白");
    }

    #[test]
    fn normalize_is_translation_invariant() {
        // 墨块都不贴画布边缘：贴边时 3x3 中值滤波的边缘钳位会改变腐蚀形状，
        // 那是滤波的固有性质，不是归一化的平移缺陷。
        let a = normalize_gray(20, 18, &black_square(20, 18, 3, 4, 6), SIZE);
        let b = normalize_gray(16, 16, &black_square(16, 16, 8, 5, 6), SIZE);
        let diff: u32 = a
            .iter()
            .zip(&b)
            .map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs())
            .sum();
        assert!(diff < 200, "平移后归一化应几乎一致，实际总差 {diff}");
    }

    fn toy_index() -> TemplateIndex {
        let mut entries = vec![];
        for (name, text, fill) in [
            ("g_full", "满", 255u8),
            ("g_empty", "空", 0u8),
            ("g_half", "半", 128u8),
        ] {
            entries.push(TemplateEntry {
                name: name.into(),
                truths: vec![text.into()],
                pixels: vec![fill; SIZE * SIZE],
            });
        }
        TemplateIndex {
            size: SIZE,
            entries,
        }
    }

    #[test]
    fn match_pixels_picks_argmin_and_confidence() {
        let idx = toy_index();
        let query = vec![250u8; SIZE * SIZE]; // 靠近「满」
        let m = match_pixels(&idx, &query);
        assert_eq!(m.name, "g_full");
        assert_eq!(m.text, "满");
        assert!(m.distance < m.margin, "应明显近于次优");
        let c = m.confidence();
        assert!(c > 0.9, "置信度应接近 1，实际 {c}");
    }

    #[test]
    fn confidence_zero_when_top2_tie() {
        let m = TemplateMatch {
            name: "x".into(),
            text: "x".into(),
            distance: 5.0,
            margin: 0.0,
        };
        assert_eq!(m.confidence(), 0.0);
    }

    #[test]
    fn match_image_bytes_rejects_garbage() {
        assert!(match_image_bytes(b"not an image").is_err());
    }

    #[test]
    fn pipeline_roundtrip_on_embedded_index() {
        // 取内嵌索引里的一个模板，还原成图片再走完整管线，应匹配回同一个字形。
        let entry = INDEX
            .entries
            .iter()
            .find(|e| e.name == "lg_yangtuo")
            .expect("index contains lg_yangtuo");
        let m = match_pixels(&INDEX, &entry.pixels);
        assert_eq!(m.name, "lg_yangtuo");
        assert_eq!(m.text, "仰托");
        assert!(m.distance < 1e-6, "自匹配距离应为 0");
    }

    #[test]
    fn prefer_template_respects_mode_and_threshold() {
        let auto = RecognizeStrategy {
            mode: RecognizeMode::Auto,
            min_margin_ratio: 0.3,
        };
        assert!(prefer_template(&auto, 0.9));
        assert!(!prefer_template(&auto, 0.1));
        let tpl = RecognizeStrategy {
            mode: RecognizeMode::Template,
            min_margin_ratio: 0.3,
        };
        assert!(prefer_template(&tpl, 0.0));
        let llm = RecognizeStrategy {
            mode: RecognizeMode::Llm,
            min_margin_ratio: 0.3,
        };
        assert!(!prefer_template(&llm, 1.0));
    }
}
