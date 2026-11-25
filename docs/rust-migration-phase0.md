# 阶段 0 · 前端逻辑归位 Rust 迁移清单

> 状态：**批 0~4 已执行完毕**（11-19）。阶段 0 的盘点与拍板结论保留原文，实际落地情况见文末
> 「10. 执行结果」。本文是内部工程清单，不是产品定位文档（定位仍以 `docs/overview.md` 为准）。
> 盘点日期：2026-11-15，更新至 11-19。盘点时约定的约束（不改产品行为、不动线上、不改覆盖率阈值）在执行期保持。
> 数据口径：`node scripts/measure-codebase.mjs` + 本次对 `apps/web/src` 的 import 去重扫描；用例数按 `it(` / `test(` 行首统计。

---

## 0. 一句话

项目不是「TypeScript 写的、要换 Rust」，而是**脑子已经是 Rust、脸还是 JS**。真正值得搬的是前端约 5,000 行纯计算，以及由此产生的四组重复口径；连界面一起换 Rust 的代价远大于收益，本轮不做。

---

## 1. 盘点基线

> **本节是 2026-11-15 的快照，刻意不改**——它是「动手前长什么样」的证据，
> 改了就看不出迁移规模了。**现状以第 10 节为准**。已知会过时的两项：
> WASM 导出 9 → **26**（六个模块迁入后），`taiyin-core` 测试属性 109 → **247**。

| 指标 | 数值 | 来源 |
| --- | --- | --- |
| 仓库总行数 | 59,127 | `scripts/measure-codebase.mjs` |
| Rust 行数（含测试） | 16,531 | `crates/` 全部 `.rs` |
| 前端行数 | 42,596 | `apps/web/src` 全部 `.ts/.tsx` |
| 前端非测试 / 测试 | 约 21,500 / 约 20,600 | lib 9,995 + 组件 8,909 + 页面 2,622 / 三类测试合计 |
| `taiyin-core` 源码 / 测试属性 | 6,107 行 / 109 个 | `jianpu.rs` 46、`jianzi_code.rs` 26、`lib.rs` 16、`jianzi_dictionary.rs` 13、`jianzi_stats.rs` 8 |
| WASM 导出函数 | 9 个 | `crates/taiyin-core/src/wasm.rs` |
| 待迁纯计算 | 约 3,700 行（16 个纯文件）+ 约 1,300 行（混合文件里的纯函数） | 见 3.1 |
| 相关前端单测 | 本次盘点的 28 个文件、**576 个用例** | `apps/web/src/lib/__tests__/` |
| 覆盖率闸门 | 行 94 / 语句 91 / 分支 84 / 函数 92 | `apps/web/vitest.config.ts:30-33`，不许调 |

前端 `lib/` 顶层非测试 `.ts` 共 51 个，另有 `generated/` 下 12 个 ts-rs 产物、`__tests__/` 下 52 个测试文件。

---

## 2. 头号待拍板：同步函数怎么过 WASM 这道桥

**事实**：`apps/web/src/lib/taiyin-wasm.ts` 的 9 个导出全部是 `async`（`getWasm()` 返回 Promise，动态 `import()` + 单例状态机）。现有 WASM 调用都发生在事件处理、面板加载、导出这类**本来就能等**的地方。

**冲突**：待迁的纯函数绝大多数是**同步渲染热路径**——`jianziToText`（42 处引用）、`dragDuration`（拖拽时逐帧）、`groupIntoBars` / `equalBarWidth`（谱面排版）、`jianziToFrequency`（点听）。若照现状照搬，异步会传染进 JSX 渲染，需要给整页加 loading 态与空态，等于把刚收口的界面与 85 个测试文件再推一遍。

| 方案 | 做法 | 得到 | 代价 |
| --- | --- | --- | --- |
| **S3 构建期生成（11-16 复核后降级）** | 扩 `crates/taiyin-core/src/bin/gen_types.rs`（或另加一个 bin），把常量表 / 枚举由 Rust 生成 TS 常量文件，运行时不调 WASM。注意：该 bin 目前只用 ts-rs 导**类型**（`export_all()`），生成常量值需要新增输出逻辑 | 四组重复口径一次性收敛，零行为变化，零异步问题 | **复核后收益有限**：ts-rs 已生成的 12 个类型与前端 `types.ts` 只有 `NoteType` 真重复（其余是英文枚举变体 vs 汉字谱式，本来就分两层）；定弦 6 种带中文名与提示文案，搬进 Rust 等于把 UI 文案塞进核心 crate。且改 `src/bin/gen_types.rs` 仍属 `crates/taiyin-core/src/**`，要跑 WASM 重建 |
| **S1 只迁异步链路** | 仅搬本来就在 `await` 后面的逻辑（批量编解码、字典、导出、统计面板） | 小步、可回滚、不动启动流程 | `jianzi.ts` 这类渲染热路径仍留 TS，口径重复只能部分消除 |
| **S2 启动预加载 + 同步 getter** | 应用启动时一次性加载 WASM，之后所有纯函数同步调用；改 `taiyin-wasm.ts` 签名与根组件启动流程 | 真正「业务规则全 Rust」，覆盖面最大 | 一次性改 13 个引用文件、37 个 wasm 相关用例；首屏要等加载或给降级（实测 4~5 ms）；SSR / 静态导出兼容性**已实测通过** |

