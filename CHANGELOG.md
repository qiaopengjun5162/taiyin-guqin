# 更新日志

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
