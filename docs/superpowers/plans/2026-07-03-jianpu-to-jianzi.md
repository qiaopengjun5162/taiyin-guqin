# 简谱转减字规则映射 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现正调下简谱数字到古琴减字候选的规则映射，并通过 WASM 暴露给前端，用户可在简谱输入框中输入数字并选择候选填入键盘。

**Architecture:** 在 `taiyin-core` 新增 `JianpuNote` 与候选生成模块，基于正调音高表生成散/泛/按音候选，按启发式评分排序；WASM 函数接收 JSON 返回候选列表；前端新增 `JianpuTranslator` 组件调用 WASM 并渲染候选卡片，点击后通过 `defaultNote` 回填键盘。

**Tech Stack:** Rust, wasm-bindgen, serde, React 19, TypeScript, Tailwind CSS 4

---

## 文件结构

- **Create:**
  - `crates/taiyin-core/src/jianpu.rs` — 简谱音符类型、正调音高表、候选生成与排序
  - `apps/web/src/components/jianpu-translator.tsx` — 简谱输入 + 候选选择 UI
  - `apps/web/src/components/__tests__/jianpu-translator.test.tsx` — 前端组件测试
- **Modify:**
  - `crates/taiyin-core/src/lib.rs` — 导出 `jianpu` 模块
  - `crates/taiyin-core/src/wasm.rs` — 新增 `translate_jianpu_to_jianzi` WASM 函数
  - `apps/web/src/app/page.tsx` — 集成 `JianpuTranslator` 组件
  - `apps/web/src/lib/taiyin-wasm.ts` — 如有必要，同步 WASM 类型
  - `CLAUDE.md` — 更新策略文档与测试总数
  - `DEVELOPMENT_LOG.md` — 记录实现

---

### Task 1: Rust 简谱数据模型与正调音高表

**Files:**
- Create: `crates/taiyin-core/src/jianpu.rs`
- Modify: `crates/taiyin-core/src/lib.rs`
- Test: `crates/taiyin-core/src/lib.rs`（在现有 `tests` 模块中追加）

- [ ] **Step 1: 创建 `JianpuNote` 与音高枚举**

在 `crates/taiyin-core/src/jianpu.rs` 写入：

```rust
use serde::{Deserialize, Serialize};

/// 简谱音符。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct JianpuNote {
    pub number: u8, // 1..=7
    pub octave: i8, // 0 = 中央组, +1 = 高八度, -1 = 低八度
}

impl JianpuNote {
    pub fn new(number: u8, octave: i8) -> Self {
        Self { number, octave }
    }
}
```

- [ ] **Step 2: 定义正调音高表**

继续在同一文件追加：

