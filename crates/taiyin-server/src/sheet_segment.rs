//! 整页电子谱面：格子切分（间隙容忍投影）+ 逐格模板匹配。
//!
//! 单字模板匹配（`template_match`）在电子谱面单字上 exact 100%，整页识别
//! 要先把一整页切成字格。切分算法与 Python 端 `tools/eval-jianzi/sheet_eval.py`
//! 的 `segment()` 逐行等价：
//!
//! 1. 3x3 中值（边缘钳位）去斑 → 阈值 128 取墨；
//! 2. 行投影找「行带」，每带内列投影找「字格」；
//! 3. **间隙容忍**：白缝小于阈值不切开 —— 复合减字内部有白色通道
//!    （列向 ≤0.05×S、行向单字可到 0.36×S），无脑按「一列白就切」会把
//!    一个字劈成两三个框。阈值按页面墨迹尺度 S 取 0.10×S（half-up 取整，
//!    与 Python `int(x+0.5)` 一致），S = 原始墨段里最大带高∪最大带宽。
//!
//! 实测边界（`sheet_eval.py eval`，72 张合成整页、42 字格池）：
//! 字格间隙 ≥0.2×字高时切分全对；0.1 为临界；<0.1 开始粘连。本项目
//! 真实渲染间隙 ≈0.5×字高（24px 字 + 12px 间距），有 5 倍余量。
//! 识别准确率见 `tools/eval-jianzi/README.md`：字高 ≥72px 时 42/42 = 100%。

use crate::template_match::{self, TemplateIndex, TemplateMatch};

/// 连续墨段最短长度（像素）：短于此当噪声丢弃。
pub const MIN_RUN: usize = 3;
/// 墨迹阈值（白底黑字，与 normalize_gray 一致）。
pub const THRESH: u8 = 128;
/// 列向间隙容忍比例（白缝 < 0.10×S 不切开）。
pub const COL_GAP_FRAC: f32 = 0.10;
/// 行向间隙容忍比例（行投影横跨整行，需整行字对齐通道才误切，实测极少）。
pub const ROW_GAP_FRAC: f32 = 0.10;

/// 字格外接框（end-exclusive）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellBox {
    pub y0: usize,
    pub y1: usize,
    pub x0: usize,
    pub x1: usize,
}

/// 一个字格的识别结果（几何 + 模板匹配）。
#[derive(Debug, Clone)]
pub struct SheetCellMatch {
    /// 行号：从上到下，首行 = 0。
    pub row: usize,
    /// 列号：从左到右，最左 = 0（减字谱阅读顺序为同排从右到左，前端换算）。
    pub col: usize,
    pub rect: CellBox,
    pub m: TemplateMatch,
}

/// 布尔序列里的连续 True 段。`gap_tol`：段间白缝 < gap_tol 时桥接合并；
/// `min_run`：合并后仍短于此的墨段当噪声丢弃（与 Python `_runs` 同序）。
fn runs(flags: &[bool], min_run: usize, gap_tol: usize) -> Vec<(usize, usize)> {
    let mut raw: Vec<(usize, usize)> = Vec::new();
    let mut start: Option<usize> = None;
    for (i, &f) in flags.iter().enumerate() {
        if f && start.is_none() {
            start = Some(i);
        } else if !f && start.is_some() {
            raw.push((start.take().unwrap(), i));
        }
    }
    if let Some(s) = start {
        raw.push((s, flags.len()));
    }

    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (s, e) in raw {
        if let Some(last) = merged.last_mut()
            && s - last.1 < gap_tol
        {
            last.1 = e;
            continue;
        }
        merged.push((s, e));
    }
    merged
        .into_iter()
        .filter(|(s, e)| e - s >= min_run)
        .collect()
}

