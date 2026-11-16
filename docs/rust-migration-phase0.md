# 阶段 0 · 前端逻辑归位 Rust 迁移清单

> 状态：**待确认**。本文是内部工程清单，不是产品定位文档（定位仍以 `docs/overview.md` 为准）。
> 盘点日期：2026-11-15，更新至 11-16。本阶段**不改任何产品行为、不动线上、不提交 WASM 二进制、不改覆盖率阈值**。
> 数据口径：`node scripts/measure-codebase.mjs` + 本次对 `apps/web/src` 的 import 去重扫描；用例数按 `it(` / `test(` 行首统计。

---

## 0. 一句话

项目不是「TypeScript 写的、要换 Rust」，而是**脑子已经是 Rust、脸还是 JS**。真正值得搬的是前端约 5,000 行纯计算，以及由此产生的四组重复口径；连界面一起换 Rust 的代价远大于收益，本轮不做。

---

## 1. 盘点基线

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
| **S3 构建期生成（建议打底）** | 扩 `crates/taiyin-core/src/bin/gen_types.rs`（或另加一个 bin），把常量表 / 枚举由 Rust 生成 TS 常量文件，运行时不调 WASM。注意：该 bin 目前只用 ts-rs 导**类型**（`export_all()`），生成常量值需要新增输出逻辑 | 四组重复口径一次性收敛，零行为变化，零异步问题 | 不提高「运行时 Rust」比例；改 `src/bin/gen_types.rs` 仍属 `crates/taiyin-core/src/**`，要跑 WASM 重建 |
| **S1 只迁异步链路** | 仅搬本来就在 `await` 后面的逻辑（批量编解码、字典、导出、统计面板） | 小步、可回滚、不动启动流程 | `jianzi.ts` 这类渲染热路径仍留 TS，口径重复只能部分消除 |
| **S2 启动预加载 + 同步 getter** | 应用启动时一次性加载 WASM，之后所有纯函数同步调用；改 `taiyin-wasm.ts` 签名与根组件启动流程 | 真正「业务规则全 Rust」，覆盖面最大 | 一次性改 13 个引用文件、37 个 wasm 相关用例；首屏要等加载或给降级；SSR / 静态导出兼容性要重验 |

**S2 实测（2026-11-15）**：拿现有 `apps/web/wasm` 产物在 Node 里验证过——wasm-pack 生成的 glue **确实导出了 `initSync`**；`initSync({ module: await WebAssembly.compile(bytes) })` 可以同步初始化，之后 9 个导出函数全部能同步调用（传裸 `Module` 也行，但会打废弃警告）。所以 **S2 技术可行**，剩下的成本是「一次异步取字节 + 编译」放进启动流程，加上改 `taiyin-wasm.ts` 签名、13 个引用文件、37 个用例、首屏等待 / 降级、SSR 与静态导出重验。P-1 因此从「能不能做」变成「值不值得现在做」。

**建议组合**：S3 先做（批 0）→ S1 小步验证（批 1~2）→ S2 技术已验证、仍建议单独立项。**S 方案未拍板前，不启动任何运行时迁移。**

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
| **批 0** | 四组重复口径收敛：定弦 4 份 → 1 份、时值 / 减字码 2 份 → 1 份、徽位音高表、结构记号枚举。用 Rust 生成 TS 常量，照 `verify-tuning-contract.mjs` 的写法为每组新增同类静态闸门（含 `--self-test` 变异验证） | S3 确认 | 零行为变化，先消掉已出过事故的那类错 |
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
| `verify-domain-contracts.mjs` | 徽位音高表 10 项（含 2 条防抄表）+ 减字记号表 10 项 | 20 项 / 20 条变异 |

`scripts/verify-domain-contracts.mjs` 覆盖的两组：
- **徽位音高**：Rust `HUI_RATIOS` / `HUI_HARMONIC` / `DEGREE_SEMITONES` ↔ TS `HUI_FRACTION` / `HUI_HARMONIC`，外加「比例约分后的分母 == 泛音谐波次数」这条物理一致性（一徽 1/8→8 次、六徽 2/5→5 次、九徽 2/3→3 次）。它专门能抓住**两端一起改、集合仍然对齐、但物理上已经错了**的情况。另守 `HUI_TICKS` 必须由 `huiFraction` 派生，不许再抄一份表。`DEGREE_SEMITONES` 现在与前端唯一来源 `JIANPU_DEGREES` 逐项比，并额外静态检查 `player.ts::SEMITONES` 与示例谱测试都是「派生 / 导入」而非硬编码。
- **减字记号**：Rust `TONE/SLIDE/HUI/FEN/STRING_TOKENS` ↔ `jianzi-rapid.ts` 的连打表 ↔ `jianzi.ts` 的 `SLIDE_MARKS` / `STRUCTURE_MARKS` ↔ `types.ts` 联合 ↔ Rust `StructureMark` 枚举，字母、汉字、顺序都逐项比。

**边界（别误加）**：`ACTION_TOKENS` / `LEFT_TOKENS` 与连打 `rightAction` / `leftFinger` **不是同源**——Rust 存全字（挑/抹/食/名），连打存省写字形（乚/木/亻/夕），是归一化映射。把它们塞进静态比对只会制造误报。`SlideMark` 联合也不必比，多一个不在联合里的值 `tsc` 会直接红。

现有 vitest 行为测试守的是**单侧性质**（21 个、无重复、抽查 1/7/13 徽位、5 个记号都有释义），这三个脚本守的是**跨语言同源**，层次不同、不重复。三个脚本都带 `--self-test`，变异逐条由 `expect` 指定的那一项检查抓到，防「改哪儿都全红」的假抓到。本地入口 `just verify-contracts`，按项目惯例不接 CI。

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
| P-1 | S1 / S2 / S3 选哪条（头号，决定所有批次能不能开工）。S2 已实测技术可行，不确定性只剩成本与时机 | S3 打底 + S1 小步；S2 单独立项，不因「怕做不出来」而排除 |
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
- [x] 补齐另两组闸门（徽位音高 8 项 + 减字记号 10 项，18 条变异自测全绿；11-16 扩到 20 项 / 20 条）
- [x] 半音表收敛为单一来源 `JIANPU_DEGREES`，player / 示例谱测试均派生，另加 2 条防抄表检查与变异
- [ ] P-1 ~ P-5 拍板
- [ ] 批 0 开工（拍板后才动代码）