**S2 实测（2026-11-15）**：拿现有 `apps/web/wasm` 产物在 Node 里验证过——wasm-pack 生成的 glue **确实导出了 `initSync`**；`initSync({ module: await WebAssembly.compile(bytes) })` 可以同步初始化，之后 9 个导出函数全部能同步调用（传裸 `Module` 也行，但会打废弃警告）。所以 **S2 技术可行**，剩下的成本是「一次异步取字节 + 编译」放进启动流程，加上改 `taiyin-wasm.ts` 签名、13 个引用文件、37 个用例、首屏等待 / 降级、SSR 与静态导出重验（静态导出部分已于 11-16 补验通过，见下）。P-1 因此从「能不能做」变成「值不值得现在做」。

**S2 实测（2026-11-16，真实 Chromium + 静态导出产物）**：新增 `scripts/probe-wasm-sync-browser.mjs`（本地入口 `just probe-wasm-sync`）。脚本把 `apps/web/dist/` 按 basePath `/taiyin-guqin` 映射到临时 HTTP 服务，在真实 Chromium 里 `import()` glue → `fetch` wasm → `WebAssembly.compile` → `initSync({ module })`，再逐个同步调用 9 个导出。结果 **PASS**：glue 14,812 B / wasm 235,302 B / 9 个导出全部返回字符串且**非 Promise**（输入换成合法业务 JSON 后无一条 `{"error":...}` 兜底）；首屏同步初始化成本为 **fetch + compile + initSync ≈ 4~5 ms**（脚本内 3 轮取均值，多次运行落在 3.9~4.7 ms），`compileStreaming(fetch)` 全程约 2 ms，9 个业务函数同步调用合计约 3~4 ms，页面无 console error。即「首屏要等加载」这个代价只有几毫秒，**静态导出链路不构成 S2 的阻碍**；剩余成本是启动流程改造、13 个引用文件、37 个用例与降级策略。

**S3 复核（2026-11-16）**：逐文件对照 `apps/web/src/lib/generated/*.ts` 与 `types.ts`，12 个生成类型里只有 `NoteType`（散/泛/按）与前端手写类型完全一致；`RhythmMode` / `Ornament` / `RightAction` 等是英文枚举变体，而前端用的是汉字谱式与字形联合，是两层不同语义，不能互相替代。定弦那组也不是四份拷贝：Rust `jianpu.rs` 只建模 3 种调式，前端 `TUNINGS` 有 6 种并带 `name` / `alias` / `hint` 中文 UI 文案。故「Rust 生成 TS 常量」要先把 UI 文案搬进核心 crate，改动面远大于收益。

**建议组合（11-16 订正）**：~~S3 先做（批 0）~~ → **S1 小步验证（批 1~2）→ S2 单独立项**。S3 不再作为打底项，并入阶段 3 桥接自动化顺带处理；批 0 改由「四组跨语言静态闸门 + 半音表单一来源」销项。**S 方案未拍板前，不启动任何运行时迁移。**

---

## 3. 分诊结果

### 3.1 可迁（纯计算，按产品引用数从低到高）

「产品引用 / 现有用例」来自本次扫描，行数来自 `wc -l`。

| 模块 | 行 | 产品引用 | 用例 | 主要纯逻辑 | 重复口径 |
| --- | --- | --- | --- | --- | --- |
| `metronome.ts` | 32 | 1 | 5 | `isDownbeat` / `nextClick` / `advanceBeat` | 时值 |
| `duration-drag.ts` | 97 | 1 | 13 | `DURATION_LADDER` / `stepDuration` / `dragDuration` | 时值 |
| `score-bars.ts` | 110 | 1 | 15 | `groupIntoBars` / `equalBarWidth` | 时值 |
| `qin-board.ts` | 225 | 1 | 16 | `BOARD_STRINGS` / `boardDots` / `freqToMidi` | 徽位音高 |
| `qin-fingering.ts` | 123 | 1 | 18 | `buildQinFingering` / `HUI_TICKS` | 徽位 |
| `pinyin-dict.ts` | 108 | 1 | 9 | `lookupPinyin` / `pinyinToJianpu` | 无（静态表） |
| `score-concordance.ts` | 150 | 1 | 16 | `jianziSignature` / `findConcordance` | 字形归一化 |
| `unsaved-guard.ts` | 60 | 1 | 11 | `scoreFingerprint` | 无 |
| `audio-export.ts` | 143 | 1 | 13 | `audioBufferToWav`（WAV 字节编码） | 无 |
| `score-export.ts` | 150 | 1 | 18 | `formatScoreAsText` / `DURATION_CODE` | **时值→减字码** |
| `midi-export.ts` | 221 | 1 | 20 | `scoreToMidi`（MIDI 字节编码） | 无 |
| `play-along.ts` | 382 | 1 | 25 | `segmentNotes` / `centsBetween` / `judgeTake` | 音高 |
| `jianpu-parser.ts` | 189 | 2 | 22 | `parseJianpuString` / `noteUnits` | 时值 |
| `jianzi-rapid.ts` | 450 | 2 | 49 | `TONE_TOKENS` / `parseRapidInput` / `normalizeRapidInput` | **减字码表** |
| `lianmei.ts` | 259 | 2 | 21 | `LIANMEI_OPTIONS` / `lianmeiGroups` / `linkLianmei` | 无 |
| `jianzi-sheet-segment.ts` | 171 | 1 | 5 | `segmentSheet` / `recognizeSheetCells` | 图像算法（见 3.3） |
| `score-layout.ts` | 184 | 2 | 11 | 常量表（后半是 localStorage） | 无 |
| `score-phrases.ts` | 180 | 4 | 14 | `phraseKey` / `phraseSeconds` | **已是正面范式：句界问 WASM** |
| `practice-progress.ts` | 189 | 4 | 18 | `TEMPO_LADDER` / `isCleared` / `nextTempo` | 无 |
| `practice-log.ts` | 416 | 3 | 23 | `weekRange` / `summarize` / `streakDays` / `formatDuration` | 无 |
| `pitch-detect.ts` | 141 | 2 | 9 | `detectPitch` / `toneBuffer`（纯算法） | 音高 |
| `player.ts` | 174 | 5 | 24 | `jianpuToMidi` / `buildSchedule` | 音高时值 |
| `jianzi-explain.ts` | 566 | 6 | 33 | 释义查表 / `describeHuiPosition` | 徽位、指法枚举 |
| `jianzi-pitch.ts` | 203 | 9 | 24 | `huiHarmonic` / `jianziToFrequency` | **徽位音高表** |
| `concert-pitch.ts` | 74 | 9 | 11 | `clampConcertPitch` | 基准音 |
| `tuning.ts` | 219 | 19 | 25 | `TUNINGS` / `openStringFrequency` / `centsFrom` | **定弦（4 份）** |
| `jianzi.ts` | 454 | 19 | 66 | `jianziToText` / `parseJianziText` / `fenToGlyph` / `durationToBeats` | **减字记号、时值** |

