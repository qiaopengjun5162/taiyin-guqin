//! 性能与并发探针：只测纯 CPU / 运行时行为，不连数据库。
//!
//! 目的：把「Argon2 在 async 里同步跑」「模板匹配是 CPU 活」这类判断
//! 从阅读代码的印象，变成可复现的数字。
//!
//! 用法：
//! ```bash
//! cargo run --release -p taiyin-server --example perf_probe
//! ```
//!
//! 说明：本机 12 核，绝对延迟比 1–2 vCPU 的 VPS 乐观；阻塞实验刻意把
//! 运行时限制到 **1 个 worker 线程**来模拟单核小机器。

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use image::{ExtendedColorType, ImageEncoder, codecs::png::PngEncoder};
use taiyin_server::accounts::{hash_password, verify_password};
use taiyin_server::sheet_segment::recognize_sheet_image_bytes;
use taiyin_server::template_match::{INDEX, SIZE, match_image_bytes};

// ── 堆记账：量「一次请求」到底吃了多少内存 ──────────────────────────
//
// 沙箱不允许读别的进程的 RSS，所以直接在进程内记账，反而更精确：
// 能给出**单次调用**的峰值增量，而不是整个进程的粗粒度采样。
static CUR: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

struct Counting;

// SAFETY: 只是把调用转给 `System` 分配器，并在成功分配/释放后更新两个
// 原子计数；不改变指针语义、不缓存内存、不改变对齐与布局。
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: 契约由调用方（全局分配器接口）保证，这里原样转交。
        let p = unsafe { System.alloc(layout) };
        if !p.is_null() {
            let now = CUR.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: 指针来自上面的 `alloc`，布局由调用方保证一致。
        unsafe { System.dealloc(ptr, layout) };
        CUR.fetch_sub(layout.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static ALLOC: Counting = Counting;

/// 跑一次 `f`，返回 (峰值堆增量, 结束时堆增量)，单位字节。
fn heap_delta<F: FnOnce()>(f: F) -> (usize, usize) {
    let before = CUR.load(Ordering::Relaxed);
    PEAK.store(before, Ordering::Relaxed);
    f();
    let peak = PEAK.load(Ordering::Relaxed);
    let after = CUR.load(Ordering::Relaxed);
    (peak.saturating_sub(before), after.saturating_sub(before))
}

/// 计时一组样本，返回 (min, median, max)。
fn bench<F: FnMut()>(iters: usize, mut f: F) -> (Duration, Duration, Duration) {
    let mut samples = Vec::with_capacity(iters);
    for _ in 0..iters {
        let t = Instant::now();
        f();
        samples.push(t.elapsed());
    }
    samples.sort_unstable();
    let min = samples[0];
    let median = samples[samples.len() / 2];
    let max = samples[samples.len() - 1];
    (min, median, max)
}

fn fmt_ms(d: Duration) -> String {
    format!("{:>8.2}", d.as_secs_f64() * 1000.0)
}

/// 把模板索引里的一个字形还原成 64x64 PNG（255 = 墨迹，0 = 纸）。
fn glyph_png(idx: usize) -> Vec<u8> {
    let entry = &INDEX.entries[idx];
    let n = (SIZE * SIZE) as u32;
    let mut buf = Vec::new();
    PngEncoder::new(&mut buf)
        .write_image(
            &entry.pixels,
            n / SIZE as u32,
            SIZE as u32,
            ExtendedColorType::L8,
        )
        .expect("encode glyph png");
    buf
}

/// 合成一张整页图：两行、每行 6 个字形，字距 16px，白底。
fn sheet_png(start: usize, cols: usize, rows: usize) -> Vec<u8> {
    let gap = 16usize;
    let margin = 24usize;
    let w = margin * 2 + cols * SIZE + (cols - 1) * gap;
    let h = margin * 2 + rows * SIZE + (rows - 1) * gap;
    let mut canvas = vec![0u8; w * h];
    for r in 0..rows {
        for c in 0..cols {
            let e = &INDEX.entries[(start + r * cols + c) % INDEX.entries.len()];
            let ox = margin + c * (SIZE + gap);
            let oy = margin + r * (SIZE + gap);
            for y in 0..SIZE {
                for x in 0..SIZE {
                    // 索引里 255 = 墨迹；直接搬过来（白字黑底 → 黑字白底的翻转由阈值处理）
                    let v = e.pixels[y * SIZE + x];
                    canvas[(oy + y) * w + ox + x] = v;
                }
            }
        }
    }
    let mut buf = Vec::new();
    PngEncoder::new(&mut buf)
        .write_image(&canvas, w as u32, h as u32, ExtendedColorType::L8)
        .expect("encode sheet png");
    buf
}

/// 在单 worker 运行时里量「调度停顿」：5ms 定时器相邻两次唤醒的最大间隔。
///
/// 停顿远大于 5ms 就说明有同步 CPU 活占着唯一的 worker 线程，
/// 这期间服务对**任何**请求（包括 /health）都无响应。
fn max_scheduler_stall(concurrency: usize) -> Duration {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .expect("build runtime");

    rt.block_on(async move {
        let hash = hash_password("probe-password").expect("hash");
        let max_gap = Arc::new(AtomicU64::new(0));
        let done = Arc::new(AtomicU64::new(0));

        // 定时器：每 5ms 记一次相邻唤醒间隔
        let mg = max_gap.clone();
        let stop = Arc::new(AtomicU64::new(0));
        let st = stop.clone();
        let ticker = tokio::spawn(async move {
            let mut last = Instant::now();
            while st.load(Ordering::Relaxed) == 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
                let now = Instant::now();
                let gap = now.duration_since(last).as_micros() as u64;
                last = now;
                mg.fetch_max(gap, Ordering::Relaxed);
            }
        });

        // 预热，避免首次 Argon2 的参数初始化计入
        let _ = verify_password("probe-password", &hash);

        let mut handles = Vec::new();
        for _ in 0..concurrency {
            let h = hash.clone();
            let d = done.clone();
            handles.push(tokio::spawn(async move {
                // 同步调用：模拟当前 login / register 的写法
                let _ = verify_password("probe-password", &h);
                d.fetch_add(1, Ordering::Relaxed);
            }));
        }
        for h in handles {
            h.await.expect("join");
        }
        stop.store(1, Ordering::Relaxed);
        let _ = ticker.await;
        Duration::from_micros(max_gap.load(Ordering::Relaxed))
    })
}

/// 同上，但把 Argon2 放到 `spawn_blocking`（修复后的样子）。
fn max_scheduler_stall_blocking(concurrency: usize) -> Duration {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .expect("build runtime");

    rt.block_on(async move {
        let hash = hash_password("probe-password").expect("hash");
        let max_gap = Arc::new(AtomicU64::new(0));
        let stop = Arc::new(AtomicU64::new(0));
        let mg = max_gap.clone();
        let st = stop.clone();
        let ticker = tokio::spawn(async move {
            let mut last = Instant::now();
            while st.load(Ordering::Relaxed) == 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
                let now = Instant::now();
                let gap = now.duration_since(last).as_micros() as u64;
                last = now;
                mg.fetch_max(gap, Ordering::Relaxed);
            }
        });

        let mut handles = Vec::new();
        for _ in 0..concurrency {
            let h = hash.clone();
            handles.push(tokio::spawn(async move {
                let _ = tokio::task::spawn_blocking(move || verify_password("probe-password", &h))
                    .await;
            }));
        }
        for h in handles {
            h.await.expect("join");
        }
        stop.store(1, Ordering::Relaxed);
        let _ = ticker.await;
        Duration::from_micros(max_gap.load(Ordering::Relaxed))
    })
}