```rust
/// 音高，用简谱数字加八度表示。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Pitch {
    pub number: u8,
    pub octave: i8,
}

impl Pitch {
    pub fn new(number: u8, octave: i8) -> Self {
        Self { number, octave }
    }
}

/// 正调下七弦各位置的音高。
/// 数组索引：string_index (0..=6)，hui_index 对应位置。
/// hui_index 0 = 散音，1..=13 = 对应徽位泛音。
pub const ZHENG_DIAO_PITCHES: [[Pitch; 14]; 7] = [
    // 一弦
    [
        Pitch::new(5, 0), Pitch::new(5, 0), Pitch::new(7, 0), Pitch::new(1, 1),
        Pitch::new(2, 1), Pitch::new(5, 1), Pitch::new(5, 1), Pitch::new(7, 1),
        Pitch::new(1, 2), Pitch::new(2, 2), Pitch::new(2, 2), Pitch::new(3, 2),
        Pitch::new(5, 2), Pitch::new(5, 2),
    ],
    // 二弦
    [
        Pitch::new(6, 0), Pitch::new(6, 0), Pitch::new(1, 1), Pitch::new(2, 1),
        Pitch::new(3, 1), Pitch::new(6, 1), Pitch::new(6, 1), Pitch::new(1, 2),
        Pitch::new(2, 2), Pitch::new(3, 2), Pitch::new(3, 2), Pitch::new(4, 2),
        Pitch::new(6, 2), Pitch::new(6, 2),
    ],
    // 三弦
    [
        Pitch::new(1, 1), Pitch::new(1, 1), Pitch::new(3, 1), Pitch::new(4, 1),
        Pitch::new(5, 1), Pitch::new(1, 2), Pitch::new(1, 2), Pitch::new(3, 2),
        Pitch::new(4, 2), Pitch::new(5, 2), Pitch::new(5, 2), Pitch::new(6, 2),
        Pitch::new(1, 3), Pitch::new(1, 3),
    ],
    // 四弦
    [
        Pitch::new(2, 1), Pitch::new(2, 1), Pitch::new(4, 1), Pitch::new(5, 1),
        Pitch::new(6, 1), Pitch::new(2, 2), Pitch::new(2, 2), Pitch::new(4, 2),
        Pitch::new(5, 2), Pitch::new(6, 2), Pitch::new(6, 2), Pitch::new(7, 2),
        Pitch::new(2, 3), Pitch::new(2, 3),
    ],
    // 五弦
    [
        Pitch::new(3, 1), Pitch::new(3, 1), Pitch::new(5, 1), Pitch::new(6, 1),
        Pitch::new(7, 1), Pitch::new(3, 2), Pitch::new(3, 2), Pitch::new(5, 2),
        Pitch::new(6, 2), Pitch::new(7, 2), Pitch::new(7, 2), Pitch::new(1, 3),
        Pitch::new(3, 3), Pitch::new(3, 3),
    ],
    // 六弦
    [
        Pitch::new(5, 1), Pitch::new(5, 1), Pitch::new(7, 1), Pitch::new(1, 2),
        Pitch::new(2, 2), Pitch::new(5, 2), Pitch::new(5, 2), Pitch::new(7, 2),
        Pitch::new(1, 3), Pitch::new(2, 3), Pitch::new(2, 3), Pitch::new(3, 3),
        Pitch::new(5, 3), Pitch::new(5, 3),
    ],
    // 七弦
    [
        Pitch::new(6, 1), Pitch::new(6, 1), Pitch::new(1, 2), Pitch::new(2, 2),
        Pitch::new(3, 2), Pitch::new(6, 2), Pitch::new(6, 2), Pitch::new(1, 3),
        Pitch::new(2, 3), Pitch::new(3, 3), Pitch::new(3, 3), Pitch::new(4, 3),
        Pitch::new(6, 3), Pitch::new(6, 3),
    ],
];
```

- [ ] **Step 3: 在 `lib.rs` 导出模块并写第一个测试**

修改 `crates/taiyin-core/src/lib.rs`，在文件顶部附近添加：

```rust
pub mod jianpu;
```

在现有 `#[cfg(test)] mod tests` 中追加：

```rust
#[test]
fn test_zheng_diao_open_strings() {
    use crate::jianpu::{JianpuNote, Pitch, ZHENG_DIAO_PITCHES};

    assert_eq!(ZHENG_DIAO_PITCHES[0][0], Pitch::new(5, 0)); // 一弦散音 = 5
    assert_eq!(ZHENG_DIAO_PITCHES[1][0], Pitch::new(6, 0)); // 二弦散音 = 6
    assert_eq!(ZHENG_DIAO_PITCHES[2][0], Pitch::new(1, 1)); // 三弦散音 = 1
}

#[test]
fn test_jianpu_note_serialization() {
    let note = JianpuNote::new(5, 1);
    let json = serde_json::to_string(&note).unwrap();
    assert_eq!(json, r#"{"number":5,"octave":1}"#);
}
```

- [ ] **Step 4: 运行 Rust 测试确认失败**

```bash
cargo nextest run --all-features -p taiyin-core
```

Expected: 两个新测试通过，不影响现有测试。

- [ ] **Step 5: 提交**

```bash
git add crates/taiyin-core/src/jianpu.rs crates/taiyin-core/src/lib.rs
git commit -m "feat: add JianpuNote and ZhengDiao pitch table"
```

---

### Task 2: 候选生成与排序

**Files:**
- Modify: `crates/taiyin-core/src/jianpu.rs`
- Test: `crates/taiyin-core/src/lib.rs`

- [ ] **Step 1: 定义候选类型与查找函数**

在 `jianpu.rs` 追加：

```rust
use crate::{GuqinNote, HuiPosition, NoteType, RightAction};

/// 候选结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JianziCandidate {
    pub score: i32,
    pub note: GuqinNote,
}

/// 查找正调下所有匹配目标音高的位置。
fn find_matching_positions(target: Pitch) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for (string_idx, positions) in ZHENG_DIAO_PITCHES.iter().enumerate() {
        for (hui_idx, pitch) in positions.iter().enumerate() {
            if *pitch == target {
                out.push((string_idx, hui_idx));
            }
        }
    }
    out
}
```

