# 更新日志

## [0.3.0] - 2026-09-03

### 新增

- 从 Rust wire 类型自动生成前端 TS 类型（`crates/taiyin-core/src/bin/gen_types.rs` + `ts-rs`），
  输出到 `apps/web/src/lib/generated/`，消除手工维护的 `WasmCandidate`/`WasmCandidateNote` 与契约漂移。
  提供 `just gen-types`（重新生成）与 `just check-types-fresh`（断言与 Rust 契约同步）。
- 依赖安全审计接入：新增 `.cargo/audit.toml`，`just audit` 目标，`build.yml` Rust job
  增加 `rustsec/audit-check` 步骤，每次 push 自动查依赖漏洞。
- `build.yml` web job 新增 **Verify WASM contract** 步骤（`node scripts/verify-wasm.mjs`），
  对真实 WASM 产物做契约断言（翻译返回、枚举序列化、tuning 生效），不再只靠 mock。

### 修复

- **CI 长期失败根因修复**（build 工作流此前自 2026-07-19 起一直红）：
  - web job 此前从不编译 wasm，而前端 `import('@/wasm/taiyin_core')` 解析到被 gitignore 的
    `apps/web/wasm`，导致 Type check / Build 找不到模块。已照搬一直绿的 `pages.yml` 补齐
    Rust + wasm-pack + Build WASM 步骤。
  - `.cargo/config.toml` 的全局 `target-cpu=native` 把 proc-macro 按构建机 CPU 编译，
    与 `Swatinem/rust-cache` 跨异构 runner 复用 `target/` 缓存冲突 → `cargo check` 间歇性
    `SIGILL`。已移除该设置，改用默认 baseline 指令集。
  - 前端 `use-score-player.ts` 的 `react-hooks/set-state-in-effect` 与未用 import 告警。

### 工程

- `just ci` 增加 `audit`，与 `build.yml` 的审计步骤保持一致（本地全量检查也覆盖依赖安全）。
- 新增架构决策留档：`docs/adr/0002-ts-rs-frontend-type-generation.md`、
  `docs/adr/0003-cargo-audit-vulnerability-policy.md`。

## [0.2.0] - 2026-07-19

### 新增

- 后端环境变量配置：`HOST`、`PORT`、`DATABASE_URL`。
- 前端静态导出配置（`output: "export"`），产物位于 `apps/web/dist`。
- WASM 加载状态与错误提示，翻译失败时显示内联错误。
- 全局错误提示条，替代保存/加载/删除时的 `alert()`。
- 移动端可访问性：按钮触摸目标 ≥44px、aria-label、触摸设备上删除按钮常显。
- 空状态快捷示例入口与简谱序列输入语法提示。

### 重构

- 拆分 `jianpu-translator.tsx`：提取 `single-note-mode.tsx`、`sequence-mode.tsx`、`candidate.ts`。

### 修复

- `use-metronome.ts` 在 render 期更新 ref 的 React 规则违规。
- 测试文件中的 `any` 与未使用变量导致的 lint 错误。
- 播放中乐谱变更时自动停止，避免旧音频继续发声。

### 工程

- CI 新增前端 `lint` 与 `test` 步骤。
- 新增 `.env.example` 与部署文档。

## [0.1.0] - 2026-05-24

### 新增

- 项目初始化：Rust 核心库、Axum 后端、Next.js 前端。
- 减字谱拼装键盘与纯字体 GSUB 渲染。
- 简谱转减字（单音/序列）、多调式、LLM 候选择优。
- 撤销/重做、示例曲谱、节奏可视化、乐谱导出、旋律播放、节拍器。
