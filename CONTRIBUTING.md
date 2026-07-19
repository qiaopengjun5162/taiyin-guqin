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