/// 整页灰度（白底黑字）→ 按行分组的字格外接框。
/// 行从上到下、格从左到右，直接对应 API 的 (row, col) 坐标。
pub fn segment(width: usize, height: usize, luma: &[u8]) -> Vec<Vec<CellBox>> {
    assert_eq!(luma.len(), width * height, "luma buffer size mismatch");
    let smooth = template_match::median3(width, height, luma);
    let ink: Vec<bool> = smooth.iter().map(|&p| p < THRESH).collect();

    let row_flags: Vec<bool> = (0..height)
        .map(|y| (0..width).any(|x| ink[y * width + x]))
        .collect();
    let col_flags_in = |y0: usize, y1: usize| -> Vec<bool> {
        (0..width)
            .map(|x| (y0..y1).any(|y| ink[y * width + x]))
            .collect()
    };

    // 页面墨迹尺度 S：原始墨段里「最大带高 ∪ 最大带宽」，对过切/漏切都稳。
    let mut s_est = 0usize;
    for (y0, y1) in runs(&row_flags, 1, 0) {
        s_est = s_est.max(y1 - y0);
        for (x0, x1) in runs(&col_flags_in(y0, y1), 1, 0) {
            s_est = s_est.max(x1 - x0);
        }
    }
    // half-up 取整，与 Python `int(x + 0.5)` 一致。
    let k_row = ((ROW_GAP_FRAC * s_est as f32) + 0.5) as usize;
    let k_col = ((COL_GAP_FRAC * s_est as f32) + 0.5) as usize;
    let k_row = k_row.max(3);
    let k_col = k_col.max(3);

    let mut rows = Vec::new();
    for (y0, y1) in runs(&row_flags, MIN_RUN, k_row) {
        let boxes = runs(&col_flags_in(y0, y1), MIN_RUN, k_col)
            .into_iter()
            .map(|(x0, x1)| CellBox { y0, y1, x0, x1 })
            .collect();
        rows.push(boxes);
    }
    rows
}

/// 切分 + 逐格模板匹配。
pub fn recognize_cells(
    index: &TemplateIndex,
    width: usize,
    height: usize,
    luma: &[u8],
) -> Vec<SheetCellMatch> {
    let mut out = Vec::new();
    for (row, boxes) in segment(width, height, luma).into_iter().enumerate() {
        for (col, b) in boxes.into_iter().enumerate() {
            let mut crop = Vec::with_capacity((b.y1 - b.y0) * (b.x1 - b.x0));
            for y in b.y0..b.y1 {
                for x in b.x0..b.x1 {
                    crop.push(luma[y * width + x]);
                }
            }
            let pixels = template_match::normalize_gray(
                b.x1 - b.x0,
                b.y1 - b.y0,
                &crop,
                template_match::SIZE,
            );
            let m = template_match::match_pixels(index, &pixels);
            out.push(SheetCellMatch {
                row,
                col,
                rect: b,
                m,
            });
        }
    }
    out
}

/// 解码整页图片字节（png/jpeg/webp）→ 切分 + 逐格匹配。
pub fn recognize_sheet_image_bytes(
    index: &TemplateIndex,
    bytes: &[u8],
) -> anyhow::Result<Vec<SheetCellMatch>> {
    let img = image::load_from_memory(bytes)?.to_luma8();
    Ok(recognize_cells(
        index,
        img.width() as usize,
        img.height() as usize,
        img.as_raw(),
    ))
}

