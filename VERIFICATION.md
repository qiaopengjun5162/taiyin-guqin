# 验证与协作契约（Verification & Collaboration Contract）

> 本文件定义本项目在「Agent 加速实现」背景下的工程方法：人负责什么、Claude 负责什么、用哪些验证机制做快速确认，以及不可省略的工程基本功。
> 架构级的「可核验策略」见 `CLAUDE.md`，贡献流程与 Definition of Done 见 `CONTRIBUTING.md`；本文件是它们的协作层补充。

## 0. 一句话原则

**人定方向与标准（规划 / 设计 / eval 设计 / QC 规则），Claude 做实现，验证机制把「实现质量」的审查自动化；人用这些信号做快速确认，但确认本身仍是判断，不是盖章。省下来的是写码的时间，不是思考的时间。**

## 1. 四条工程信条（Why）

1. **研究式方法**：定目标 → 尽可能转化为可量化 eval 指标 → 系统未达标时按三类归因——① 评估方法本身有问题 / ② 环境有问题 / ③ 才是模型或代码问题。
2. **委托实现 + 快速确认**：实现交给 Claude；用信号（编译 / CI / 运行探针）快速确认，不必逐行审阅每行代码。
3. **快速确认建立在大量验证机制上**：格式门、安全门、测试门、部署门、流程门——它们合起来就是一份「分布式 code review」。
4. **必要制衡**：上述绝不等于工程师可以松懈。软件从规划 → 开发 → 交付的基础原则不因 Agent 加速某环节而失效；AI 只让「实现」更快，不能省略规划、设计、判断、质量控制。验证闸门是决策辅助，不是把判断外包给机器。

> 实现越便宜，人的判断反而越值钱：当「把代码写出来」不再是瓶颈，真正的稀缺资源变成了「决定什么是对的」。

## 2. 职责双栏（Division of Responsibility）

### 工程师必须保留（投入思考，不可委托）

- **目标与到达条件**：把「完成」写成可验证的 bar（例如「前后端在跑 + CRUD 实测通 + CI 双绿」），eval 全过即收口。
- **系统架构与扩展点决策**：如 `ANTHROPIC_BASE_URL` 扩展点、减字谱双层渲染架构、由减字反推音高的物理模型。Claude 不会主动提出「我们该留一个代理入口」，需人先想到。
- **eval 设计与阈值设定**：识别准确率 harness 的指标（precision / recall / 分字符错误率）怎么定、多少算过。
- **失败归因判断**：红线究竟是 eval 问题 / 环境问题 / 代码问题哪一类，决定下一步动哪里。
- **质量门豁免裁定**：cargo audit advisory 能否 `ignore`，须符合 `.cargo/audit.toml` 政策（仅豁免「上游无同版本修复」者，如 `RUSTSEC-2026-0381`）。点「ignore all」让 CI 绿但掩风险，是错误做法。
- **确认信号的真伪判断**：避免假确认——「push 了 ≠ CI 绿」「dev server 起了 ≠ 功能通」。

### 可委托 Claude + 快速确认

- 具体实现（函数 / 组件 / 路由 / handler）。
- 机械性修复（rustfmt 格式、依赖补丁级升级）。
- 在既定架构内补单元测试 / 集成测试。
- 运行探针 / 冒烟脚本编写。
- 文档草稿（结构需人审）。

## 3. 验证机制清单（Verification Gates）

本项目的自动化闸门（细节见 `CLAUDE.md`「可核验策略」与 `CONTRIBUTING.md`）：

| 闸门 | 形式 | 拦过什么（实例） |
|------|------|------------------|
| 格式门 | `cargo fmt` 检查（CI + pre-commit） | `LlmConfig` base_url 单行格式不符 rustfmt |
| 安全门 | `cargo audit` + `.cargo/audit.toml` 豁免政策（ADR-0003） | 2026-10-28 新披露的 11 个 advisory（quinn-proto / rustls / tokio 链） |
| 构建 / 测试门 | `cargo nextest`（69 条）+ 前端 `vitest`（254 条 / 24 文件） | `waitFor` 不重试、`getByText` 多命中这类交互 bug |
| 覆盖率门 | Rust `cargo llvm-cov --fail-under-lines 70`；前端 `vitest --coverage` 阈值（行 87 / 分支 79 / 函数 82 / 语句 84） | 2026-10-29 之前这两个数字**只上传 artifact、全程 `continue-on-error`**，等于没设防 |
| 部署门 | 前端静态导出 → GitHub Pages 构建 | 保证线上产物可构建 |
| 流程门 | `build` + `Deploy` 两个 workflow **都绿** | 防止「只推了就说 CI 兜底」的假确认 |
| 运行探针（手动） | `/health`、`/translate/select` 启发式兜底、曲谱 CRUD 冒烟 | 确认连库、持久化、端到端真通 |

### 3.1 覆盖率基线（2026-10-30 实测，可复现）

| 范围 | 行 | 分支 | 函数 | 语句 | 复现命令 |
|------|----|------|------|------|----------|
| Rust `--lib`（CI 闸门口径） | 74.74% | – | 78.51% | – | `cargo llvm-cov nextest --lib --summary-only` |
| Rust `--workspace`（含 tests/ 集成测试） | 78.76% | – | 84.40% | – | `cargo llvm-cov nextest --workspace --summary-only` |
| 前端 `src/{lib,components,app}` | 89.39% | 81.42% | 84.51% | 86.89% | `pnpm --filter web exec vitest run --coverage` |

单文件要点（同为 2026-10-29 实测，`--workspace` 口径）：
`taiyin-core/jianpu.rs` 98.23%、`taiyin-core/lib.rs` 94.68%、`auth.rs` 100%、
`llm.rs` 78.05%（补测前 59.80%）、`routes.rs` 63.18%、`config.rs` 58.24%。

