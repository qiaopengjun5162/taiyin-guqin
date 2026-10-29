# 项目时间线（自动生成）

> 由 `scripts/gen-article-timeline.sh` 从 git 日志生成，请勿手改。
> 生成时间：2026-10-29 21:06

## 总量

| 指标 | 数值 |
|---|---|
| 提交数 | 118 |
| 时间跨度 | 2026-05-24 → 2026-10-29 |
| 有提交的天数 | 21 |
| 累计新增 / 删除行 | +29316 / -2820 |
| 跟踪文件数 | 156 |

## 按月

| 月份 | 提交数 |
|---|---|
| 2026-05 | 32 |
| 2026-06 | 9 |
| 2026-07 | 22 |
| 2026-08 | 4 |
| 2026-09 | 41 |
| 2026-10 | 10 |

## 逐条提交

按时间正序。写文章时按「阶段」聚合，不要流水账。


### 2026-05

- `2026-05-24` · `9b600ea` · 项目初始化：太音 · 古琴减字谱核心数据结构与前端骨架
- `2026-05-24` · `e483e74` · 完善 README 与 CLAUDE.md，推送 GitHub 仓库
- `2026-05-24` · `a210340` · docs: 添加 CONTRIBUTING.md 与英文 README
- `2026-05-24` · `a5cb78c` · fix: pnpm-workspace.yaml 配置修复，前端构建验证通过
- `2026-05-24` · `cc83f65` · docs: 补充竞品调研结果与开发日志
- `2026-05-24` · `c9fbe6c` · fix: CI workflow lockfile路径和pnpm workspace配置
- `2026-05-24` · `80ed2c6` · docs: 更新开发日志记录CI修复
- `2026-05-24` · `7fc873e` · feat: 减字键盘前端组件 MVP
- `2026-05-24` · `2f4bc37` · fix: CI pnpm构建脚本权限问题
- `2026-05-24` · `604d883` · docs: 更新开发日志CI修复记录
- `2026-05-24` · `8e01451` · fix: justfile 变量定义 + CI pnpm --ignore-scripts
- `2026-05-24` · `25c4994` · feat: 补充音色类型 NoteType + 修正减字偏旁写法 + 优化键盘布局
- `2026-05-24` · `3d05582` · docs: 补充完整复合指法 + 更新开发日志
- `2026-05-24` · `7a3e959` · docs: 补充竞品调研/学术文献/专利分析到开发日志
- `2026-05-24` · `f1b9318` · feat: 新增节奏模式 RhythmMode（板/散/宕）
- `2026-05-24` · `cb1f28b` · fix: 右手指法改用传统减字偏旁写法
- `2026-05-24` · `6cf79af` · style: 重写减字预览区布局——加大留白、楷体字族、层级字号
- `2026-05-24` · `d40c3b0` · style: 全面视觉重设计——墨色/宣纸/印章/丝弦美学
- `2026-05-25` · `3143630` · feat: 纯字体 GSUB 连字渲染 + 字体 DRM 清除
- `2026-05-25` · `ac6be14` · fix: 泛音加空格阻断 GSUB 上下文劫持，散音恢复为左侧前缀
- `2026-05-26` · `4f16e20` · feat(svg-engine): 跑通混合渲染管线与四象限核心矩阵
- `2026-05-26` · `64414ec` · feat(svg-engine): CSS 绝对定位布局 + 测试套件 + 后端集成
- `2026-05-26` · `6832b81` · fix: 状态保留改为仅保留音色，clippy 警告清理，justfile 补前端命令
- `2026-05-26` · `ce365b5` · fix: 连续同音紧凑支持所有音色（散/泛/按）
- `2026-05-26` · `60d1631` · feat: 音符删除按钮改为 hover 显现 × 图标
- `2026-05-26` · `1035016` · feat: ScoreView 编辑模式完善 + WASM 构建流水线 + CLAUDE.md Policy 系统
- `2026-05-26` · `d2367ab` · feat: merge svg-engine into main — 一期混合渲染引擎里程碑
- `2026-05-26` · `2d77faf` · feat: 后端持久化 + 前端保存/加载 + pre-commit 自动化管线（v0.2.0）
- `2026-05-26` · `acaf644` · feat: 多谱管理（B3）— 加载对话框支持删除曲谱
- `2026-05-27` · `558e07a` · feat: SVG 积木库古体字形替换（齊伋體·明刻本风格）
- `2026-05-27` · `38c7f09` · docs: 更新古体字形相关文档和 justfile 配置
- `2026-05-27` · `0661e56` · fix: 安全加固 + 代码重构 — 安全审计修复 6 项 + 消除重复代码

