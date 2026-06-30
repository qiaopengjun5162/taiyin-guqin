# 开发日志 (Development Log)

## 2026-06-30

### 撤销/重做 + 编辑器快捷键

- 新增 `useScoreHistory` hook（`apps/web/src/lib/use-score-history.ts`），三段式历史栈（past/present/future），最大深度 50，同时记录 score 和 title。
- 在 `page.tsx` 中替换原 `useState(score)` / `useState(title)`，所有写入操作通过 `commitScore` / `commitTitle` 进入历史。
- 添加全局键盘监听：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 与 Ctrl/Cmd+Y 重做；在 input/textarea/contenteditable 内不拦截。
- 在 `SaveLoadToolbar` 添加撤销/重做按钮，禁用态与快捷键提示。
- 新增 15 个前端测试：7 个 `use-score-history` 测试 + 8 个 `save-load-toolbar` 测试。
- 当前测试总数：Rust 17 + 前端 69 = 86。

### 陈长林与古琴计算机研究资料补充

通过网络检索补充了陈长林在古琴减字谱计算机化方面的关键资料：

- **陈长林**（1932–），中科院计算所研究员、闽派琴人，是把计算机技术引入古琴减字谱研究的先驱。
- **1982 年** 设计 **"音记编码"法**，编制 **"古琴谱电脑处理系统"（QPS）**，实现减字谱的键盘输入、显示与排版。
- **1989 年** 在《计算机学报》发表 **《电脑在古琴音乐研究中的初步应用》**，第 525–533 页。
- **1998–2002 年** 开发 **MIDI 古琴** 与 **古琴谱电脑模拟奏乐**，把研究从乐谱图像延伸到音响合成。
- 后续研究者（喻辉 1993、张维城/苏文钰 2003、周昌乐/丁晓君 2007–2008、王德埙 2007 等）均在其基础上继续推进。

