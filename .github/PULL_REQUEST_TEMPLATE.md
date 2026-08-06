# 变更说明

## 类型
<!-- 勾选一项（与 Conventional Commits 对应） -->
- [ ] feat: 新功能
- [ ] fix: 缺陷修复
- [ ] docs: 文档
- [ ] refactor: 重构（无行为变化）
- [ ] perf: 性能
- [ ] test: 测试
- [ ] chore: 构建 / 工具 / 依赖

## 关联
- 关联 Issue / 任务: #

## 做了什么
<!-- 一句话概括 + 关键实现要点（给 reviewer 快速建立上下文） -->

## 对 Reviewer 的说明（重要）
<!-- 为什么这样写？有哪些风险点 / 需要重点 review 的地方？
     例如：改了领域不变量类型、动了 CORS / 限流、改了数据库迁移等。 -->

---

## 提交者自查清单（必勾）
- [ ] `just precommit` 本地通过（fmt + clippy + 单测 + 前端测试）
- [ ] 新增 / 修改逻辑有测试覆盖（含边界与错误路径）
- [ ] 公开 API / 数据契约变更已同步前端与文档
- [ ] 数据库变更已提供迁移，且 `common/mod.rs` 可自动执行
- [ ] 涉及安全（鉴权 / CORS / 限流 / 密钥）已显式说明，未把密钥写入前端代码或日志
- [ ] 无合并冲突标记、无行尾空白

## Definition of Done（PR 可合并的最低标准）
- [ ] CI 全绿（`.github/workflows/build.yml`：rust + web）
- [ ] 至少 1 个 approval；`crates/taiyin-core/` 与后端安全相关文件（`auth.rs` / `config.rs` / `main.rs` / `routes.rs`）需对应 `.github/CODEOWNERS` 指定的 reviewer 批准
- [ ] 提交信息符合 Conventional Commits
- [ ] 用户可见行为变更已同步文档 / 注释