/// 合成一张「像手机截图」的大图：`w x h` 灰度，带轻噪声，右下角贴一个字形。
///
/// 噪声让 PNG 不再是几百字节的纯色块，解码成本才接近真实照片/截图；
/// 字形保证 normalize 有可裁的外接框。
fn photo_like_png(w: usize, h: usize) -> Vec<u8> {
    let mut canvas = vec![0u8; w * h];
    let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
    for px in canvas.iter_mut() {
        // xorshift：只为造噪声，不需要统计质量
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        *px = (seed & 0x3f) as u8 + 0xa0; // 纸色偏亮 + 轻噪声
    }
    let g = &INDEX.entries[7];
    let (ox, oy) = (w - SIZE - 40, h - SIZE - 40);
    for y in 0..SIZE {
        for x in 0..SIZE {
            canvas[(oy + y) * w + ox + x] = g.pixels[y * SIZE + x];
        }
    }
    let mut buf = Vec::new();
    PngEncoder::new(&mut buf)
        .write_image(&canvas, w as u32, h as u32, ExtendedColorType::L8)
        .expect("encode photo png");
    buf
}

fn main() {
    println!("== 环境 ==");
    println!(
        "cores = {}",
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(0)
    );
    println!("模板条目 = {}", INDEX.entries.len());

    // ── 1) Argon2 ──────────────────────────────────────────────
    let hash = hash_password("correct horse battery staple").expect("hash");
    let (amin, amed, amax) = bench(5, || {
        let _ = hash_password("correct horse battery staple").expect("hash");
    });
    let (vmin, vmed, vmax) = bench(10, || {
        assert!(verify_password("correct horse battery staple", &hash));
    });
    println!("\n== 1) Argon2id 单次成本（生产经 spawn_blocking 调用）==");
    println!(
        "  hash   min {} ms / p50 {} ms / max {} ms",
        fmt_ms(amin),
        fmt_ms(amed),
        fmt_ms(amax)
    );
    println!(
        "  verify min {} ms / p50 {} ms / max {} ms",
        fmt_ms(vmin),
        fmt_ms(vmed),
        fmt_ms(vmax)
    );
    println!(
        "  单核每秒最多约 {:.1} 次登录（纯散列，不含 DB/网络）",
        1.0 / vmed.as_secs_f64()
    );

    // ── 2) 单字模板匹配 ─────────────────────────────────────────
    let one = glyph_png(0);
    let (tmin, tmed, tmax) = bench(20, || {
        let _ = match_image_bytes(&one).expect("match");
    });
    println!("\n== 2) 单字模板匹配（含 PNG 解码 + 归一化 + 257 条最近邻）==");
    println!(
        "  png {} B → min {} ms / p50 {} ms / max {} ms",
        one.len(),
        fmt_ms(tmin),
        fmt_ms(tmed),
        fmt_ms(tmax)
    );

    // ── 3) 整页匹配 ────────────────────────────────────────────
    for (cols, rows) in [(4usize, 1usize), (6, 2), (8, 5)] {
        let sheet = sheet_png(0, cols, rows);
        let cells = cols * rows;
        let (smin, smed, smax) = bench(5, || {
            let _ = recognize_sheet_image_bytes(&INDEX, &sheet).expect("sheet");
        });
        println!(
            "\n  整页 {} 格（{}x{}）png {} B → min {} ms / p50 {} ms / max {} ms  ({:.2} ms/格)",
            cells,
            cols,
            rows,
            sheet.len(),
            fmt_ms(smin),
            fmt_ms(smed),
            fmt_ms(smax),
            smed.as_secs_f64() * 1000.0 / cells as f64
        );
    }

    // ── 3b) 真实尺寸截图：解码成本才是大头 ─────────────────────
    println!("\n== 3b) 手机截图尺寸（含解码，这才是线上真实开销）==");
    for (w, h) in [(1280usize, 900usize), (2000, 1500), (3000, 4000)] {
        let img = photo_like_png(w, h);
        let (_dmin, dmed, _dmax) = bench(3, || {
            let _ = image::load_from_memory(&img).expect("decode").to_luma8();
        });
        let (fmin, fmed, fmax) = bench(3, || {
            let _ = match_image_bytes(&img).expect("match");
        });
        println!(
            "  {}x{} png {} KiB → 仅解码 p50 {} ms / 解码+归一化+匹配 p50 {} ms（min {} / max {}）",
            w,
            h,
            img.len() / 1024,
            fmt_ms(dmed),
            fmt_ms(fmed),
            fmt_ms(fmin),
            fmt_ms(fmax)
        );
        // 拆到函数级：解码 / 归一化（中值+阈值+裁剪+缩放）各自占多少
        let luma = image::load_from_memory(&img).expect("decode").into_luma8();
        let (nmin, nmed, nmax) = bench(3, || {
            let _ = taiyin_server::template_match::normalize_gray(
                luma.width() as usize,
                luma.height() as usize,
                luma.as_raw(),
                SIZE,
            );
        });
        println!(
            "      仅归一化 p50 {} ms（min {} / max {}）",
            fmt_ms(nmed),
            fmt_ms(nmin),
            fmt_ms(nmax)
        );
        let (peak, _retained) = heap_delta(|| {
            let _ = match_image_bytes(&img).expect("match");
        });
        println!(
            "      单次识别堆峰值增量 = {:.1} MiB（输入仅 {:.1} MiB）",
            peak as f64 / (1024.0 * 1024.0),
            img.len() as f64 / (1024.0 * 1024.0)
        );
        // 内存放大：解码后的 luma8 与 RGBA8 各占多少
        println!(
            "      解码后 luma8 = {:.1} MiB，若按 RGBA8 解码 = {:.1} MiB（请求体上限 5 MiB 挡不住这个）",
            (w * h) as f64 / (1024.0 * 1024.0),
            (w * h * 4) as f64 / (1024.0 * 1024.0)
        );
    }

    // ── 4) 单 worker 下的调度停顿 ───────────────────────────────
    let idle = {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("rt");
        rt.block_on(async {
            let max_gap = Arc::new(AtomicU64::new(0));
            let mg = max_gap.clone();
            let t = tokio::spawn(async move {
                let mut last = Instant::now();
                for _ in 0..40 {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    let now = Instant::now();
                    mg.fetch_max(
                        now.duration_since(last).as_micros() as u64,
                        Ordering::Relaxed,
                    );
                    last = now;
                }
            });
            let _ = t.await;
            Duration::from_micros(max_gap.load(Ordering::Relaxed))
        })
    };
    println!("\n== 4) 单 worker 运行时：5ms 定时器的最大唤醒间隔 ==");
    println!("  （对比「内联同步调用」与「spawn_blocking」，即修复前 / 修复后）");
    println!(
        "  空载基线            {:>8.2} ms",
        idle.as_secs_f64() * 1000.0
    );
    for c in [1usize, 4] {
        let inline = max_scheduler_stall(c);
        let blocking = max_scheduler_stall_blocking(c);
        println!(
            "  {} 个并发 login：内联 Argon2 {:>8.2} ms   |   spawn_blocking {:>8.2} ms",
            c,
            inline.as_secs_f64() * 1000.0,
            blocking.as_secs_f64() * 1000.0
        );
    }
    println!("\n（停顿 = 这段时间内服务连 /health 都回不了）");
}
