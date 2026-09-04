# 太音 (Taiyin) · CLAUDE.md

- **GitHub**: https://github.com/qiaopengjun5162/taiyin-guqin
- **用户**: qiaopengjun5162 (活跃于 Rust/Solana/Web3 生态)

## 项目概览

古琴减字谱数字化工具与传习平台。核心壁垒是手机端减字谱拼装输入法 + AI 简谱转减字。

## 技术栈

- **Rust**: 核心库 (`crates/taiyin-core`) + 后端服务 (`crates/taiyin-server`)
- **Next.js 16 + React 19 + TypeScript**: 前端 (`apps/web`)
- **Tailwind CSS 4 + shadcn/ui**: UI 组件库 + 样式
- **pnpm**: JS 包管理
- **just**: 构建任务管理（`just` 命令代替 `make`）
- **cargo-nextest**: Rust 测试运行器
- **Docker Compose**: 本地开发数据库（PostgreSQL + Redis）

## 目录结构

```
taiyin-guqin/
├── crates/
│   ├── taiyin-core/       # 核心数据结构 + WASM 桥接
│   │   ├── src/wasm.rs    #  ← WASM 导出函数（JSON 桥接）
│   │   └── pkg/           #  ← wasm-pack 构建产物
│   └── taiyin-server/     # Axum 后端 API 服务
├── apps/
│   └── web/               # Next.js 前端
│       ├── src/lib/taiyin-wasm.ts  #  ← WASM 动态加载封装
│       └── wasm/          #  ← WASM 产物部署目录
├── scripts/               # 字体/字形提取工具脚本
│   ├── extract-svg-paths.py       # 从 TaiYinJianZiPuKaiTi.ttf 提取 SVG path
│   ├── extract-ancient-paths.py   # 从齊伋體提取古体字形 SVG path
│   └── merge-ancient-paths.py     # 将古体 path 合并到 svg-paths.ts
├── justfile               # 构建命令
├── docker-compose.yml     # 本地基础服务
└── CLAUDE.md              # 本文件
```

## 常用命令

```bash
# Rust 检查 / 测试
just check          # cargo check
just test           # cargo nextest run
just clippy         # clippy lint

# 前端
just dev            # 启动 Next.js 开发服务器
pnpm --filter web dev

# 完整 CI 前检查
just ci
```

## API 设计规范

- POST `/api/v1/score` - 提交曲谱 JSON
- GET `/api/v1/score/{id}` - 获取曲谱
- POST `/api/v1/translate/select` - LLM 候选择优（未配置密钥时回退启发式）

## Rust 代码规范

- 使用 `thiserror` / `anyhow` 处理错误（参考 rust-template 的 `error.rs` 模式）
- release profile: LTO fat, panic abort, strip symbols
- `cargo fmt` + `cargo clippy -- -D warnings` 是硬性要求

## 前端规范

- 使用 App Router（`app/` 目录）
- shadcn/ui 组件放 `src/components/ui/`
- Tailwind CSS 4 使用 `@theme inline` 定义主题变量

---

# 可核验策略（Policy）

每条策略应当让 Agent 能明确回答"这笔操作是否越界"。

## WASM 桥接架构

- **策略**: JSON 字符串输入/输出桥接。所有 `#[wasm_bindgen]` 函数接收和返回 `String`，内部使用 `serde_json` 做 Rust ⇄ JSON 转换。避免将 Rust 复杂枚举直接映射到 JS 类型。
- **动态加载**: Next.js SSR 下 WASM 不可用，前端通过 `src/lib/taiyin-wasm.ts` 封装动态 `import()`。首次调用时自动初始化，后续复用缓存实例。验证方法：`taiyin-wasm.ts` 中的 `instance` 变量和 `getWasm()` 的懒加载逻辑。
- **构建流程**: `just build-wasm` 执行 `wasm-pack build --target web` 并将 `pkg/` 产物复制到 `apps/web/wasm/`。
- **路径别名**: TypeScript + vitest 都配置了 `@/wasm/* → ./wasm/*` 别名，前端代码通过 `@/wasm/taiyin_core` 导入 WASM 模块。
- **条件编译**: `wasm.rs` 使用 `#[cfg(target_arch = "wasm32")]` 条件编译，不影响 native 编译（server binary、cargo test）。
- **版本锁定**: `wasm-bindgen = "=0.2.100"` 精确锁定版本。wasm-pack 需要与 Cargo.toml 中的 wasm-bindgen 版本匹配，否则 `clone_ref` 等 CLI 后处理会失败。

