# 太音 (Taiyin)

![Rust](https://img.shields.io/badge/Rust-1.85.0-orange?logo=rust)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![License](https://img.shields.io/badge/License-MIT-blue)

**太音 · 古琴减字谱 AI 传习平台**

手机端古琴减字谱拼装输入法 + AI 简谱翻译 + 琴友社区。用 Rust WASM 做核心引擎，Next.js 做前端，将千年减字谱带入数字时代。

---

## 📂 项目结构

```text
.
├── crates
│   ├── taiyin-core          # Rust 核心数据结构 + WASM 逻辑
│   └── taiyin-server        # Axum 后端 API 服务
├── apps
│   └── web                  # Next.js 16 + React 19 前端
├── justfile                 # 统一命令入口
├── docker-compose.yml       # 本地开发数据库
└── .github/workflows/       # CI
```

## 🛠 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| **核心库** | Rust + serde | GuqinNote/GuqinScore 数据结构，WASM 编译 |
| **后端** | Axum (Rust) | 社区 API、AI 翻译转发、积分记账 |
| **前端** | Next.js 16 + React 19 | H5 网页，后续可封装为小程序 |
| **样式** | Tailwind CSS 4 + shadcn/ui | 减字键盘 CSS 拼装渲染 |
| **AI** | DeepSeek R1/V3 (Python) | 简谱→减字翻译、乐理问答 |

## 🚀 快速开始

```bash
# 安装依赖
pnpm install

# 启动前端开发服务器
just dev

# 检查 Rust 代码
just check

# 运行测试
just test

# 本地数据库（可选）
just docker-up
```

## 📐 核心数据模型

减字谱被完全结构化为 JSON 友好的数据格式，支持前端、后端、AI Agent 统一交互：

```rust
// 大指九徽勾一弦
GuqinNote {
    left_finger: Some(Da),
    hui: Some(HuiPosition { hui: 9, fen: None }),
    right_action: Gou,
    string_number: 1,
    ornaments: [],
    duration: 1.0,
}
```

详见 [taiyin-core](crates/taiyin-core/src/lib.rs)。

## 🔧 常用命令

```bash
just check         # cargo check
just test          # cargo nextest run
just clippy        # clippy lint
just dev           # 前端开发服务器
just ci            # 提交前全量检查
```

## 📄 许可

MIT
