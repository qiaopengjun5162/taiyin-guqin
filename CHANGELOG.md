# 更新日志

## [0.4.0] - 2026-09-10

### 新增

- **整页减字谱批量识别（P1）**：新增 `POST /api/v1/jianzi/recognize-sheet`，后端以 Claude 多模态将整页减字谱图片识别为按网格坐标（`{row, col, glyph, confidence}`）排布的减字网格；前端 `JianziSheetRecognizer` 提供上传、网格展示与一键导入。
- **由减字反推简谱音高**：新增 `apps/web/src/lib/jianzi-pitch.ts`，按正调物理模型（散音取空弦、按音按徽位比例 `freq = open/(1-p)`、泛音取谐波次数）由减字反推音高，使识别 / 导入的曲谱可整段播放。
- **简谱音域扩至 ±2 八度**：`JianpuOctave` 由 `"" | "·" | ","` 扩展为 `"" | "·" | "··" | "," | ",,"`，全链路（播放、解析、翻译候选、键盘、曲谱视图、导出）同步，古琴低音区 / 高音区不再被移位。
- **单字识别逐字校正**：`JianziRecognizer` 识别结果改为可编辑校正框，实时重解析 / 重渲染 / 重推音高，试听与简谱跟随校正后减字。
- **整页识别逐格校正**：`JianziSheetRecognizer` 每格提供可编辑校正框（`edits[row-col]` 覆盖识别结果），按校正后减字回填简谱并导入。

### 修复

- **整页识别导入诊断**：导入不再静默丢弃无法解析的减字。网格上方显示「可导入 N · 待校正 K · 空格 M」，解析失败格标琥珀边框提示「无法解析」，导入回报「跳过 Y（未识别 A、无法解析 B）」。
- 后端识别接口复用翻译限流与可选 key 闸门，缺 `ANTHROPIC_API_KEY` 时返回 `503` 而非崩溃。

### 工程

- 新增回归测试：单字 / 整页识别校正、音高反推、±2 八度播放与导出、简谱解析。
- `.github/workflows/pages.yml` 已配置 GitHub Pages 自动部署（自定义域名 `paxonqiao.com/taiyin-guqin/`）。

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
