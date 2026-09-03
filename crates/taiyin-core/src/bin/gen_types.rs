//! 从 Rust wire 类型生成前端 TypeScript 类型。
//! 由 `just gen-types` 调用。ts-rs 的 `export()` / `export_all()` 必须在本 crate 编译之后执行，
//! 因此放在 bin 目标而非 build.rs（build.rs 在 lib 编译前运行，无法引用本 crate 类型）。
//!
//! ts-rs 把所有类型写到 `TS_RS_EXPORT_DIR` 指向的目录（运行时环境变量，默认 `./bindings`），
//! 每个类型一个文件。这里把它指向前端的 `generated/` 目录，并给每个 wire 类型设置
//! `export_to = "<TypeName>.ts"`，于是生成结果全部落在 `apps/web/src/lib/generated/` 下，
//! 类型之间以 `./TypeName` 互相引用，干净且无跨目录丑路径。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use ts_rs::TS;

fn main() {
    // 由 CARGO_MANIFEST_DIR（crates/taiyin-core）向上两级回到仓库根，再进入前端 generated 目录。
    // 用绝对路径避免依赖运行时的当前工作目录。
    let out_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/src/lib/generated");

    // `set_var` 是 unsafe（可能与其他线程的读取产生数据竞争），
    // 这里发生在 main 最开头、单线程设置环境变量，是安全的用法。
    unsafe {
        std::env::set_var("TS_RS_EXPORT_DIR", &out_dir);
    }

    // 用 export_all 而非 export：后者只导出单个类型，
    // 前者会递归导出 JianziCandidate 及其全部依赖（GuqinNote、各枚举等）到同一 generated 目录。
    taiyin_core::jianpu::JianziCandidate::export_all().expect("failed to export taiyin TS types");

    // ts-rs 生成结果带行尾空白（如 `export type X = { `），会触发 pre-commit 的空白检查。
    // 生成后统一去除行尾空白，保证提交钩子与 check-types-fresh 稳定通过。
    strip_trailing_whitespace(&out_dir);

    println!("✓ generated {}", out_dir.join("taiyin.ts").display());
}

/// 递归去除目录下所有 `.ts` 文件每行的行尾空白（保留原始末尾换行）。
fn strip_trailing_whitespace(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("ts") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let stripped: String = content
            .lines()
            .map(|line| line.trim_end().to_string())
            .collect::<Vec<_>>()
            .join("\n");
        // 保留原始文件末尾的换行符
        let stripped = if content.ends_with('\n') {
            format!("{stripped}\n")
        } else {
            stripped
        };
        if stripped != content {
            let mut f = fs::File::create(&path).expect("failed to rewrite generated TS");
            f.write_all(stripped.as_bytes())
                .expect("failed to write generated TS");
        }
    }
}
