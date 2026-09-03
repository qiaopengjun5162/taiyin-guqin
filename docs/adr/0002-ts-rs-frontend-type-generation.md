# ADR-0002 · 前端 TS 类型由 Rust wire 类型经 ts-rs 生成

- **状态**:已采纳(Accepted)
- **日期**:2026-09-03
- **决策人**:高级开发工程师(代码质量把控)
- **相关**:`crates/taiyin-core/src/{lib, jianpu}.rs`、`crates/taiyin-core/src/bin/gen_types.rs`、`apps/web/src/lib/generated/`、`just gen-types` / `just check-types-fresh`

---

## 背景(Context)

前端（`apps/web`）通过 WASM JSON 桥接消费 `taiyin-core` 的翻译结果（见 ADR-0001）。
此前前端在 `apps/web/src/lib/types.ts` **手工维护** `WasmCandidate` / `WasmCandidateNote`，
与 Rust WASM 边界 JSON 契约（中文枚举值 `散/泛/按`、`板/散/宕`、newtype→number、9 字段）
人工对齐，存在契约漂移风险。ADR-0001 的"后续"已点名评估"从 `taiyin-core` 的 `serde`
派生自动生成前端 TS 类型"。

需要决定:**前端 TS 类型如何与 Rust 契约保持同步**。两条路:

1. **继续手工维护**:改 Rust 后人工同步前端接口,靠 code review 兜底。
2. **从 Rust 自动生成**:用 `ts-rs` 把 wire 类型导出为 TS,纳入构建/CI 校验。

---

## 决策(Decision)

**采用 ts-rs 从 Rust wire 类型自动生成前端 TS 类型**(方案 2)。

- 根类型 `JianziCandidate { score: i32, note: GuqinNote }`,用 `TS::export_all()` 递归导出
  全部依赖(`GuqinNote` 及 `NoteType`/`RhythmMode`/`CompoundAction` 等枚举、newtype)。
- 生成由 `crates/taiyin-core/src/bin/gen_types.rs` 触发(`just gen-types`),输出到
  `apps/web/src/lib/generated/`,以 `./TypeName` 互相引用,干净无跨目录丑路径。
  **不放 build.rs**:`build.rs` 在 lib 编译前运行、无法引用本 crate 类型,故放 bin 目标。
- 生成的 `.ts` 提交进仓库,前端直接 `import type { JianziCandidate } from "@/lib/generated/taiyin"`,
  删除原手工 `WasmCandidate`/`WasmCandidateNote`。
- 防漂移:`just check-types-fresh` 重新生成并 `git diff --exit-code`,接进 `precommit` 与 `ci`;
  `build.yml` Rust job 也有等价校验步骤。

理由:

- **契约单一来源**:Rust 是真相,Rust 一改、生成类型即变,前端引用处编译失败,把漂移暴露在编译期。
- **中文枚举零失真**:`#[ts(rename = "散")]` 与 `#[serde(rename = "散")]` 并列,前后端枚举值完全一致。
- **可审计、可复现**:生成文件进仓库,PR diff 能 review 契约变化;非运行时依赖。

---

## 后果(Consequences)

**正面**
- 消除手工对齐成本与漂移风险;新增/修改 wire 字段会被 `check-types-fresh` 捕获。
- 生成物进仓库,前端类型随代码版本化,历史可追溯。

**负面 / 注意**
- ts-rs v9 有若干坑位(已在 `.workbuddy/memory/2026-09-03.md` 记录):
  - derive 宏名为 **`TS`(大写)**,需 `use ts_rs::TS;`。
  - `#[ts(...)]` 是 `#[derive(TS)]` 的辅助属性,**必须放在 derive 之后**。
  - 路径由运行时 `TS_RS_EXPORT_DIR` 控制;用 `export_all()` 递归导出依赖。
  - 不启用 `format` 特性(其传递依赖 `swc_common` 与本项目 serde 不兼容、无法编译);
    改用 `gen_types.rs` 生成后统一去除行尾空白,避免触发 pre-commit 空白检查。
- 生成文件须随 Rust 改动一并提交,否则 `check-types-fresh` 失败。

---

## 后续(Follow-ups)

- 若新增 wire 类型,需在其上加 `#[derive(..., TS)]` 与 `#[ts(export_to = "<Name>.ts")]`,
  并确认被 `JianziCandidate` 的依赖图覆盖(否则不会被 `export_all` 带出)。
- 评估把生成目录接入 IDE 路径提示/代码跳转,进一步降低误用成本。

---

## 参考

- `crates/taiyin-core/src/bin/gen_types.rs` —— 生成入口
- `apps/web/src/lib/generated/` —— 生成产物
- `docs/adr/0001-wasm-json-bridge.md` —— 边界契约背景
- `.workbuddy/memory/2026-09-03.md` —— ts-rs v9 实操坑位