## 减字渲染架构

- **纯字体 GSUB 连字方案**: 忘机减字谱楷体是 OpenType GSUB 连字引擎，26 个 lookup + 227 个 GPOS lookup。输入完整字符串（如"散勾五"），字体自动完成传统半包围嵌套排版。
- **渲染入口**: `JianziBlock` (`src/components/jianzi-block.tsx`) 是唯一渲染入口，接收 `JianziState + fontSize + compact`，通过 `jianziToText()` 序列化为字符串后写入 `<span>`，CSS 开启 `font-variant-ligatures: common-ligatures` 和 `font-feature-settings: "liga" on, "clig" on`。
- **`jianziToText` 翻译层** (`src/lib/types.ts`): 键盘偏旁（勹/木/乚/乇/丁/尸/倽）需映射为字体 GSUB 可识别的全字符（勾/抹/挑/托/打/擘/摘），否则字体 cmap 找不到对应字形。
- **泛音空格阻断**: 泛音在 "泛" 后加空格（"泛 名十勾三"）断开 GSUB 上下文链，防止字体把音色标记和后续指法吞入同一条连字规则。
- **连续同音省略（compact）**: 所有音色（散/泛/按）都参与 compact。连续两条 `toneType` 相同（且非 null）时隐藏音色标记。验证方法：读取 `ScoreView.map` 中的 `sameTone` 条件。
- **状态保留（方案 B）**: `handleConfirm` 中提交后只保留 `toneType` 和 `rhythmMode`，清空 `leftFinger/hui/fen/rightAction/stringNumber`。验证方法：读取 `JianzipuKeyboard.handleConfirm` 中的 `setState` 调用。
- **SVG 降级条件**: `needsSvg()` 返回 true 时使用 `SvgJianziBlock`。触发条件为 `toneType === "泛"` 或 `rightAction in ["打", "摘", "丁", "倽"]`。验证方法：读取 `jianzi-block.tsx` 的 `needsSvg` 函数。
- **GlyphSVG 坐标系**: `svg-jianzi-block.tsx` 的 `GlyphSVG` 组件必须做 `scale(1, -1)` y 翻转，因为字体提取的 path 使用 font coordinate space（y 向上），而 SVG viewBox 原点在左上（y 向下）。

## 撤销/重做

- **历史栈**: `useScoreHistory` 维护三段式状态（past / present / future），最大深度 50。
- **快照内容**: 每次 `commitScore` / `commitTitle` 同时记录当前 `score` 和 `title`；撤销/重做时两者一并恢复。
- **提交点**: 仅在用户完成有意义操作时写入历史——追加/替换音符、删除音符、加载曲谱、标题输入失焦。直接 `setScore`/`setTitle` 不写入历史。
- **去重**: 若新快照与当前 present 完全相同（含 JSON 序列化比较），不写入历史。
- **快捷键**: 全局监听 `Ctrl+Z` / `Cmd+Z` 撤销，`Ctrl+Shift+Z` / `Cmd+Shift+Z` / `Ctrl+Y` / `Cmd+Y` 重做；在文本输入框内不拦截。
- **验证方法**: `use-score-history.test.ts` 覆盖撤销/重做/深度限制/标题历史；`save-load-toolbar.test.tsx` 覆盖按钮禁用态与点击回调。

## 简谱转减字