/// 全页平均置信度（top-2 margin 比）；空页为 0。用于 auto 策略决定
/// 「模板结果是否整体可信、可直接采用」。
pub fn mean_margin_ratio(cells: &[SheetCellMatch]) -> f32 {
    if cells.is_empty() {
        return 0.0;
    }
    let sum: f32 = cells.iter().map(|c| c.m.confidence()).sum();
    sum / cells.len() as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::template_match::INDEX;

    fn blank(w: usize, h: usize) -> Vec<u8> {
        vec![255u8; w * h]
    }

    fn fill_rect(canvas: &mut [u8], w: usize, x0: usize, y0: usize, bw: usize, bh: usize) {
        for y in y0..y0 + bh {
            for x in x0..x0 + bw {
                canvas[y * w + x] = 0;
            }
        }
    }

    #[test]
    fn runs_gap_tol_bridges_small_gaps() {
        // 两段墨中间夹 2 个白像素；gap_tol=3 时应桥接成一段
        let flags = [true, true, false, false, true, true, true];
        assert_eq!(runs(&flags, 1, 3), vec![(0, 7)]);
        // gap_tol=2 不桥接（白缝 2 不小于 2）
        assert_eq!(runs(&flags, 1, 2), vec![(0, 2), (4, 7)]);
    }

    #[test]
    fn runs_min_run_filters_speckle_after_merge() {
        // 单像素墨段（长 1）应被 min_run=3 丢弃；桥接后按合并长度计
        let flags = [false, true, false, true, true, true, false];
        assert_eq!(runs(&flags, 3, 0), vec![(3, 6)]);
        // 两段短墨被 gap_tol 桥接后总长 ≥3 → 保留
        let flags = [true, true, false, true, true];
        assert_eq!(runs(&flags, 3, 2), vec![(0, 5)]);
    }

    #[test]
    fn segment_finds_grid_rows_then_cols() {
        // 2 行 x 3 列 10x10 黑块，边距 10、间隙 20
        let (w, h) = (130, 70);
        let mut img = blank(w, h);
        for r in 0..2 {
            for c in 0..3 {
                fill_rect(&mut img, w, 10 + c * 40, 10 + r * 40, 10, 10);
            }
        }
        let rows = segment(w, h, &img);
        assert_eq!(rows.len(), 2, "应切出 2 行: {rows:?}");
        assert_eq!(rows[0].len(), 3, "首行应 3 格: {rows:?}");
        assert_eq!(rows[1].len(), 3, "次行应 3 格: {rows:?}");
        // 左上角格子坐标（行从上到下、格从左到右）
        assert_eq!(
            rows[0][0],
            CellBox {
                y0: 10,
                y1: 20,
                x0: 10,
                x1: 20
            }
        );
        assert_eq!(
            rows[1][2],
            CellBox {
                y0: 50,
                y1: 60,
                x0: 90,
                x1: 100
            }
        );
    }

    #[test]
    fn segment_bridges_internal_channel_but_splits_glyphs() {
        // 一个「字」= 两个 8x8 块、中间 2px 白缝（内部通道）→ 应并成一格；
        // 另一个字与它隔 20px → 应分成两格。
        let (w, h) = (80, 30);
        let mut img = blank(w, h);
        fill_rect(&mut img, w, 10, 10, 8, 8);
        fill_rect(&mut img, w, 20, 10, 8, 8); // 内部白缝 x=18..20（2px）
        fill_rect(&mut img, w, 48, 10, 8, 8); // 字间白缝 x=28..48（20px）
        let rows = segment(w, h, &img);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].len(), 2, "内部通道应桥接、字间应切开: {rows:?}");
        assert_eq!(
            rows[0][0],
            CellBox {
                y0: 10,
                y1: 18,
                x0: 10,
                x1: 28
            }
        );
        assert_eq!(
            rows[0][1],
            CellBox {
                y0: 10,
                y1: 18,
                x0: 48,
                x1: 56
            }
        );
    }

    #[test]
    fn segment_blank_page_is_empty() {
        assert!(segment(20, 20, &blank(20, 20)).is_empty());
    }

    /// 端到端回环：把索引里的模板像素（墨=255）反相放大拼成整页
    /// （墨=0），切分 + 匹配后应认回原来的字形名 —— 验证整条
    /// 切分→归一化→最近邻链路的接线。
    #[test]
    fn recognize_cells_loopback_on_template_page() {
        let picks = [0usize, 1, 2, 3];
        let scale = 2usize; // 64 -> 128
        let gap = 24usize;
        let margin = 12usize;
        let cell = template_match::SIZE * scale;
        let w = margin * 2 + cell * 2 + gap;
        let h = margin * 2 + cell * 2 + gap;
        let mut img = blank(w, h);
        for (i, &pi) in picks.iter().enumerate() {
            let r = i / 2;
            let c = i % 2;
            let ox = margin + c * (cell + gap);
            let oy = margin + r * (cell + gap);
            let src = &INDEX.entries[pi].pixels;
            for y in 0..cell {
                for x in 0..cell {
                    // 模板像素墨=255，页面 luma 墨=0
                    let v = src[(y / scale) * template_match::SIZE + (x / scale)];
                    img[(oy + y) * w + (ox + x)] = 255 - v;
                }
            }
        }
        let cells = recognize_cells(&INDEX, w, h, &img);
        assert_eq!(
            cells.len(),
            4,
            "应切出 4 格: {:?}",
            cells.iter().map(|c| c.rect).collect::<Vec<_>>()
        );
        for (i, cm) in cells.iter().enumerate() {
            let expect = &INDEX.entries[picks[i]];
            assert_eq!(
                cm.m.name, expect.name,
                "第 {i} 格应认回 {}（距离 {}）",
                expect.name, cm.m.distance
            );
            assert_eq!((cm.row, cm.col), (i / 2, i % 2), "坐标顺序");
        }
    }

    #[test]
    fn mean_margin_ratio_empty_is_zero() {
        assert_eq!(mean_margin_ratio(&[]), 0.0);
    }
}