`taiyin-wasm.ts`（512 行、8 处产品引用、37 用例）是桥接层，不迁，反而是阶段 3 的改造对象。

### 3.2 不迁（强绑浏览器 API）

`api.ts`(653)、`recorder.ts`(272)、`custom-jianzi.ts`(269)、`local-score-store.ts`(174)、`audio-synth.ts`(167)、`settings.ts`(143)、`auth.ts`(137)、`owner-token.ts`(122)、`draft-store.ts`(111)、`jianzi-image.ts`(70)、`share-link.ts`(48)，以及 4 个 React hook（`use-score-player` / `use-score-history` / `use-metronome` / `use-note-preview` / `use-export-image`）。

理由：`fetch`、`MediaRecorder`、`BaseAudioContext`、`IndexedDB`、`localStorage`、`document.fonts`、`html-to-image`、`window.location` 只有 JS 接口，Rust 编到 WASM 也得通过 JS 调，搬过去只多一层桥、不减少代码。

### 3.3 不迁（与既有决策冲突，本轮明确排除）

**图像识别**：`jianzi-template.ts:8-11` 已白纸黑字写明「不进 WASM」的两条理由——1.4 MB 模板索引靠 `fetch` 懒加载，塞进 `.wasm` 会让每个访客先下一遍；算法只有几十行纯算术，TS 版好测好读，省掉 wasm 工具链与产物同步。等价性由 `__tests__/jianzi-template.test.ts` 黄金样例守住。

且识别线本身处于「结构性失效」（模板索引 0 条标准完整减字），不是当前卖点。**上一轮口头把「图像识别三份合一」列进阶段 2 是错的，本清单订正为：不迁，维持原决策，等识别立项再议。**

### 3.4 不迁（类型 / 静态资产）

`types.ts`（84 处引用，纯类型）、`jianzi-dictionary-types.ts`、`example-scores.ts`、`svg-paths.ts` / `svg-paths.qiji.ts`（Python 脚本产出的静态字表）。类型走 ts-rs 生成，字表是资产不是逻辑。

---

## 4. 批次建议（订正上一轮口头排序）

上一轮口头说「先搬音高 / 徽位」，但实测 `jianzi-pitch` 有 9 处产品引用、`concert-pitch` 9 处、且都是同步渲染路径，不适合打头阵。改为按**扇出低 → 高**、**异步链路 → 同步链路**排序：

| 批次 | 范围 | 前置 | 目的 |
| --- | --- | --- | --- |
| **批 0（已销项）** | 四组重复口径**已用跨语言静态闸门钉死**（定弦 11 项 / 时值码 7 项 / 领域常量 23 项，各带变异自测），半音表另收敛为单一来源 `JIANPU_DEGREES`。11-16 复核后取消 S3 常量生成（理由见第 4 节）。11-25 复核发现这里原记「20 项」是虚高，实数 18 项，已补 C 组 5 项并订正（第 12 节） | 已具备 | 零行为变化，先消掉已出过事故的那类错；物理上仍是多份，靠闸门防漂移 |
| **批 1** | 低扇出样板：`metronome`(1/5)、`duration-drag`(1/13)、`score-bars`(1/15)、`qin-board`(1/16)、`qin-fingering`(1/18)、`pinyin-dict`(1/9) | S1 或 S2 确认 | 跑通「Rust 实现 + 逐字节对照 + WASM 三份同步」全流程 |
| **批 2** | 本来就在异步链路里：`midi-export`(1/20)、`audio-export` 的 WAV 编码(1/13)、`score-export`(1/18)、`unsaved-guard`(1/11)、`score-concordance`(1/16) | 批 1 通过 | 收益明确、不动渲染 |
| **批 3** | 中扇出：`jianpu-parser`(2/22)、`jianzi-rapid`(2/49)、`lianmei`(2/21)、`play-along`(1/25)、`practice-log`(3/23)、`practice-progress`(4/18)、`player`(5/24) | 批 2 通过 | 覆盖简谱解析与练琴统计 |
| **批 4** | 高扇出，逐个评估或只迁子集：`jianzi-explain`(6/33)、`jianzi-pitch`(9/24)、`concert-pitch`(9/11)、`tuning`(19/25)、`jianzi`(19/66) | S2 若通过 | 最后动渲染热路径 |
| **阶段 3** | 桥接自动化：直接引用 wasm-pack 已有的 `apps/web/wasm/taiyin_core.d.ts`（配合 `ts-rs` 生成的 wire 类型），去掉 `taiyin-wasm.ts:16-26` 手写、注释明说「需手动同步」的 `WasmModule` 接口；`describePhrases` / `describeArrangement` 两个 TS 侧格式化函数一并归位 | 前序批次稳定 | 杜绝「Rust 改了、前端类型没跟」 |