- **规则映射**: 基于音高表将简谱数字映射到候选 `GuqinNote`，支持散音、泛音、按音候选。
- **输入模式**: 支持单音输入与序列输入。`JianpuTranslator` 提供「单音/序列」切换；序列模式可解析如 `5 6 1 2 | 3 5 6 -` 的字符串，批量生成候选。
- **多调式**: `Tuning` 枚举支持正调（`zheng`）/蕤宾调（`ruibin`，紧五弦）/慢角调（`manjiao`，慢三弦），散音以 1=F 简谱数字表示。`pitch_table(tuning)` 由散音经级数偏移 `[0,2,3,4,7,9,10,11,12]` 推导泛音行；`test_derived_table_matches_zheng_diao_const` 保证正调推导与 `ZHENG_DIAO_PITCHES` 常量表逐格一致。NoteColumn 不记录调式。
- **按音生成**: 基于弦长比例计算徽位/分位音高，枚举 1–11 徽及 3/5/6/8 分位，按徽位、弦序、指法评分；左手手指按徽位区间自动分配（1–4 大，5–7 食，8–10 名，11+ 跪）。
- **候选排序**: 散音（score=150）优先于泛音（最高 130），泛音优先于按音（基础 100）；泛音按徽位越低分越高（`130 - hui * 2`），按音按低徽位、常用弦加分，跪指减分。序列模式下，还会根据前一个已选候选的弦序与徽位位置对当前候选做上下文加分，优先同弦/相邻弦、近距离位置，使演奏更连贯。
- **WASM 接口**: `translate_jianpu_to_jianzi` 接收 `{"number", "octave", "tuning"?}` JSON 字符串（tuning 默认 `zheng`），返回 `{"candidates": [...]}`；`translate_jianpu_sequence_to_jianzi` 接收 `{"notes": [...], "tuning"?}`，返回 `{"candidates_per_note": [...]}`，符合现有 JSON 桥接策略。
- **前端入口**: `JianpuTranslator` 组件位于键盘卡片内（仅在非编辑模式显示）。序列模式下每音展示候选列表，默认选中 top1，用户可逐音切换后批量确认。切换调式会作废旧候选（`candTuning`/`notesTuning` 派生态比对），隐藏确认按钮并提示重新翻译。
- **时值解析**: 序列输入支持延音线 `-`（+1 拍，可跨小节）、减时线 `_`/`__`（八分/十六分）、附点 `.`（×1.5）；三拍映射为附点二分。解析器以三十二分音符为单位做整数拍数运算，无法精确映射的延音线被忽略。批量确认时回填 `NoteColumn.duration` / `jianpuDot`。`0` 解析为休止符（`ParsedJianpuRest`），确认时插入 `jianpuNumber: "0"` + 空减字的 `NoteColumn`，休止拍参与小节线计数。
- **类型映射**: WASM 序列化契约不对称——`note_type` 为中文枚举值（散/泛/按，直接可用），`left_finger`/`right_action` 为 Rust 枚举名（`Da`/`Tiao` 等，需映射为显示字符 大/乚）。前端测试 mock 必须与此契约一致。验证方法：`just verify-wasm`（`scripts/verify-wasm.mjs`，直接加载真实 WASM 产物校验序列化值与调式效果，不经 mock）。
- **LLM 择优**: `POST /api/v1/translate/select`（`crates/taiyin-server/src/llm.rs`）将调式+简谱+候选减字文本交 Anthropic Messages API 选择；`ANTHROPIC_API_KEY` 未配置或调用失败时回退启发式 top1，响应 `method` 字段标识 `"llm"`/`"heuristic"`。前端序列模式「AI 优选」按钮应用选择（note_index 映射回含休止符位置）。
- **非目标**: 曲谱级调式持久化、按音徽分调式微调。
- **验证方法**: Rust 测试覆盖音高表、单音/序列候选生成与排序、按音音高计算、上下文位置优化；前端测试覆盖单音选择回填、序列输入与批量确认、按音候选渲染。测试总数：Rust 45 + 前端 135 = **180**。

