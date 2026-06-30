# 开发日志 (Development Log)

## 2026-06-30

### 撤销/重做 + 编辑器快捷键

- 新增 `useScoreHistory` hook（`apps/web/src/lib/use-score-history.ts`），三段式历史栈（past/present/future），最大深度 50，同时记录 score 和 title。
- 在 `page.tsx` 中替换原 `useState(score)` / `useState(title)`，所有写入操作通过 `commitScore` / `commitTitle` 进入历史。
- 添加全局键盘监听：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 与 Ctrl/Cmd+Y 重做；在 input/textarea/contenteditable 内不拦截。
- 在 `SaveLoadToolbar` 添加撤销/重做按钮，禁用态与快捷键提示。
- 新增 15 个前端测试：7 个 `use-score-history` 测试 + 8 个 `save-load-toolbar` 测试。
- 当前测试总数：Rust 17 + 前端 69 = 86。

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
