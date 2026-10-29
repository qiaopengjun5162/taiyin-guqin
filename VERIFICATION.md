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
| 构建 / 测试门 | `cargo nextest` + 前端 `vitest`（jianzi-pitch / player / parser / recognizer 等） | `waitFor` 不重试、`getByText` 多命中这类交互 bug |
| 部署门 | 前端静态导出 → GitHub Pages 构建 | 保证线上产物可构建 |
| 流程门 | `build` + `Deploy` 两个 workflow **都绿** | 防止「只推了就说 CI 兜底」的假确认 |
| 运行探针（手动） | `/health`、`/translate/select` 启发式兜底、曲谱 CRUD 冒烟 | 确认连库、持久化、端到端真通 |

**缺失的闸（已搭骨架，待放量）**：识别准确率 eval harness。骨架已落地在 `tools/eval-jianzi/`（标注格式 + `score.py` 计分 + HTML 报告模板 + 离线自测），指标含 `exact_match` / `detection_rate` / `mean_cer` / `component P·R·F1` / 置信度分桶准确率。现在：**离线评分与 `--self-check` 已可跑**；在线放量仍卡在 `ANTHROPIC_API_KEY`——一旦到位，填真实图片 + 真值即可跑，让 AI 识别进入「跑 eval → 过了就推」的节奏。详见该目录 `README.md`。

## 4. 快速确认协议（Quick-Confirm Protocol）

1. **提交前必扫 diff**：`git status` / `git diff --stat`（diff hygiene）。防 `tsconfig.json` 被 `pnpm dev` 误改这类无关改动混入提交。
2. **推送带回显**：`git push --verbose --progress`（沙箱无回显需重定向日志）；推送后**核对两个 workflow 的结论**，不假确认。
3. **「过了」的定义**：相关信号全绿 **且** diff 仅含预期改动。
4. **红灯归因三分类**：eval / env / model（代码），再决定动哪、是否需人裁定豁免。
5. **eval 全过即收口**：不无限小步迭代（「一直在路上」）。

## 5. 反模式（Anti-patterns）

- **假确认**：以为 push 了就 CI 绿（必须看 run 结论）。
- **橡皮章豁免**：`ignore all` 让 CI 绿但掩风险（须按 ADR-0003 逐项裁定）。
- **跳过规划 / 设计思考**：因 Agent 能写代码就不在架构与边界上认真判断。
- **把「快速确认」当成「不确认」**：信号没看就推进。
- **无限加功能 / 小步空转**：不到达条件不停手。

## 6. 与其他文档的关系

- `CLAUDE.md`：架构级「可核验策略」——每条策略能让 Agent 明确回答「这笔操作是否越界」+ 工程规范。
- `CONTRIBUTING.md`：贡献流程、Definition of Done、Code Review 要求。
- 本文件：把「人 / Claude 如何分工、用哪些信号快速确认、哪些基本功不可省」显式成契约，使上述两份文档的「精神」在 Agent 协作下可被执行。