**批 0 前置闸门已全部就位（2026-11-15 ~ 11-16，闸门脚本本身纯只读）**。四组重复口径现在**每组都有跨语言静态闸门**：

> 11-16 另做了一次**零行为变化**的数据重构（见下文「半音表单一来源」）：改了 3 个前端 TS 文件，但产品行为没变、没碰 `crates/**`、没重建 WASM。闸门脚本仍然只读。

| 脚本 | 守什么 | 检查 / 变异 |
| --- | --- | --- |
| `verify-tuning-contract.mjs`（既有） | 定弦名单 4 份同源 | 11 项 / 7 条变异 |
| `verify-duration-code-contract.mjs` | 时值 ↔ 码尾数字 4 处；`"16"` 必须排在 `"1"` 前的顺序陷阱 | 7 项 / 8 条变异 |
| `verify-domain-contracts.mjs` | 徽位音高表 10 项（含 2 条防抄表）+ 减字记号表 8 项 + UI 枚举 ↔ ts-rs 生成 ↔ 默认键盘 5 项 | 23 项 / 21 条变异 |

`scripts/verify-domain-contracts.mjs` 覆盖的两组：
- **徽位音高**：Rust `HUI_RATIOS` / `HUI_HARMONIC` / `DEGREE_SEMITONES` ↔ TS `HUI_FRACTION` / `HUI_HARMONIC`，外加「比例约分后的分母 == 泛音谐波次数」这条物理一致性（一徽 1/8→8 次、六徽 2/5→5 次、九徽 2/3→3 次）。它专门能抓住**两端一起改、集合仍然对齐、但物理上已经错了**的情况。另守 `HUI_TICKS` 必须由 `huiFraction` 派生，不许再抄一份表。`DEGREE_SEMITONES` 现在与前端唯一来源 `JIANPU_DEGREES` 逐项比，并额外静态检查 `player.ts::SEMITONES` 与示例谱测试都是「派生 / 导入」而非硬编码。
- **减字记号**：Rust `TONE/SLIDE/HUI/FEN/STRING_TOKENS` ↔ `jianzi-rapid.ts` 的连打表 ↔ `jianzi.ts` 的 `SLIDE_MARKS` / `STRUCTURE_MARKS` ↔ `types.ts` 联合 ↔ Rust `StructureMark` 枚举，字母、汉字、顺序都逐项比。
- **UI 枚举**（11-25 新增）：`types.ts` 手写的 `NoteType` / `RhythmMode` / `StructureMark` 联合 ↔ `generated/` 的 ts-rs 产物；另查 `DEFAULT_KEYBOARD` 的 `toneTypes` / `rhythmModes` 是否把枚举里每个值都摆上了键盘。`generated/` 与 Rust 是否同步已由 CI 的 `gen_types` + `git diff --exit-code` 管住，这一组补的是它管不到的一环——**生成文件对了，手抄的那份仍可以是错的**。

**边界（别误加）**：`ACTION_TOKENS` / `LEFT_TOKENS` 与连打 `rightAction` / `leftFinger` **不是同源**——Rust 存全字（挑/抹/食/名），连打存省写字形（乚/木/亻/夕），是归一化映射。把它们塞进静态比对只会制造误报。`SlideMark` 联合也不必比，多一个不在联合里的值 `tsc` 会直接红。

现有 vitest 行为测试守的是**单侧性质**（21 个、无重复、抽查 1/7/13 徽位、5 个记号都有释义），这三个脚本守的是**跨语言同源**，层次不同、不重复。三个脚本都带 `--self-test`，变异逐条由 `expect` 指定的那一项检查抓到，防「改哪儿都全红」的假抓到。本地入口 `just verify-contracts`；CI 里由 `build.yml` 的 web job 带 `--self-test` 跑（此句原写「不接 CI」是过时说法，11-25 订正）。

**半音表单一来源（11-16 已销项）**：原先前端有三份各自为政的半音表——`player.ts::SEMITONES`（播放）、`jianzi-pitch.ts::degrees`（频率 → 唱名）、`example-scores.test.ts`（硬编码校验）；闸门最初只钉住「Rust ↔ 测试」这一对，播放那份从没跨语言比过。现在把 `jianzi-pitch.ts::JIANPU_DEGREES` 提成全项目唯一来源：Rust `DEGREE_SEMITONES` 与它逐项比，`player.ts` 由 `Object.fromEntries(JIANPU_DEGREES)` 派生，示例谱测试直接 import 使用；闸门再守两条「不许再抄一份」的静态检查，并各配一条变异验证。