### 2026-06

- `2026-06-28` · `6b6a172` · docs: 撤销/重做 + 编辑器快捷键设计文档
- `2026-06-28` · `a1a2874` · docs: 撤销/重做 + 编辑器快捷键实现计划
- `2026-06-29` · `46f1f19` · feat: add useScoreHistory hook for undo/redo
- `2026-06-30` · `9a0703f` · feat: wire undo/redo into score editor with toolbar buttons and keyboard shortcuts
- `2026-06-30` · `76d2403` · test: add SaveLoadToolbar unit tests for undo/redo and interactions
- `2026-06-30` · `e979057` · docs: update CLAUDE.md and DEVELOPMENT_LOG for undo/redo feature
- `2026-06-30` · `ffdd20b` · docs: add Chen Changlin guqin-computer research references
- `2026-06-30` · `2c7bb56` · feat: undo/redo + editor keyboard shortcuts
- `2026-06-30` · `94799a4` · chore: ignore .claude directory

### 2026-07

- `2026-07-03` · `8f8b28d` · feat: add JianpuNote and ZhengDiao pitch table with candidate generation
- `2026-07-03` · `bf3b8c9` · feat: expose translate_jianpu_to_jianzi via WASM
- `2026-07-03` · `e380a24` · feat: add JianpuTranslator component and tests
- `2026-07-03` · `6bcff92` · docs: update CLAUDE.md and DEVELOPMENT_LOG for jianpu translation
- `2026-07-14` · `2003ec5` · feat(core): jianpu sequence translation, pressed-tone candidates, context-aware ranking
- `2026-07-14` · `fadaf3e` · feat(web): sequence input, example scores, rhythm barlines, text export
- `2026-07-14` · `68be8ec` · docs: log sequence/pressed-tone/example/rhythm/export features, add export policy
- `2026-07-14` · `4071235` · feat(web): rhythm duration parsing for jianpu sequence input
- `2026-07-14` · `3c00f7f` · feat(web): rest symbols enter the score with correct durations
- `2026-07-15` · `4514ef4` · feat: multi-tuning candidate generation (zheng/ruibin/manjiao)
- `2026-07-15` · `d47cba5` · feat: LLM candidate selection via POST /api/v1/translate/select
- `2026-07-15` · `529b02f` · fix(web): invalidate candidates when tuning changes
- `2026-07-15` · `b2a8546` · fix(web): parse note_type per real WASM contract (Chinese enum values)
- `2026-07-15` · `0fd0309` · refactor: remove unused WASM bridge functions
- `2026-07-16` · `2e716c1` · feat(web): melody playback with Karplus-Strong plucked-string synthesis
- `2026-07-16` · `c03e297` · feat(web): per-note highlight during playback
- `2026-07-16` · `b18ab93` · feat(web): metronome with meter-aware accent
- `2026-07-19` · `82aac8a` · release: v0.2.0 production polish
- `2026-07-19` · `0a42d5f` · docs: update proxy port to 7890
- `2026-07-19` · `9ef2c95` · ci: deploy frontend to GitHub Pages
- `2026-07-19` · `5a966f8` · ci: fix Pages workflow Rust action
- `2026-07-19` · `e3a1550` · fix(web): basePath/assetPrefix for GitHub Pages subpath