## 示例曲谱

- **数据来源**: `apps/web/src/lib/example-scores.ts` 预置短片段（如《沧海一声笑》《仙翁操》《泛音练习》），用于降低新用户首次使用门槛。
- **加载入口**: `SaveLoadToolbar` 提供「示例」下拉选择；选择后 `page.tsx` 通过 `commitScore` / `commitScoreTitle` 加载到乐谱流。
- **空状态引导**: 乐谱流为空时显示提示文字，引导用户使用「简谱转减字」或加载示例。
- **验证方法**: `example-scores.test.ts` 验证每个示例非空且所有音符的 `jianzi` 满足 `isComplete`；`save-load-toolbar.test.tsx` 验证示例下拉渲染与回调。

## 节奏可视化

- **拍号状态**: `page.tsx` 维护全局 `beatsPerBar`（默认 4），通过 select 切换 3/4、4/4、6/8，传给 `ScoreView`。
- **时值转拍数**: `apps/web/src/lib/types.ts` 中 `durationToBeats()` 将 `Duration` 映射为以四分音符为 1 拍的拍数（全=4、二分=2、四分=1、八分=0.5、十六分=0.25），可选 `dotted` 参数应用附点 ×1.5。
- **小节线渲染**: `ScoreView` 累加每个音符的拍数，跨小节边界时插入 `BarLine` 竖直分隔符；最后一小节末尾不画线。
- **非目标**: 散板/宕板特殊视觉、持久化拍号到后端。（注：旋律播放与节拍器均已实现并接入 UI。）
- **验证方法**: `types.test.ts` 测试 `durationToBeats`；`score-view.test.tsx` 测试不同拍号与混合时值下的小节线位置。测试总数：Rust 45 + 前端 135 = **180**。

## 乐谱导出

- **PNG 导出**: `useExportImage` + `SaveLoadToolbar.onExportPng`（按钮「导出」），截图 `#score-area` 区域。
- **文本导出**: `apps/web/src/lib/score-export.ts` 的 `formatScoreAsText()` 生成两行对照谱（上简谱、下减字），小节分隔逻辑与 `ScoreView` 一致；`downloadTextFile()` 经 Blob 触发下载。入口为 `SaveLoadToolbar.onExportText`（按钮「导出文本」），`page.tsx` 按当前 `beatsPerBar` 导出 `.txt`。
- **验证方法**: `score-export.test.ts` 覆盖标题/小节线/八度标记/下载触发；`save-load-toolbar.test.tsx` 覆盖两个导出按钮。测试总数：Rust 45 + 前端 135 = **180**。

## 旋律播放

- **纯逻辑层**: `apps/web/src/lib/player.ts` —— `jianpuToFrequency`（简谱 1 = C4 (MIDI 60)，与 Rust `midi_note` 一致的相对音高约定）、`buildSchedule`（时值+附点 → 秒级调度）。休止符（`"0"`）与无简谱标注的音 `freq: null` 静默但占位时值。
- **合成**: `useScorePlayer` 用 Karplus-Strong 拨弦模型（噪声脉冲 + 阻尼低通反馈延迟），整首一次性调度到 AudioContext，`stop` 断开全部 source，组件卸载时 `close()`。
- **入口**: `page.tsx` 拍号旁「播放/停止」按钮，空谱禁用。`playingIndex` 逐音高亮传入 `ScoreView`，播放列绿色高亮优先于编辑高亮；高亮定时器与音频共用起点 t0 的墙上时钟偏移，`stop` 时全部清除。
- **非目标**: 节拍器、逐音高亮、真实采样、无简谱音的减字反推。
- **验证方法**: `player.test.ts` 纯逻辑测试；`use-score-player.test.ts` 用 FakeAudioContext 验证发声数与停止行为。测试总数：Rust 45 + 前端 135 = **180**。

## 乐谱流数据流

数据流拓扑：

