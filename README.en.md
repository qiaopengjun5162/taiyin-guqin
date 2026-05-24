# Taiyin

![Rust](https://img.shields.io/badge/Rust-1.85.0-orange?logo=rust)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![License](https://img.shields.io/badge/License-MIT-blue)

**Taiyin — Guqin Jianzipu (Chinese Tablature) AI Platform**

A mobile guqin notation input method, AI-powered jianzipu translation, and community platform for guqin enthusiasts. Built with Rust WASM core and Next.js frontend.

---

## 📂 Project Structure

```text
.
├── crates
│   ├── taiyin-core          # Rust core data structures + WASM logic
│   └── taiyin-server        # Axum backend API service
├── apps
│   └── web                  # Next.js 16 + React 19 frontend
├── justfile                 # Unified command runner
├── docker-compose.yml       # Local database services
└── .github/workflows/       # CI
```

## 🛠 Tech Stack

| Layer | Technology | Description |
| --- | --- | --- |
| **Core** | Rust + serde | GuqinNote/GuqinScore data model, WASM compilation |
| **Backend** | Axum (Rust) | Community API, AI translation proxy, credits ledger |
| **Frontend** | Next.js 16 + React 19 | H5 web, wrappable as WeChat mini-program |
| **Styling** | Tailwind CSS 4 + shadcn/ui | CSS component assembly for notation |
| **AI** | DeepSeek R1/V3 (Python) | Jianzipu translation, music theory Q&A |

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Start frontend dev server
just dev

# Check Rust code
just check

# Run tests
just test

# Local database (optional)
just docker-up
```

## 📐 Core Data Model

Jianzipu is fully structured as JSON-friendly types, shared across frontend, backend, and AI agent:

```rust
// Da-zhi-gou-yi: index finger pressing string 1 at 9th hui
GuqinNote {
    left_finger: Some(Da),
    hui: Some(HuiPosition { hui: 9, fen: None }),
    right_action: Gou,
    string_number: 1,
    ornaments: [],
    duration: 1.0,
}
```

See [taiyin-core](crates/taiyin-core/src/lib.rs) for details.

## 🔧 Common Commands

```bash
just check         # cargo check
just test          # cargo nextest run
just clippy        # clippy lint
just dev           # Frontend dev server
just ci            # Full pre-commit check
```

## 📄 License

MIT
