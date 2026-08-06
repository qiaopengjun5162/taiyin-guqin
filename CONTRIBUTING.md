# 贡献指南 (Contributing)

感谢你考虑为 **太音 (Taiyin)** 贡献代码！太音是一个用 Rust + Next.js 构建的古琴减字谱开源传习平台。无论你是修复 bug、改进文档，还是提交新功能，我们都欢迎。

---

## 如何贡献

### 1. 报告 Bug

发现 bug 时，请先查看 [Issues](https://github.com/qiaopengjun5162/taiyin-guqin/issues) 确认是否已被报告。如果未报告，新建 issue 并说明：

- 问题描述
- 复现步骤
- 环境信息（操作系统、浏览器版本等）

### 2. 提交代码

1. Fork 本仓库
2. 创建功能分支：`feature/your-feature` 或 `fix/your-fix`
3. 提交前确保通过全部检查：

   ```bash
   just ci
   ```

4. 提交到你的 fork，向 `main` 分支发起 Pull Request

### 3. 代码规范

| 规范 | 命令 |
| --- | --- |
| Rust 格式化 | `cargo fmt --all` |
| Rust 检查 | `just check` |
| Rust 测试 | `just test` |
| Rust Lint | `just clippy` |
| 提交信息 | [Conventional Commits](https://www.conventionalcommits.org/) |

### 4. 提交信息格式

参考 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat(core): 添加吟猱装饰音支持
fix(web): 修复减字键盘触摸事件冲突
docs: 更新 API 文档
```

### 5. 提交前检查（pre-commit）

仓库**统一使用 git native hook + `just`**（不依赖 python 的 pre-commit 框架）。首次克隆后运行一次：

```bash
just setup-hooks
```

此后每次 `git commit` 会自动执行 `just precommit`，包含：
- `cargo fmt --all -- --check`（格式化）
- `cargo clippy ... -D warnings`（lint）
- `cargo nextest run --all-features --lib`（单元测试，**不依赖数据库**）
- `pnpm --filter web test`（前端测试）

> 需要 `DATABASE_URL` 的后端集成测试（账号 / 曲谱 CRUD）交给 CI（`.github/workflows/build.yml` 会起 Postgres 服务），本地无需手动起库。完整 CI 等价检查用 `just ci`。

### 6. Definition of Done

PR 可合并的最低标准：
- CI 全绿（build.yml 的 `rust` + `web` 两个 job；`coverage` 为非阻塞可视化，见下）
- 至少 1 个 approval；`crates/taiyin-core/` 与后端安全相关文件（`auth.rs` / `config.rs` / `main.rs` / `routes.rs`）需对应 `.github/CODEOWNERS` 指定的 reviewer 批准
- 提交信息符合 [Conventional Commits](https://www.conventionalcommits.org/)
- 用户可见行为变更已同步文档 / 注释

### 6.1 测试覆盖率

- 本地生成报告（需先装 `rustup component add llvm-tools-preview && cargo install cargo-llvm-cov`）：

  ```bash
  just coverage        # 生成 lcov.info 并打印摘要（仅 --lib，不依赖数据库）
  ```

- **软目标**：`taiyin-core` 行覆盖 **≥ 在合并前应努力维持**；2026-08-02 实测基线 **96.8%**（行）/ 96.5%（函数）。
- CI 的 `coverage` job 会生成 lcov 产物（artifact `coverage-lcov`）供查看；该 job 任何步骤失败都不阻塞合并，仅作可视化与基线追踪。
- 重大决策（如 WASM JSON 桥接）记录在 `docs/adr/`，便于追溯"为什么这么设计"。

### 7. Code Review 要求

- 所有 PR 至少需要 1 个 approval 才能合并
- 关键模块变更（核心库、鉴权 / CORS / 限流、CI 配置、前端 API 契约）会根据 `.github/CODEOWNERS` 自动指派 reviewer，必须等其批准
- Reviewer 重点检查：测试覆盖（尤其边界与错误路径）、公开契约兼容性、安全（密钥不进前端代码 / 日志）、性能回归
- 提交者请在 PR 模板中填写「对 Reviewer 的说明」，降低 review 成本

---

## 开发环境

同 `README.md` 中的快速开始。如有代理需求：

```bash
export http_proxy=http://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890
```

---

## 行为准则

请保持尊重和友善。骚扰、辱骂或不尊重他人的行为不被容忍。

---

再次感谢你的贡献！