```
ScoreView（展示）              JianzipuKeyboard（编辑）
    │  onEdit(index)                ↑ defaultNote (回填)
    │  onRemove(id)                 │ onAppend (追加/替换)
    └────→  page.tsx ──────────────┘
            ↑
        editingIndex: number | null
```

### 编辑模式规则

1. **进入编辑**: 点击音符列 → `editingIndex = index` → `key` 变化强制键盘 remount → `defaultNote` 填充键盘所有 `useState`。验证方法：`page.tsx` 的 `handleEdit + key={editingIndex ?? "default"} + defaultNote` 三者配合。
2. **确认编辑**: `editingIndex !== null` 时 `handleAppend` 替换 `score[editingIndex]` 而非追加。同时保留原始 NoteColumn 的 `id`（`defaultNote?.id ?? crypto.randomUUID()`），避免 `key={note.id}` 变化导致 React 卸载/重挂。验证方法：`setScore` 中的 `if (editingIndex !== null)` 分支 + `handleConfirm`/pinyin `onSubmit` 中的 `defaultNote?.id`。
3. **取消编辑**: 编辑模式下必须提供"取消编辑"按钮，退出编辑且不清除音符。验证方法：`page.tsx` 中有 `onClick={() => setEditingIndex(null)}`。
4. **删除冲突**: 删除正在编辑的音符时必须清除 `editingIndex`。验证方法：`handleRemove` 中 `removedIdx === editingIndex` 条件。
5. **重置按钮**: `handleReset` 在编辑模式（有 `defaultNote`）时恢复原始音符值，追加模式时清空为默认值。同时重置 `activeTab` 到 `"finger"`、`pinyinText` 到对应 jianzi 文本（编辑模式）或空字符串（追加模式）。验证方法：`handleReset` 中的 `defaultNote ? ... : ...` 三元分支 + `setActiveTab("finger")` + `setPinyinText(...)`。
6. **高亮反馈**: `editingIndex` 必须传入 `ScoreView`，编辑中的音符列显示 `ring-1 ring-amber-500/40 bg-amber-50`。验证方法：`ScoreView` 的 `props` 和 `NoteColumnView` 的 `isEditing` 条件渲染。

### 键盘状态管理

- 键盘所有 `useState` 使用 init function（`useState(() => ...)`），不是直接初始值。原因：依靠父组件 `key` 属性变化触发 remount 来重新初始化。
- `defaultNote` 为 `undefined` 时键盘表现正常（追加模式），不依赖 `useEffect` 做数据同步。

## 后端数据持久化（v0.2.0）

- **数据库**: PostgreSQL 17，默认连接 `postgres://taiyin:taiyin_dev@localhost:5432/taiyin`
- **ORM**: `sqlx` 0.8（异步、JSONB 支持）
- **迁移**: `sqlx::migrate::Migrator` 在服务器启动时自动运行 `crates/taiyin-server/migrations/`

### 数据模型

```sql
CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL DEFAULT '未命名曲谱',
    notes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`notes` 列以 JSONB 存储前端 `NoteColumn[]` 格式。

### API 端点

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/v1/scores` | 创建曲谱（body: `{title?, notes}`） |
| GET | `/api/v1/scores` | 列表（不含 notes） |
| GET | `/api/v1/scores/{id}` | 获取单个（含完整 notes） |
| PUT | `/api/v1/scores/{id}` | 更新（body: `{title?, notes?}`） |
| DELETE | `/api/v1/scores/{id}` | 删除 |

### 服务端安全配置（v0.3）

- **CORS**：由 `ALLOWED_ORIGINS`（逗号分隔）控制允许来源。留空 = 开发态放开（仅本地）。
  生产部署**必须**设置，否则任何站点都能嵌入你的 API。
