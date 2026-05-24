# 开发日志 (Development Log)

## 2026-05-24

### 项目初始化

- 确定品牌名：**太音**，GitHub 仓库：`taiyin-guqin`
- 创建项目骨架：
  - `crates/taiyin-core/` — Rust 核心数据结构（GuqinNote, GuqinScore）
  - `apps/web/` — Next.js 16 + React 19 + Tailwind CSS 4 前端
  - `justfile` — 统一构建命令
  - `docker-compose.yml` — 本地数据库服务
  - CI (GitHub Actions) + pre-commit hooks

### 代理配置

- 代理端口：7897（Clash HTTP 代理）
- 设置方式：`export http_proxy=http://127.0.0.1:7897`、`export https_proxy=http://127.0.0.1:7897`

### 数据结构设计要点

- 减字谱用 **拼装模型** 而非枚举组合，通过类型系统保证有效组合
- 散音用 `left_finger = None + hui = None` 表达
- 传统减字谱不记节奏，但传习平台需要，所以 `duration` 为必填

### GitHub 仓库

- 仓库：`qiaopengjun5162/taiyin-guqin`
- 已推送 main 分支
- Git workflow: 直接推送 main（单人开发阶段），后续视协作情况考虑 PR 流程

### 文档

- README.md — 中文项目文档
- README.en.md — 英文项目文档
- CONTRIBUTING.md — 贡献指南

### 竞品调研 (2026-05-24)

调研了现有减字谱电子化开源项目：

1. **alephpi/jianzipu** — Python 生成 OpenType 字体方案，用 GSUB 特性拼装减字
2. **neuralfirings/guqincomposer** — NLTabs 作曲系统，LilyPond 渲染
3. **JianZiPu.otf** — OFL 开源减字字体

关键发现：**没有手机端交互输入方案**。我们的 CSS 拼装键盘 + Rust WASM 方向是蓝海。
现有项目的语法树结构与我们的 GuqinNote 数据模型高度匹配，验证了设计正确性。

参考链接：
- https://github.com/alephpi/jianzipu
- https://github.com/neuralfirings/guqincomposer
- https://www.npmjs.com/package/jianzipu

### CI 修复 (2次)

1. lockfile 路径修正、workspace 配置迁移
2. 添加根 .npmrc + `pnpm install --no-frozen-lockfile` + pnpm version 检查
   - 问题：CI 中 pnpm 拒绝执行 sharp/unrs-resolver 的 postinstall 脚本
   - 尝试：`onlyBuiltDependencies` 在 pnpm-workspace.yaml + .npmrc + CI 中显式配置

- CI workflow lockfile 路径修正（根目录 `pnpm-lock.yaml`）
- 删除 `apps/web/.npmrc`（配置已迁移到根 `pnpm-workspace.yaml`）
- web job 移除 `working-directory`，`pnpm install` 在 workspace 根运行
- 使用 `pnpm --filter web build` 构建前端

### 数据模型完善 (2026-05-24)

根据《琴学入门》和《琴学备要》等传统文献修正数据模型：

1. **NoteType 枚举**：新增散/泛/按三种音色类型，GuqinNote 增加 note_type 字段
2. **CompoundAction 枚举**：完整补充 18 种复合右手指法（历/蠲/轮/半轮/背锁/短锁/长锁/全扶/拨/剌/泼剌/撮/双弹/打圆/索铃/滚/拂/如一）
3. **左手指法偏旁修正**：名→夕、食→亻，采用传统减字偏旁写法
4. **预览布局修正**：左上=指法、右上=徽位、左下=右手、右下=弦序

### 后续修复与 CI 通过

1. justfile 修复：补充 cargo/pnpm 变量定义，{{cargo}}/{{pnpm}} 引用恢复正常
2. CI pnpm 修复：`--ignore-scripts` 跳过 sharp/unrs-resolver postinstall，CI 最终通过
3. Node.js 20 废弃警告：添加 FORCE_JAVASCRIPT_ACTIONS_TO_NODE24 环境变量


### 下一步

- 减字键盘前端组件（CSS 拼装渲染）
- taiyin-server Axum 后端骨架
- WASM bindings for core lib