参考链接：
- [科学与艺术丨第一台电子计算机和古琴的故事](https://www.sohu.com/a/328053163_657694)
- [古琴减字谱的编码与编辑方法 - 万方](https://d.wanfangdata.com.cn/periodical/zgyyx200802018)
- [七弦连文理琴韵通古今 - 故宫 PDF](https://www.dpm.org.cn/Uploads/File/2019/08/29/u5d677028d6872.pdf)

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

### 竞品调研补充 (2026-05-24)

深度调研了广陵散社区 (guanglingsan.com) 减字谱软件板块的主要项目：

| 项目 | 作者 | 年代 | 方案 | 平台 |
|------|------|------|------|------|
| 广陵神器 | 張家大公子 | ~2010 | Word插件+自定义字体 | Windows |
| 老江古琴减字输入法 | 江振兴(台湾) | ~2012 | Word插件+字体 | Windows |
| 包松平古琴减字输入法 | 包松平 | 2013-2014 | 系统输入法+楷体字体 | Windows |
| 火蜘蛛古琴输入法 | firespide | 2025-2026 | 系统输入法+八款字体+五线谱 | Windows |
| 北大方正专利 | 唐英敏/张国荣 | 2010(已过期) | TrueType复合字形拼装 | 字体方案 |

关键发现：
- **没有手机端方案**：2014年就有用户问"有没有手机版"，12年过去仍无答案
- **全是桌面软件**：Windows/Office插件架构，安装门槛高，换电脑要重装
- **字体/造字路线**：依赖预先造好的字库，新组合需要手动造字
- **个人开发者维护**：用户装了用不了也没人修

太音优势：Web原生+移动优先+CSS拼装（不依赖字体/不需造字）

### 学术文献调研 (2007-2008)

厦门大学丁晓君、周昌乐团队（艺术认知与计算实验室）发表：

- **《古琴减字谱的编码与编辑方法》** (2008, 中国音乐学)
  - 提出五部分拆分：上左(指法)/上右(徽位)/下左(装饰)/下右(指法+弦序)
  - 编码方案：`大 * 七 * 六 + 注 * 挑 * 七`（二元运算符+二叉树）
  - 实现：VC++ 6.0 + MFC + Font Creator 造字字库
  - 核心缺陷：仍是桌面字体方案，需逐个造字

- 陈长林 (1989) — 中科院计算所，计算机学报发表《电脑在古琴音乐研究中的初步应用》，最早的研究者

验证结论：我们的 GuqinNote struct (+enum类型系统) 与学术界的二叉树编码方案本质等价，但类型系统更干净，且 CSS 拼装不需要造字。

### 专利调研 (2010-2023)

北大方正专利 **CN102467491B**《古琴减字谱字符的生成方法和装置》：
- 申请日：2010-11-15，**2023-11 因未缴年费终止**
- 技术方案：TrueType 复合字形 (glyf表) 拼装减字，通过元件集合→样字→替换→生成字库
- 覆盖范围：字体层面的字形组合方法（Font Creator/Fontlab 制作）
- **对我们无影响**：CSS 定位拼装与 TrueType 字形渲染是不同技术路线，且专利已过期

后续相关专利（均在保护期内或待评估）：
- **CN113988006A** (2021) — 刘雪锋《一种古琴减字符的数字化、动态生成方法》
- **CN114067319A / CN114067320A** (2021) — 文化艺术出版社《古琴谱字数字轮廓标识》
- **WO2022142107A1** (2022) — 陈根方《一种古琴减字谱的可编辑文本记谱方法》

注意：专利检索仅初步完成，后续需系统排查 FTO（Freedom to Operate）。

## 2026-05-27

### 古体字形替换（齊伋體·明刻本风格）

**目标**：将 SVG 降级渲染的古琴减字谱字形替换为明代木刻版风格的古体路径，提升书法和历史感。

**技术方案**：
- 从 LingDong-/qiji-font v0.0.4（齊伋體，SIL OFL 1.1）提取标准 CJK 字符的 SVG path
- 替换 `svg-paths.ts` 中 22 个条目（左手指法/弦序/徽位/分位/散字头）
- 保留 8 个右手指法外壳（半包围结构）原路径不变

**新增文件**：
- `scripts/extract-ancient-paths.py` — 从齊伋體 TrueType 提取 SVG path，输出 `svg-paths.qiji.ts`
- `scripts/merge-ancient-paths.py` — 将古体 path 合并到 `svg-paths.ts`（只替换 REPLACE_KEYS 中的 22 个条目）
- `apps/web/src/lib/svg-paths.qiji.ts` — 齊伋體完整提取结果（29 entries），作为可复现的记录

**遇到问题**：
1. **Qiji font 下载 404**：GitHub release tag 是 `0.0.4` 而非 `v0.0.4`。纠正 URL 后修复。
2. **merge-ancient-paths.py regex bug 1**：entry 正则 `r'"([^"]+)"\s*:\s*\{'` 丢失 `\s*` 前缀，TS 文件的缩进空格 + 引号导致不匹配。添加 `\s*` 修复。
3. **merge-ancient-paths.py regex bug 2**：bbox 正则 `xMin:\s*(-?\d+)` — 文件实际为 `"xMin": 100`（带引号），加引号后修复。
4. **右手指法外壳不可替换**：字体中的 rh_da/rh_zhai 等是半包围结构（bbox 宽 700+），用于嵌套弦序内核；标准 CJK 字符（bbox ~400-600）是居中紧凑字形，直接替换会丢失嵌套结构。

**验证**：
- Playwright 截图确认古体字形渲染效果
- 对比页面 `/tmp/ancient-compare.png`：新旧字形替换效果
- App 截图 `/tmp/ancient-app.png`：实机渲染泛音组合音符

**PR**：PR #1 → squash merged to main

### 文档更新

- CLAUDE.md：目录结构添加 `scripts/`，素材提取章节更新为双来源说明，"二期 TODO"改为"已完成"
- justfile：新增 `extract-svg-paths` / `extract-ancient-paths` / `merge-ancient-paths` 三个 recipe

### 安全加固与代码重构 (2026-05-27)

全面安全审计 + 代码重构，修复 6 个问题。

**安全修复 (4 项)**:
1. wasm.rs json_error — 字符串拼接 → serde_json::json!，防止特殊字符生成非法 JSON
2. error.rs NotFound — 不再回显 UUID，返回通用 "Not found"
3. routes.rs 请求体限制 — RequestBodyLimitLayer(5MB) + title 长度校验(200字) + Validation 错误变体
4. api.ts 错误处理 — parseErrorMessage() 解析后端 {error} 响应，不再丢弃错误详情

**重构 (3 项)**:
5. routes.rs — 提取 fetch_score() + validate_title()，消除 get/update 重复查询
6. wasm.rs — 提取 deserialize_str/build_hui/ser_result，消除 42 行重复
7. page.tsx handleDeleteScore — 删除后用本地 state 更新，不发起多余 listScores()

**新增依赖**: tower-http(limit feature), tower_governor(速率限制: 2 req/s, burst 60, 仅 main.rs)

**依赖漏洞**: rsa 0.9.10(中危, 暂无修复), postcss <8.5.10(中危, via next)

**验证**: Rust 17/17 + 前端 54/54 测试通过, clippy 零警告, TS 零错误