本轮改动 3 个前端 TS 文件（纯数据重构、零行为变化）。验证：相关单测 **57/57**、`tsc --noEmit` / eslint / `cargo fmt --check` 全 0、`just verify-contracts` 三组全绿。未碰 `crates/**`、未重建 WASM。

**迁移范式**照抄 `score-phrases.ts`：句界只在 Rust 有一份（`phrase_ranges`），TS 侧只做排版与展示，不抄阈值。

---

## 5. 每批统一验收协议

1. **留基线**：迁移前跑 `env -u NODE_OPTIONS pnpm exec vitest run src/lib/__tests__/<name>.test.ts --pool=threads --no-file-parallelism`，保存输出与用例数。
2. **Rust 侧**：把现有黄金用例翻成 `#[test]`，`cargo test -p taiyin-core --lib`（离线可跑）；新增 `#[wasm_bindgen]` 导出走 JSON 桥接，沿用 `wasm.rs` 的 `json_error` 约定。
3. **格式**：`cargo fmt --check`。
4. **重建**：`just rebuild-probe-wasm`（只要改了 `crates/taiyin-core/src/**` 任何文件，含注释与 `src/bin/gen_types.rs`，必跑）。它同时重建 `apps/web/wasm`、`apps/web/public/wasm`、`apps/miniprogram-wasm-probe/wasm` 并刷新探针指纹。
5. **双验**：`node scripts/verify-wasm.mjs` + `just verify-probe`。
6. **类型**：动 wire 类型则 `just gen-types` + `just check-types-fresh`。
7. **逐字节对照**：旧 TS 函数保留一个发布周期，新增对照测试，同一组输入断言 TS 与 WASM 输出完全相同（文本用 `JSON.stringify`、字节用 `Uint8Array` 逐项比）。对照测试要做变异验证，确保不是假绿。
8. **前端**：`env -u NODE_OPTIONS pnpm exec vitest run ... --pool=threads --no-file-parallelism`；`--coverage` 时加 `--coverage.reportsDirectory=/tmp/xxx`，确认不低于 94 / 91 / 84 / 92。
9. **构建与静态检查**：`pnpm build`、`npx tsc --noEmit`、`env -u NODE_OPTIONS node node_modules/eslint/bin/eslint.js ...`（绕过本地 shim 的 EPIPE）。
10. **提交**：`git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -F <msg文件>` **单独跑**并 `echo "EXIT:$?"` 确认真的产生 commit。
11. **CI**：`gh run list --commit <完整 40 位 sha>`（短 sha 恒返回空）；触发的 workflow 必须全绿。Pages 部署成功不等于 build 绿。

---

## 6. 统一回滚点

- 一批一个 commit，不混批；回滚 = `git revert` 单个 commit + 重跑 `just rebuild-probe-wasm` + 双验。
- 旧 TS 函数保留一个发布周期，用开关切换实现；确认无回归后再删，删除单独一个 commit。
- WASM 三份产物与 `apps/miniprogram-wasm-probe/scripts/wasm-provenance.json` 指纹跟 commit 一起走，**不许手改清单绕过预检**。
- 覆盖率阈值、字形闸门 `EXPECTED_GLYPH_INVENTORY`、`docs/overview.md:129-131,310` 静态快照一律不动。

---

## 7. 红线与已知坑

- 本地 `vitest --pool=forks` 偶发 60s worker 超时（`NODE_OPTIONS` shim 导致 IPC 不通）→ 用 `--pool=threads --no-file-parallelism`；同 shim 让 eslint 恒报 `write EPIPE`。
- BSD `grep` 不认 `\s` / `\b`，写 `[[:space:]]` 或改用 Grep 工具；heredoc 会吃 `\d`，统计脚本用 `node -e` 或落盘。
- 改可见文案先 grep `page.test.tsx` / `page-interactions.test.tsx` 的字符串断言。
- `cargo audit` 的 RustSec 库每日更新会让无改动的 CI 变红，先 `--log-failed` 确认，有补丁就 `cargo update -p X --precise V`，不新增 ignore。
- 改字形表 / 示例谱 / 字体先跑 `pnpm exec vitest run src/lib/glyph-inventory.test.ts`，再同步文档里的分组明细，别只换总数。
- 新增 `docs/*.md` 不在 `verify-publish.mjs --copy-only` 的写死白名单里，不会被发布预检扫到；本文是内部工程件，不进对外文案。

---

## 8. 待拍板

| 编号 | 事项 | 建议 |
| --- | --- | --- |
| P-1 | S1 / S2 选哪条（头号，决定批 1 之后能不能开工）。S3 已复核降级；S2 在 Node 与真实静态导出浏览器里都实测可行，不确定性只剩改造成本与时机 | **S1 小步 → S2 单独立项**；S3 并入阶段 3，不再打底 |
| P-2 | 图像识别是否维持「不进 WASM」原决策 | 维持；识别立项前不动 |
| P-3 | 是否接受旧 TS 函数保留一个发布周期（短期代码重复换可回滚） | 接受 |
| P-4 | 工具脚本（8 个 `.py` / 12 个 `.mjs` / 6 个 `.sh`）是否也换 Rust | 不换；属胶水，收益低且会破坏现有闸门 |
| P-5 | 是否把 Next.js 界面也换成 Leptos / Dioxus | 本轮不做；会作废前端改造、1,346 用例、覆盖率闸门、静态部署与字体链路 |