- [ ] **Step 2: 实现候选生成与评分**

继续追加：

```rust
/// 将简谱音符翻译为候选减字。
pub fn translate_jianpu(note: JianpuNote) -> Vec<JianziCandidate> {
    let target = Pitch::new(note.number, note.octave);
    let positions = find_matching_positions(target);

    let mut candidates: Vec<JianziCandidate> = positions
        .into_iter()
        .filter_map(|(string_idx, hui_idx)| {
            let string_number = (string_idx + 1) as u8;
            if hui_idx == 0 {
                // 散音
                Some(JianziCandidate {
                    score: 150,
                    note: GuqinNote::open_string(RightAction::Tiao, string_number),
                })
            } else {
                // 泛音
                let hui = hui_idx as u8;
                Some(JianziCandidate {
                    score: 130 - hui as i32 * 2,
                    note: GuqinNote::fan_yin(
                        crate::LeftFinger::Da,
                        HuiPosition {
                            hui,
                            fen: None,
                        },
                        RightAction::Tiao,
                        string_number,
                    ),
                })
            }
        })
        .collect();

    candidates.sort_by(|a, b| b.score.cmp(&a.score));
    candidates
}
```

- [ ] **Step 3: 写候选生成测试**

在 `lib.rs` 测试模块追加：

```rust
#[test]
fn test_translate_jianpu_open_string() {
    use crate::jianpu::{JianpuNote, translate_jianpu};

    let candidates = translate_jianpu(JianpuNote::new(5, 0));
    assert!(!candidates.is_empty());
    // 一弦散音 5 应该排在最前面
    let first = &candidates[0].note;
    assert_eq!(first.string_number, 1);
    assert_eq!(first.note_type, crate::NoteType::SanYin);
}

#[test]
fn test_translate_jianpu_fan_yin() {
    use crate::jianpu::{JianpuNote, translate_jianpu};

    // 二弦一徽泛音 = 6
    let candidates = translate_jianpu(JianpuNote::new(6, 0));
    let has_fan = candidates.iter().any(|c| c.note.note_type == crate::NoteType::FanYin);
    assert!(has_fan);
}
```

- [ ] **Step 4: 运行测试**

```bash
cargo nextest run --all-features -p taiyin-core
```

Expected: 所有测试通过。

- [ ] **Step 5: 提交**

```bash
git add crates/taiyin-core/src/jianpu.rs crates/taiyin-core/src/lib.rs
git commit -m "feat: jianpu to jianzi candidate generation with scoring"
```

---

### Task 3: WASM 桥接

**Files:**
- Modify: `crates/taiyin-core/src/wasm.rs`
- Test: `apps/web/src/lib/__tests__/`（新增 WASM 集成测试）

- [ ] **Step 1: 新增 WASM 函数**

在 `crates/taiyin-core/src/wasm.rs` 合适位置追加：

```rust
/// 将简谱音符翻译为候选减字。
///
/// 输入 JSON: `{"number": 5, "octave": 0}`
/// 输出 JSON: `{"candidates": [{"score": 150, "note": {...}}]}`
#[wasm_bindgen]
pub fn translate_jianpu_to_jianzi(input_json: &str) -> JsValue {
    let note: crate::jianpu::JianpuNote =
        serde_json::from_str(input_json).unwrap_or(crate::jianpu::JianpuNote::new(1, 0));
    let candidates = crate::jianpu::translate_jianpu(note);
    serde_wasm_bindgen::to_value(&serde_json::json!({ "candidates": candidates })).unwrap()
}
```

- [ ] **Step 2: 构建 WASM**

```bash
just build-wasm
```

Expected: `apps/web/wasm/` 更新，`taiyin_core.d.ts` 中出现 `translate_jianpu_to_jianzi`。

- [ ] **Step 3: 前端 WASM 类型同步**

检查 `apps/web/src/lib/taiyin-wasm.ts`，确保导出函数包含 `translate_jianpu_to_jianzi`。若 TypeScript 声明未自动更新，手动补充：