### 2026-08

- `2026-08-06` · `fb34960` · refactor(web): extract jianzi helpers into dedicated module
- `2026-08-06` · `8624b52` · ci: run backend integration tests against Postgres; freeze lockfiles
- `2026-08-06` · `90dbb40` · feat: backend quality uplift — security gate + domain newtypes
- `2026-08-06` · `57ca8a8` · chore: engineering process — pre-commit, PR template, CODEOWNERS, coverage, ADR

### 2026-09

- `2026-09-03` · `98971d1` · feat(taiyin-core): 用 ts-rs 自动生成前端 wire 类型，消除手工对齐
- `2026-09-03` · `f43cc1b` · ci: 在 Rust job 增加 Rust→TS wire 类型新鲜度校验
- `2026-09-03` · `df840b4` · ci(security): 接入 cargo audit 依赖安全审计，修复可修漏洞
- `2026-09-03` · `6f4eec6` · fix(web): 修复 ESLint 阻断 CI 的 set-state-in-effect 与未用 import
- `2026-09-03` · `adc1b96` · ci(build): web job 补齐 wasm 编译步骤，修复 '@/wasm/taiyin_core' 找不到
- `2026-09-03` · `0d59a56` · ci(build): 修复 web job Build WASM 的 cd 目录错位
- `2026-09-03` · `da36f33` · fix(web): 保留同步 stop 行为，定向豁免 set-state-in-effect 规则
- `2026-09-03` · `ac05d3c` · ci: 移除 .cargo/config.toml 的 target-cpu=native，根治 cargo check 的 SIGILL
- `2026-09-03` · `11c9532` · chore: 收尾一致性 + 文档 —— 完成本项目质量 uplift
- `2026-09-03` · `c87442b` · chore(web): eslint 忽略生成的 WASM / dist 构建产物，消除 lint 噪音
- `2026-09-04` · `0b656b8` · fix(web): 拨弦时长跟随音符自身时值，消除短音拖尾糊音
- `2026-09-04` · `e7b8d80` · feat(web): 播放/节拍器速度（BPM）可调，UI 暴露滑块
- `2026-09-04` · `a04e980` · feat(web): 播放按散/泛/按音技法区分音色
- `2026-09-04` · `ea8d120` · test(web): 同步自动 stop 契约以覆盖按音音色尾长
- `2026-09-04` · `bbd1dc5` · feat(web): 节拍器拍点高亮 + 与播放联动
- `2026-09-04` · `3eea9af` · feat(web): 旋律导出为 WAV 音频（OfflineAudioContext 离线渲染）
- `2026-09-04` · `eb7dd19` · feat(web): 导出音频可烘入节拍器点击声（带伴奏练习轨）
- `2026-09-04` · `34d793b` · fix(web): 移动端播放控件不溢出、BPM 滑块触控手感
- `2026-09-04` · `7fa36ef` · feat(web): 导出练习轨支持 2 小节预备拍（起手找速度）\n\n- audio-export.ts: RenderOptions 新增 leadInBars，旋律整体推迟对应小节数，\n  预备拍区只响节拍、不响旋律，方便练琴前找准速度。\n- 同时补回缺失的 audioBufferToWav（16-bit PCM WAV 编码）与 downloadWav。\n- page.tsx: 新增「导出音频含预备拍」复选框（默认勾选，仅有音符时显示），\n  与「播放带节拍」开关同构、互不影响。\n- 导出与实时播放共用同一套合成，音色/节拍/预备拍听感一致。\n\n(实际修复上轮 race condition 导致的 audio-export.ts 部分写入丢失)
- `2026-09-07` · `f8ef7ee` · feat(web): 减字谱解析器支持传统偏旁指法 + 新增字形预览画廊
- `2026-09-07` · `04bb19b` · fix(web): 修正减字谱分位与顶帽槽位比例失衡
- `2026-09-07` · `dbbed51` · feat(web): 新增《花非花》示例曲谱（古琴弹奏经典歌曲三十首）
- `2026-09-07` · `d1c3578` · feat(web): 减字谱支持复合指法（抹挑/勾剔/抹勾/打摘）
- `2026-09-07` · `ea2979e` · fix(test): svg-paths 数据完整性测试同步复合指法字形计数
- `2026-09-07` · `6743351` · feat(web): 乐谱流支持歌词显示（按字对齐到音符下方）
- `2026-09-07` · `1f1842e` · feat(web): 乐谱新增 SVG 矢量导出（与既有 PNG 并列）
- `2026-09-07` · `707a907` · fix(test): 工具栏测试适配 PNG/SVG 双导出按钮
- `2026-09-07` · `e7966db` · fix(test): 修正 use-export-image 测试的模块 mock 写法
- `2026-09-07` · `8a48362` · feat(web): 点击歌词跳转到对应音符开始播放
- `2026-09-07` · `b25ebbd` · feat(web): 播放时自动滚动当前音符进视野（长曲不跟丢）
- `2026-09-08` · `4fc8b55` · feat(web): 空格键播放/停止快捷键
- `2026-09-09` · `ea29e4c` · feat(web+server): AI 减字谱单字识别 + 可点听（对标「琴与人的交互 1 号」）
- `2026-09-09` · `78906f4` · style(rust): 修正 llm.rs 一处超宽行的 rustfmt 格式
- `2026-09-09` · `70bb321` · fix(test): 为 jianzi-recognizer 测试 shim jsdom 的 FileReader
- `2026-09-09` · `9bb874e` · feat(web+server): 整页减字谱批量识别（P1）+ 可导入曲谱
- `2026-09-09` · `19799d4` · feat(web): 由减字反推简谱音高，使识别/导入曲谱可整段播放
- `2026-09-09` · `f996f22` · feat(web): 整页识别支持逐格校正误读减字（P2 校正）
- `2026-09-09` · `01925b2` · feat(web): 单字识别支持逐字校正误读减字（与整页校正对齐）
- `2026-09-09` · `9a80590` · feat(web): 简谱音域扩至 ±2 八度，古琴低音/高音不再被移位
- `2026-09-10` · `4f43a3f` · fix(ci): 修 rustfmt 与单字校正测试（CI 两处红灯）
- `2026-09-10` · `be47342` · feat(web): 整页识别导入诊断——不再静默丢弃无法解析的减字