- **限流**：`tower_governor` 按客户端 IP 计。全局 `GLOBAL_RATE_PER_SECOND` / `GLOBAL_RATE_BURST`
  （默认 2/s、burst 60）；`/translate/select` 额外使用更严格的
  `TRANSLATE_RATE_PER_SECOND` / `TRANSLATE_RATE_BURST`（默认 1/s、burst 5），因该端点直接消耗
  服务端 Anthropic 额度。反向代理部署时读取 `X-Forwarded-For` / `X-Real-IP` 头做 per-IP 限流，
  回退到 TCP peer IP。
- **API-key 闸门（纵深防御）**：设置 `TRANSLATE_API_KEY` 后，`/translate/select` 要求携带
  `Authorization: Bearer <key>` 或 `x-api-key: <key>`。注意：该 key 会出现在前端 JS 包
  （`NEXT_PUBLIC_TRANSLATE_API_KEY`），故仅阻止跨站/自动化滥用，**不是真正的用户鉴权**。
  真正的用户级鉴权需要账号体系，列为后续迭代。
- **设计取舍**：`/scores` 写操作当前 intentionally 开放（社区 UGC，无成本敞口）；
  `/translate/select` 是唯一的成本敞口，因此重点防护它。

### taiyin-server 模块结构

```
src/
├── main.rs          # 入口：初始化 DB pool + 启动 Axum
├── lib.rs           # crate 根：导出 AppState + app()
├── db.rs            # AppState + init_pool（自动迁移）
├── error.rs         # AppError（thiserror）→ IntoResponse
├── models.rs        # Score / CreateScoreRequest / UpdateScoreRequest
├── llm.rs           # LLM 候选择优（Anthropic Messages API + 启发式回退）
└── routes.rs        # API 路由 + handler 函数
```

### 测试策略

- 数据逻辑用纯函数测试，无需 React 渲染环境。
- 组件用 `@testing-library/react` 测试渲染和交互。
- 后端集成测试需要运行中的 PostgreSQL。
- 测试文件位置：`src/components/__tests__/`、`src/lib/__tests__/`、`crates/taiyin-server/tests/`。
- `JianziState` 测试构造统一用 `make(overrides: Partial<JianziState>)` 辅助函数。
- 当前测试总数：Rust 45 + 前端 135 = **180**。

## 一期 · 渐进式混合渲染引擎（feat/svg-engine）

### 架构

```
输入数据（如"散勾五"）
        │
        ▼
第一层 FontJianziBlock ─── GSUB 字体连字（80% 常用字）
        │
        └── 触发降级条件 ──→ 第二层 SvgJianziBlock
                              (泛音 | 打/摘等生僻组合)
```

### SVG 积木库命名规范

| 层级 | 命名模式 | 示例 |
|------|----------|------|
| 帽子层 | `top_*.svg` | `top_san.svg` (艹), `top_fan.svg` (⺍) |
| 左手指法 | `lh_*.svg` | `lh_da.svg` (大), `lh_ming.svg` (夕/名), `lh_zhong.svg` (中), `lh_shi.svg` (亻/食), `lh_gui.svg` (跪) |
| 徽位 | `hui_*.svg` | `hui_1.svg` ~ `hui_13.svg` |
| 分位 | `fen_*.svg` | `fen_1.svg` ~ `fen_9.svg` |
| 右手外壳 | `rh_*.svg` | `rh_gou.svg` (勹), `rh_mo.svg` (木), `rh_tiao.svg` (乚), `rh_tuo.svg` (乇), `rh_da.svg` (丁), `rh_zhai.svg` (倽), `rh_ti.svg` (剔) |
| 弦序内核 | `str_*.svg` | `str_1.svg` ~ `str_7.svg` |

### 素材提取

`svg-paths.ts` 中的 SVG path 来自两个来源：

1. **TaiYinJianZiPuKaiTi**（当前字体）→ 右手指法外壳（半包围结构）+ 复合连字
   - 脚本：`scripts/extract-svg-paths.py`
   - 内部 glyph 命名映射：`rh_da → lg_da`、`rh_gou → lg_gou` 等