```typescript
export async function translateJianpuToJianzi(input: string): Promise<unknown> {
  const mod = await getWasm();
  if (!mod) return null;
  try {
    return mod.translate_jianpu_to_jianzi(input);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 运行前端测试与 TS 检查**

```bash
pnpm --filter web test
just ts-check
```

Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add crates/taiyin-core/src/wasm.rs apps/web/src/lib/taiyin-wasm.ts apps/web/wasm/
git commit -m "feat: expose translate_jianpu_to_jianzi via WASM"
```

---

### Task 4: 前端简谱翻译组件

**Files:**
- Create: `apps/web/src/components/jianpu-translator.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Test: `apps/web/src/components/__tests__/jianpu-translator.test.tsx`

- [ ] **Step 1: 创建组件**

在 `apps/web/src/components/jianpu-translator.tsx` 写入：

```tsx
import { useState } from "react";
import type { JianpuNumber, JianpuOctave, NoteColumn } from "@/lib/types";
import { jianziToText, createEmptyState } from "@/lib/types";
import { translateJianpuToJianzi } from "@/lib/taiyin-wasm";

interface Candidate {
  score: number;
  note: {
    note_type: string;
    left_finger: string | null;
    hui: { hui: number; fen: number | null } | null;
    right_action: string;
    string_number: number;
  };
}

interface JianpuTranslatorProps {
  onSelect: (column: NoteColumn) => void;
}