### 2026-10

- `2026-10-28` · `4562d17` · docs: 对齐 README 与 CHANGELOG 的 AI 减字识别功能说明（[0.4.0]）
- `2026-10-29` · `3bf53a4` · feat(server): 支持 ANTHROPIC_BASE_URL 覆盖 Anthropic 端点，便于接入兼容代理
- `2026-10-29` · `8b6b002` · style(server): rustfmt 修正 base_url 单行格式
- `2026-10-29` · `827badf` · chore(deps): 升级 quinn-proto/rustls/rustls-webpki/tokio 修复 cargo audit 漏洞
- `2026-10-29` · `00e363b` · ci: 在 cargo audit 豁免列表追加 RUSTSEC-2026-0381（webpki-roots 0.26.x 无上游修复）
- `2026-10-29` · `d6a5b69` · docs: 新增 VERIFICATION.md 协作与验证契约（人/Claude 职责双栏 + 快速确认协议）
- `2026-10-29` · `40c88e4` · feat(eval): 新增减字谱识别准确率评估 harness 骨架（标注/计分/报告/离线自测）
- `2026-10-29` · `0e16f10` · test(eval): 让减字识别 eval 在「无 key」下也能端到端验证
- `2026-10-29` · `e7151b1` · feat(server): OpenAI 兼容视觉模式真正跑通 + 字体真值数据集与首份基线
- `2026-10-29` · `b1c8672` · docs(eval): 补充模型输出非确定性 —— 同一张图两次跑出不同错答