---

## 9. 勾选清单（阶段 0 本身）

- [x] 统计 Rust / 前端代码规模与分区
- [x] 统计 27 个待迁模块的产品引用数、测试文件与用例数
- [x] 定位四组重复口径与现有静态闸门
- [x] 识别同步 / 异步桥接头号风险
- [x] 核实既有「不进 WASM」决策并订正上一轮排序
- [x] 写清每批验收命令与回滚点
- [x] 实测 S2：`initSync` 同步初始化可行，9 个导出可同步调用
- [x] 批 0 前置闸门：时值码四处同源，7 项基线 + 8 条变异自测全绿
- [x] 补齐另两组闸门（徽位音高 10 项 + 减字记号 8 项，当时 18 项 / 16 条变异全绿；「20 项」是当时写错的数字，11-25 复核订正）
- [x] 半音表收敛为单一来源 `JIANPU_DEGREES`，player / 示例谱测试均派生，另加 2 条防抄表检查与变异
- [x] 批 0 以「四组静态闸门 + 半音表单一来源」销项；S3 常量生成经复核取消
- [x] S2 在真实 Chromium 静态导出产物里实测同步初始化通过（`just probe-wasm-sync`）
- [x] P-1 ~ P-5 拍板：走 **S2**（启动预加载 + 同步 getter），S3 取消，P-2/P-4/P-5 维持「不做」
- [x] 批 1~4 开工并完成（见第 10 节）
- [x] 阶段 3 桥接自动化：手写 `WasmModule` 删除、两个格式化函数归位 Rust（见第 11 节）

---

## 10. 执行结果（2026-11-19）

前面的批次表是**计划**，这一节是与计划不一致的地方与实测数字。

### 10.1 落了什么

| 目标 | 产物 | 规模 |
| --- | --- | --- |
| 联袂（批 3） | `crates/taiyin-core/src/lianmei.rs` | 670 行 / 21 测 |
| 简谱解析（批 3） | `jianpu_parse.rs` | 531 行 / 15 测 |
| 连打文法（批 3） | `jianzi_rapid.rs` | 809 行 / 19 测 |
| 减字文本互转（批 4） | `jianzi_text.rs` | 855 行 / **37 测** |
| 音高（批 4） | `pitch.rs` | 555 行 / 15 测 |
| 释义（批 4） | `explain.rs` | 1190 行 / 31 测 |

前端同源文件随之变薄：`jianzi.ts` 454→255、`jianzi-rapid.ts` 450→217、
`jianzi-explain.ts` 566→250、`jianpu-parser.ts` 189→141。
`lianmei.ts`（259→244）行数几乎没减——它保留了 UI 侧的成组视图，判定已移进 Rust。

### 10.2 计划外的三件事

1. **`src/lib/client/` 门面先落地**（计划里挂在「后续」）。理由：迁移让组件同时接触
   `taiyin-wasm` 与 `api` 两个出口，不先收口，每迁一个模块就要改一遍调用点。
2. **15 个薄客户端 HTTP 端点**（计划里没有）。App / 小程序不打包 WASM 也要拿到同一份领域逻辑。
   它们纯计算、无状态，**不挂 `translate` 限流**——那条锁是为 LLM 成本设的，套在 CPU 计算上只会误伤。
3. **`useCommunity` 确认不做**。原表标「中高，暂缓」，执行时核实：它不是独立关注点，
   而是与加载对话框 UI 状态深度纠缠（tab 对象内嵌 `onLoadMore` 回调、`loadTabsRef` 镜像防闭包过期、
   排序/关键词/定弦互相牵连）。拆出去要传的参数比收益多，违反「不过度工程」。

### 10.3 执行期踩到的坑

- **薄壳降级会伪装成逻辑错**。领域逻辑进 Rust 后，前端函数在引擎未就绪时返回空值或降级拼接。
  任何依赖它的测试都必须 `beforeAll(loadRealWasm)`——`jianzi-block.test.tsx` / `score-export.test.ts`
  就漏了这一步，输出字形「散乚一」而非可读名「散挑一」，11 条断言红在意外的地方。
  `src/lib/__tests__/load-wasm.ts` 已把这条写进注释，是**迁移后每个测试文件的必读项**。
- **产物新鲜度是假绿之源**。`verify-wasm-fresh.mjs` 在本轮开头就判红（源码指纹已变、`.wasm` 还是旧的）。
  CI 每次重建所以不会绿得可疑，**本地会**。改 `crates/taiyin-core/src/**` 后必跑 `just build-wasm`。
- **新端点容易只测核心、不测 HTTP 层**。`domain_app()` 原先只注册 4 个端点，其余 11 个从未经过路由表。
  网页走 WASM 根本碰不到它们，等于 11 个公开面零覆盖。已补齐，并做变异验证确认断言不是恒真。

### 10.4 下一步（未做）

第 4 项「谱字节点树（`Puzi`）」于 11-25 完成**核心数据模型层**（见第 13 节），
绑定层与 UI 尚未接线；第 5 项「识别改为部件 + 布局」仍未开工——
它动字形资产与识别流程，按原计划独立一轮。

---

## 11. 阶段 3（2026-11-23）：桥接自动化，两句文案归位

批次表里「阶段 3」只剩两件事，本轮都做完了，且两件都落成**闸门**而不是靠记性：