export function JianpuTranslator({ onSelect }: JianpuTranslatorProps) {
  const [number, setNumber] = useState<JianpuNumber | "">("");
  const [octave, setOctave] = useState<JianpuOctave>("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleTranslate() {
    if (!number) return;
    setLoading(true);
    const octaveValue = octave === "·" ? 1 : octave === "," ? -1 : 0;
    const result = (await translateJianpuToJianzi(
      JSON.stringify({ number: parseInt(number, 10), octave: octaveValue }),
    )) as { candidates: Candidate[] } | null;
    setCandidates(result?.candidates ?? []);
    setLoading(false);
  }

  function handleSelect(candidate: Candidate) {
    const note = candidate.note;
    const jianzi = createEmptyState();
    jianzi.toneType = note.note_type as "散" | "泛" | "按";
    if (note.left_finger) jianzi.leftFinger = note.left_finger;
    if (note.hui) jianzi.hui = String(note.hui.hui);
    jianzi.rightAction = note.right_action;
    jianzi.stringNumber = String(note.string_number);

    onSelect({
      id: crypto.randomUUID(),
      jianpuNumber: number || null,
      jianpuOctave: octave,
      jianpuDot: false,
      duration: "四分",
      jianzi,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={number}
          onChange={(e) => setNumber(e.target.value as JianpuNumber)}
          className="px-2 py-1 rounded border border-amber-700/20 bg-transparent text-amber-100/70"
        >
          <option value="">数字</option>
          {["1", "2", "3", "4", "5", "6", "7"].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <select
          value={octave}
          onChange={(e) => setOctave(e.target.value as JianpuOctave)}
          className="px-2 py-1 rounded border border-amber-700/20 bg-transparent text-amber-100/70"
        >
          <option value="">八度</option>
          <option value="·">高八度</option>
          <option value=",">低八度</option>
        </select>
        <button
          onClick={handleTranslate}
          disabled={!number || loading}
          className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-500 hover:text-stone-300 disabled:opacity-30"
        >
          {loading ? "翻译中…" : "翻译"}
        </button>
      </div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() => handleSelect(c)}
              className="px-2 py-1 rounded border border-amber-700/20 text-amber-100/70 hover:bg-amber-900/20"
            >
              {jianziToText({
                toneType: c.note.note_type as "散" | "泛" | "按",
                rhythmMode: null,
                leftFinger: c.note.left_finger,
                hui: c.note.hui ? String(c.note.hui.hui) : null,
                fen: null,
                rightAction: c.note.right_action,
                stringNumber: String(c.note.string_number),
              })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 集成到 page.tsx**

在 `apps/web/src/app/page.tsx` 导入组件：

```tsx
import { JianpuTranslator } from "@/components/jianpu-translator";
```

在键盘卡片 `JianzipuKeyboard` 上方插入：

```tsx
<div className="mb-4 p-3 rounded border border-amber-700/20 bg-amber-900/10">
  <p className="mb-2 text-[10px] tracking-wider text-amber-600/60">简谱转减字</p>
  <JianpuTranslator
    onSelect={(note) => {
      commitScore((prev) => [...prev, note]);
    }}
  />
</div>
```

- [ ] **Step 3: 运行前端测试**

```bash
pnpm --filter web test
just ts-check
```

Expected: 现有测试通过，TS 检查通过。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/components/jianpu-translator.tsx apps/web/src/app/page.tsx
git commit -m "feat: add JianpuTranslator component"
```

---

### Task 5: 前端组件测试

**Files:**
- Create: `apps/web/src/components/__tests__/jianpu-translator.test.tsx`

- [ ] **Step 1: 写组件测试**

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JianpuTranslator } from "../jianpu-translator";

vi.mock("@/lib/taiyin-wasm", () => ({
  translateJianpuToJianzi: vi.fn(async () => ({
    candidates: [
      {
        score: 150,
        note: {
          note_type: "散",
          left_finger: null,
          hui: null,
          right_action: "挑",
          string_number: 1,
        },
      },
    ],
  })),
}));

describe("JianpuTranslator", () => {
  it("renders inputs and translate button", () => {
    const { container } = render(<JianpuTranslator onSelect={vi.fn()} />);
    expect(container.textContent).toContain("翻译");
  });

  it("calls onSelect when clicking a candidate", async () => {
    const onSelect = vi.fn();
    const { getByText, container } = render(<JianpuTranslator onSelect={onSelect} />);

    fireEvent.change(container.querySelector("select") as HTMLSelectElement, {
      target: { value: "5" },
    });
    fireEvent.click(getByText("翻译"));

    await waitFor(() => {
      expect(getByText("散挑一")).toBeInTheDocument();
    });

    fireEvent.click(getByText("散挑一"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].jianzi.rightAction).toBe("挑");
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm --filter web test
```

Expected: 新增 2 个测试通过。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/__tests__/jianpu-translator.test.tsx
git commit -m "test: add JianpuTranslator tests"
```

---

### Task 6: 文档更新与完整 CI

**Files:**
- Modify: `CLAUDE.md`, `DEVELOPMENT_LOG.md`

- [ ] **Step 1: 更新 CLAUDE.md**

在「可核验策略」下新增「简谱转减字」小节：

```markdown
## 简谱转减字

- **规则映射**: 正调下基于音高表将简谱数字映射到候选 `GuqinNote`，支持散音、泛音。
- **候选排序**: 散音优先，其次低徽位泛音；评分机制见 `crates/taiyin-core/src/jianpu.rs`。
- **WASM 接口**: `translate_jianpu_to_jianzi` 接收 `{"number", "octave"}` JSON，返回候选列表。
- **前端入口**: `JianpuTranslator` 组件位于键盘上方，用户选择候选后通过 `onSelect` 追加到乐谱流。
- **非目标**: 多调式、按音生成、上下文优化、LLM 选择。
- **验证方法**: Rust 测试覆盖音高表与候选排序；前端测试覆盖选择回填。
```

更新测试总数为 Rust 新增数 + 前端新增数。

- [ ] **Step 2: 更新 DEVELOPMENT_LOG.md**

追加：

```markdown
## 2026-07-03

### 简谱转减字规则映射

- 新增 `JianpuNote` / `Pitch` / `ZHENG_DIAO_PITCHES` / `translate_jianpu`。
- WASM 暴露 `translate_jianpu_to_jianzi`。
- 前端新增 `JianpuTranslator` 组件，支持选择候选填入键盘。
```

- [ ] **Step 3: 跑完整 CI**

```bash
just ci
```

Expected: 全部通过。

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md DEVELOPMENT_LOG.md
git commit -m "docs: update CLAUDE.md and DEVELOPMENT_LOG for jianpu translation"
```

---

## Self-Review

1. **Spec coverage**: 正调音高表（Task 1）、候选生成排序（Task 2）、WASM 接口（Task 3）、前端 UI（Task 4）、测试（Task 5）、文档（Task 6）全部覆盖。
2. **Placeholder scan**: 无 TBD/TODO，所有代码块完整。
3. **Type consistency**: `JianpuNote` 字段 `number`/`octave` 与 WASM JSON、前端组件一致；候选 `note` 字段与 `GuqinNote` 序列化一致。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-jianpu-to-jianzi.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