2. **齊伋體**（明代木刻版风格, SIL OFL 1.1）→ 标准 CJK 字符（左手指法/弦序/徽位/分位/散字头）
   - 脚本：`scripts/extract-ancient-paths.py` → 输出 `svg-paths.qiji.ts`
   - `scripts/merge-ancient-paths.py` → 合并到 `svg-paths.ts`
   - 替换条目见 `REPLACE_KEYS`（22 个标准字符）

输出为 `apps/web/src/lib/svg-paths.ts`（`<path d="..." />` 字符串字典）。
右手外壳需是中空的半包围结构，弦序内核通过 CSS `absolute` 嵌入。

### 架构注意事项

- **指法语义时代分流**（管平湖 1957）：相同符号在不同时代谱式中语义可能相反。例如 "女" 在《广陵散》（早期谱）中作"按"（左手），在《自远堂》（晚期谱）中作"如"（右手双弹）。`JianziState` 未来需预留 `era: 'Early' | 'Late'` 模态字段，用于指法解析分流。
- **古体字形已整合**：22 个标准 CJK 字符的 SVG path 已替换为來自齊伋體（明代木刻版风格）的古体字形。右手指法外壳（半包围结构）保持当前字体路径不变，因其结构不适合用标准 CJK 字符替换。

## 忘机减字谱楷体（TaiYinJianZiPuKaiTi）

- 原始字体 `WangJiJianZiPuKaiTi1.1.ttf` (1.2MB) —— 含 DRM 广告 glyph（名为 `placeholder`，面积 580 万像素，映射到 10 万+ Unicode 码位）
- 清理后字体 `TaiYinJianZiPuKaiTi.ttf` —— 所有 name table 条目已改名，placeholder glyph 清空，码位重映射到 .notdef
- GSUB: 26 lookups（ContextSubst/ChainContextSubst/LigatureSubst/SingleSubst），GPOS: 227 lookups
- 字体本质是 GSUB 连字引擎，不支持拆开独立渲染

## 代理设置

外部访问（如安装 pnpm 依赖时）使用代理：
```bash
export http_proxy=http://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890
```

## 工程规范

面向团队与 AI 协作者的统一约定，确保代码质量可被持续把控。

### pre-commit 机制（唯一）
- 统一使用 **git native hook + `just`**，不使用 python 的 pre-commit 框架（原 `.pre-commit-config.yaml` 因 `core.hooksPath=.githooks` 永不生效，已删除）。
- 启用：`just setup-hooks`。
- 提交时自动执行 `just precommit`：fmt + clippy(`-D warnings`) + 单元(`--lib`) + 前端测试。
- 需要 `DATABASE_URL` 的后端集成测试交给 CI（build.yml 的 postgres 服务）；本地用 `just ci` 跑全量（需先 `just docker-up`）。

### Definition of Done
- CI 全绿（build.yml `rust` + `web`）。
- 至少 1 approval；`crates/taiyin-core/` 与后端安全文件（`auth.rs`/`config.rs`/`main.rs`/`routes.rs`）需 `.github/CODEOWNERS` 指定 reviewer 批准。
- 提交信息符合 Conventional Commits；用户可见变更同步文档。

### Code Review 重点
- 测试覆盖（边界 + 错误路径）、公开契约兼容性、安全（密钥不进前端 / 日志）、性能回归。
- 涉及领域不变量（如 `Hui`/`StringNumber` newtype）、CORS / 限流、数据库迁移时，必须在 PR 描述中说明。

### 安全变更约束
- 任何端点改动不得把服务端密钥（`ANTHROPIC_API_KEY` 等）暴露给前端；前端只可持有 `TRANSLATE_API_KEY` 这类非机密的闸门 key（详见「服务端安全配置」）。
- CORS 仅放行 `ALLOWED_ORIGINS` 已知来源，禁止 `CorsLayer::permissive()`。
- 昂贵 LLM 端点必须叠加 per-IP 限流（`SmartIpKeyExtractor`）。