| 事项 | 落法 | 守它的东西 |
| --- | --- | --- |
| 手写 `WasmModule`（抄了 26 个导出，注释写「重建后需手动同步」） | `Omit<typeof import("@/wasm/taiyin_core"), "default" \| "initSync">` | `tsc`：Rust 改掉一个导出名，调用点直接 TS2551 |
| `taiyin-wasm.ts` 里的 `describePhrases` / `describeArrangement` | 新增 `crates/taiyin-core/src/describe.rs`，wasm 导出 26 → 28 | 14 条 `#[test]` + 12 例真实产物黄金样例，两边用同一批样例 |

要点与边界：

- **文案为什么在核心**：和 `explain.rs` 同一个理由——网页、小程序、App 得说同一句话。
  这段文字本来就是「不许撒谎」的约束（没减少的项不能提、指标变多了也要说、
  本来就最顺时直说），两处各写一套，等于给漂移留门。
- **载荷只发文案真正用到的四个字段**（`stats` / `greedy_stats` /
  `identical_to_greedy` / `phrases`）。候选列表与落点索引在长曲里是几百个对象，
  文案一个都不看；`DescribeInput` 在类型上就把「文案依赖什么」写死。
- **降级只有一条出口**：引擎未就绪（`getWasmSync` 抛）、浏览器缓存着旧产物
  （glue 没这个导出 → TypeError）、核心返回 `{"error":…}`，全部 `catch` → 空串。
  一开始同时写了 `isWasmReady()` 早退和 try/catch，变异验证直接证明前者是死代码。
- **HTTP 端点没跟着加**：15 个薄客户端端点里本来就没有编排
  （`/api/v1/jianpu/arrange` 不存在），App 现在也不做编排，凭空加一个端点
  等于造一个没人调用的公开面。等 App 真要做编排时再一起加。

经过本轮，`taiyin-wasm.ts` 里已经没有任何领域口径，只剩三件事：加载状态机
（async / sync 两条路径）、JSON 桥接、降级。第 10.4 节里识别改「部件 + 布局」
仍未开工；谱字节点树 `Puzi` 已于 11-25 落地核心数据模型（见第 13 节）。

---

## 12. 补两条「同源闸门」（2026-11-25）：isComplete 真值表 + UI 枚举

11-24 的全面体检留了两个洞，都属于「两份实现各自全绿、没人证明它们一致」：

| 洞 | 之前的状况 | 本轮的落法 |
| --- | --- | --- |
| `isComplete` 双侧重复 | 前端 `jianzi.ts::isComplete` 与 Rust `jianzi_text.rs::is_complete` 各一份，两侧测试只验自己 | `__tests__/is-complete-parity.test.ts`：真实 WASM 产物跑 80 条全真值表 |
| `types.ts` 枚举与 `generated/` 可能分家 | ts-rs 产物有 CI 管，手抄的 UI 联合没人管 | `verify-domain-contracts.mjs` C 组 5 项 / 5 条变异 |

### 12.1 `isComplete`：为什么不合并，而是证明两边一样

第 10.4 节把「把 `isComplete` 搬进 Rust」列为候选。本轮**没搬**，理由写在 `jianzi.ts` 头部已久：它在渲染路径上每帧要问好几次（键盘 4 处 + 预览 1 处 + 保存条 1 处），走 WASM 往返不划算；改成「同步 getter + JS 兜底」还会留下**兜底与 Rust 必须永远一致**这个同款问题，而且首屏 SSR 用兜底、客户端用 Rust，一旦不一致就是 hydration 警告。合并没消掉重复，只是换了个位置。

真正缺的是**证明**，所以补的是闸门：

- **不用替身**：替身要和 Rust 一起改，真实产物不会撒谎。
- **也不新增 WASM 导出**：`encode` 第一句就是 `if !is_complete(state) { return Err }`，「编不出码」就是「不完整」的可观测后果。用现成的 `encode_jianzi_batch` 驱动，验的是用户真正会撞上的链路。
- **等价于全真值表**：判断只取决于 5 个字段有没有值，故 5 个音色（3 个合法 + 2 个越界）× 16 种有无 = 80 条，不必跑几万条。
- **越界音色是故意放的**：Rust 用 `match` 兜 `_ => false`，前端原先写 `toneType !== null && …`。脏 JSON 带「泛音」「花指」进来时两边会**反着答**（界面说能入谱、后端编不出码）。前端已改成显式 `switch` 对齐 Rust，这条差异由真值表钉住。
- **变异验证**：给前端 `case` 补一个 `"花"`，测试立刻红并指出「音色「花」有 leftFinger+hui+rightAction+stringNumber」——报错直接说出是哪一格，不是一句「期望相等」。

`toneType === null`（还没选音色）这一格不在真值表里：`encode` 的入参 `tone_type` 是 `String`，Rust 侧没有「没选音色」的表示法。这一格由前端单独负责，测试里另起一条断言（`createEmptyState()` 必须为 false），并写清了不在表里的原因。

### 12.2 UI 枚举：生成文件对了，手抄的仍可以是错的

三个枚举有**三份**皮：Rust 枚举（真相源）→ ts-rs 生成（`generated/`）→ 手写的 UI 联合（`types.ts`）。前两步 CI 已经管住（`cargo run -p taiyin-core --bin gen_types` 后 `git diff --exit-code`），坏在第三步：Rust 加一个音色、跑一遍 ts-rs，`generated/NoteType.ts` 变了，`types.ts` 那份手抄的联合纹丝不动。`tsc` 只在**用到新值**的地方报错，用不到就一路全绿，直到线上有人录不进这个音色。

