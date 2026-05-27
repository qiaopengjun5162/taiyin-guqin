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
- POST `/api/v1/translate` - 简谱转减字（AI 翻译）

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

### taiyin-server 模块结构

```
src/
├── main.rs          # 入口：初始化 DB pool + 启动 Axum
├── lib.rs           # crate 根：导出 AppState + app()
├── db.rs            # AppState + init_pool（自动迁移）
├── error.rs         # AppError（thiserror）→ IntoResponse
├── models.rs        # Score / CreateScoreRequest / UpdateScoreRequest
└── routes.rs        # API 路由 + handler 函数
```

### 测试策略

- 数据逻辑用纯函数测试，无需 React 渲染环境。
- 组件用 `@testing-library/react` 测试渲染和交互。
- 后端集成测试需要运行中的 PostgreSQL。
- 测试文件位置：`src/components/__tests__/`、`src/lib/__tests__/`、`crates/taiyin-server/tests/`。
- `JianziState` 测试构造统一用 `make(overrides: Partial<JianziState>)` 辅助函数。
- 当前测试总数：Rust 17 + 前端 54 = **71**。

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
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897
```