**这两个数字必须能自己跑出来，不能靠人转述。** 阈值设在基线略下方，用途是「防退步」而非「刷高分」：加了业务代码却没加测试，CI 会红，逼迫补测或在 PR 里显式说明为何调整阈值。

**已知盲区（按优先级，不是「以后再说」而是「知道自己在裸奔」）**：

前端 2026-10-30 这一轮加了 47 条交互用例（254 条 / 24 文件），把三个最大的空洞补上了：
`components/jianzipu-keyboard.tsx` **24.1% → 91.96% 行**（16 条：选音色/切换散按清左右手、按键二次点击取消、八度与附点开关、编辑模式保留 id、拼音候选词/空格/方向键/回车提交、纯拼音不追加空谱字）、
`lib/audio-export.ts` **0% → 100%**（12 条：离线渲染排期与预备拍偏移、节拍器拍点数量与重音位置、44 字节 WAV 头逐字段、int16 截断、多声道交错、下载后清理 DOM）、
`app/page.tsx` **27.1% → 79.86% 行**（19 条：播放/停止与节拍器联动、空格快捷键与输入框豁免、BPM 与拍号、导出 WAV 的参数与失败回退、保存/更新/失败提示、加载列表与载入、编辑模式、删除、撤销/重做、AI 面板切换）。

`lib/api.ts` 上轮已是 **100% 行 / 88.88% 分支**（14 条：各端点 URL/方法/载荷、`ApiError` 状态与消息映射、错误体非 JSON 的 `statusText` 兜底、503 语义保留、`x-api-key` 有无两态、10s 超时中止）。这些用例都用变异验证确认过「改坏会红」。

仍未覆盖的短板（数字皆为同一口径实测）：

- `lib/audio-synth.ts` **51.1% 行** —— 真 Karplus-Strong 逐样本合成（需要 OfflineAudioContext 才能跑）。导出与播放测试都把它替身掉了，所以「音色听感对不对」目前只有人工听。
- `components/jianzi-recognizer.tsx` **82.75%**、`components/jianzi-sheet-recognizer.tsx` **88.77%** —— 上传图片后的真实识别分支（依赖后端 LLM）未测；AI 路径的正确性靠 `tools/eval-jianzi/` 的识别 eval 兜。
- `lib/pinyin-dict.ts` **81.81%** —— 大量生僻拼音键没有用例，属数据表而非逻辑。
- `app/layout.tsx` **0%** —— 只有 metadata 与字体挂载，无逻辑；计入口径仅为提醒。
- Rust `routes.rs` 在 `--lib` 口径下是 0%（集成测试不在 lib target），别拿 CI 那个数字误判它没测；`--workspace` 口径下是 63.18%。

**缺失的闸（已搭骨架，待放量）**：识别准确率 eval harness。骨架已落地在 `tools/eval-jianzi/`（标注格式 + `score.py` 计分 + HTML 报告模板 + 离线自测），指标含 `exact_match` / `detection_rate` / `mean_cer` / `component P·R·F1` / 置信度分桶准确率。现在：**离线评分与 `--self-check` 已可跑**；在线放量仍卡在 `ANTHROPIC_API_KEY`——一旦到位，填真实图片 + 真值即可跑，让 AI 识别进入「跑 eval → 过了就推」的节奏。详见该目录 `README.md`。

## 4. 快速确认协议（Quick-Confirm Protocol）

1. **提交前必扫 diff**：`git status` / `git diff --stat`（diff hygiene）。防 `tsconfig.json` 被 `pnpm dev` 误改这类无关改动混入提交。
2. **推送带回显**：`git push --verbose --progress`（沙箱无回显需重定向日志）；推送后**核对两个 workflow 的结论**，不假确认。
3. **「过了」的定义**：相关信号全绿 **且** diff 仅含预期改动。
4. **红灯归因三分类**：eval / env / model（代码），再决定动哪、是否需人裁定豁免。
5. **eval 全过即收口**：不无限小步迭代（「一直在路上」）。
6. **新测试必须亲手看它红一次**（变异验证）：写完断言后，故意把被测逻辑改坏（`if (!res.ok)` → `if (false)`、去掉 `content.trim().is_empty()` 守卫），确认测试**确实变红**，再改回来。理由很朴素——**一条从没红过的测试，等于没测**；绿得心安理得，往往是因为断言根本没碰到代码。这步 30 秒，比事后写复盘便宜得多。

## 5. 反模式（Anti-patterns）

- **假确认**：以为 push 了就 CI 绿（必须看 run 结论）。
- **假闸门**：步骤挂着 `continue-on-error: true`，看着有 job、实际永不失败（本项目 coverage job 曾如此）。
- **从没红过的测试**：断言写得很漂亮，改坏实现它照样绿——说明没测到真东西。
- **橡皮章豁免**：`ignore all` 让 CI 绿但掩风险（须按 ADR-0003 逐项裁定）。
- **跳过规划 / 设计思考**：因 Agent 能写代码就不在架构与边界上认真判断。
- **把「快速确认」当成「不确认」**：信号没看就推进。
- **无限加功能 / 小步空转**：不到达条件不停手。

## 6. 与其他文档的关系

- `CLAUDE.md`：架构级「可核验策略」——每条策略能让 Agent 明确回答「这笔操作是否越界」+ 工程规范。
- `CONTRIBUTING.md`：贡献流程、Definition of Done、Code Review 要求。
- 本文件：把「人 / Claude 如何分工、用哪些信号快速确认、哪些基本功不可省」显式成契约，使上述两份文档的「精神」在 Agent 协作下可被执行。