C 组 5 项：

1. `NoteType` 联合 == `generated/NoteType.ts`
2. `RhythmMode` 联合 == `generated/RhythmMode.ts`
3. `StructureMark` 联合 == `generated/StructureMark.ts`
4. `DEFAULT_KEYBOARD.toneTypes` 序列 == `NoteType` 联合
5. `DEFAULT_KEYBOARD.rhythmModes` 序列 == `RhythmMode` 联合

后两项是「枚举里有、键盘上没有」：录不进去的音色等于不存在，这种漏比写错更安静。变异验证里三条打在**生成文件**或**键盘配置**上（而不是手写联合本身），因为这才是事故的真实发生方式。

### 12.3 顺带订正的历史数字

`verify-domain-contracts.mjs` 原记「20 项 / 20 条变异」，实测是 **18 项 / 16 条**。本轮补 5 项 / 5 条后为 **23 项 / 21 条**，第 4 节表格与第 9 节勾选清单已按实数订正。这类「文档数字比实际虚高」和「文档待办 ≠ 没做」是同一个坑：写的人凭印象加了数，后来没人再跑一次去核。

---

## 13. 谱字节点树 `Puzi`：核心数据模型落地（2026-11-25）

第 10.4 节第 4 项终于开工，但**只做数据模型层**，不接绑定层与 UI。
理由：`Puzi` 的价值在「定义什么是一个谱字」，先把定义与兼容性钉死；
录入、渲染、导出要在定义稳定之后再接，否则定义错了要连 UI 一起返工。

### 13.1 四类形式，以及一个刻意的缺席

`crates/taiyin-core/src/puzi.rs` 按 alephpi/jianzipu 归纳的四类语法形式定义：

| 形式 | Rust | 解决什么 |
| --- | --- | --- |
| 简单 | `Puzi::Simple(GuqinNote)` | 旧曲谱的每一条 note，原样落进这里 |
| 撮式 | `Cuochuo { first, second }` | 同一拍两个发声点；拆成两个音就丢了「一个谱字」的语义 |
| 旁注 | `Annotation { note, moves }` | 「上七徽九分」「二上七六」走手落点，不再塞 `ornaments` 当字形 |
| 独体 | `Standalone { mark }` | 少息/再作等不发声但单独占位的谱面记号 |

**第四类「联袂指法」刻意不做成变体**：`crates/taiyin-core/src/lianmei.rs` 已经把联袂建成
「音符之间的关系」。记号是谱字**本身**，联袂是谱字**之间**的关系；
塞进同一个枚举就会有两套互相竞争的成组模型——这正是本项目反复想避免的重复口径。

### 13.2 旧曲谱不破：靠 `untagged` + `Simple` 打头

`#[serde(untagged)]` 让裸 `GuqinNote` JSON 原样反序列化成 `Puzi::Simple`，
序列化回去逐字段不变。`Simple` 必须排第一，且 `GuqinNote` 没开 `deny_unknown_fields`，
所以将来加字段也不会让旧 note 落到后面的变体上。

9 条 Rust 单测里最关键的两条：

- `old_note_json_is_simple_and_roundtrips_byte_for_byte`：裸音符 JSON 往返后作为
  `serde_json::Value` **逐值相等**（不是「能 parse 就行」）。
- `old_score_json_with_plain_notes_still_deserializes`：整首旧 score（含两条裸 note）
  往返后与输入 JSON 逐值相等。这条若红，意味着每次打开旧谱都要先迁移——那就不是兼容。

另外 `TryFrom<Puzi> for GuqinNote` 对三种复杂形式一律返回**带原因的错误**，
不悄悄只留第一个音：「丢一半」比报错难查得多。

### 13.3 接线范围与验证

- `GuqinScore.notes: Vec<GuqinNote>` → `Vec<Puzi>`（全仓**只有 core 自己用**，
  前端与 server 都不直接构造 `GuqinScore`，影响面已逐个 grep 核过）。
- `Tuning` 与 `GuqinScore` 补 `TS` derive；`gen_types.rs` 追加 `Puzi::export_all()` /
  `GuqinScore::export_all()`，新增 `generated/Puzi.ts` / `GuqinScore.ts` / `Tuning.ts`。
- 因 `crates/taiyin-core/src/**` 有改动，按红线跑了 `just rebuild-probe-wasm`：
  三份 WASM + 探针产物 + 来源清单同步；`verify-wasm.mjs` / `verify-wasm-fresh.mjs` /
  `just verify-probe`（7 个校验器）/`just check-types-fresh` 全绿。
  WASM 二进制 hash 未变（新类型暂未导出到 wasm），但源码指纹已更新——
  **指纹变、字节不变是正常的**，不是「重建没生效」。
- Rust：270 条 core 单测通过，`cargo check --all`、`cargo clippy -D warnings` 通过。

### 13.4 边界（别当成已完成的功能）

这一轮只让 `Puzi` **能存**：撮式 / 旁注 / 独体目前没有 WASM 导出、没有录入入口、
没有渲染路径。用户看不到任何变化，这是刻意的——数据契约先于交互。
下一步若接绑定层，应先加 WASM 导出 + 真实产物黄金样例，再动 UI；
识别改「部件 + 布局」仍独立排期。
