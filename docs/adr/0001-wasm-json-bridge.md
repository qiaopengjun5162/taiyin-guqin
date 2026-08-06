# ADR-0001 · WASM 桥接采用 JSON 字符串 I/O

- **状态**:已采纳(Accepted)
- **日期**:2026-08-02
- **决策人**:高级开发工程师(代码质量把控)
- **相关**:`crates/taiyin-core/src/wasm.rs`、`build-wasm`(justfile)

---

## 背景(Context)

`taiyin-core` 需通过 wasm-pack 编译为 WASM,供 Next.js 前端(`apps/web`)调用,
完成"简谱 → 减字谱候选"的翻译。核心领域类型(`JianpuNote`、`Tuning`、候选结构体)
大量使用 Rust 枚举与 newtype(`Hui` 1..=13、`StringNumber` 1..=7)。

需要决定:**WASM 边界如何把 Rust 类型暴露给 JS**。两条路:

1. **直接映射**:用 `#[wasm_bindgen]` 把结构体/枚举直接暴露为 JS 类与枚举。
2. **JSON 字符串桥接**:WASM 函数只接受/返回 JSON 字符串,由 `serde_json` 在边界做转换。

---

## 决策(Decision)

**采用 JSON 字符串桥接**。

`wasm.rs` 中所有导出函数(`translate_jianpu_to_jianzi`、
`translate_jianpu_sequence_to_jianzi`)签名均为
`(input_json: &str) -> String`,内部用 `serde_json` 反序列化入参、序列化出参。

理由:

- **边界处类型安全不丢**:Rust 侧仍用强类型 + newtype 约束(如 `Hui`/`StringNumber`),
  非法输入在 `serde_json::from_str` 阶段即被 `Err` 拦截并返回 `{"error": ...}`,
  而非在 JS 里产出错误减字。
- **避免 wasm_bindgen 对复杂枚举的脆弱映射**:`NoteType`(散/泛/按)、
  `RhythmMode`(板/散/宕)、`Tuning` 等 Rust 枚举若直曝成 wasm 枚举,
  一旦新增变体就会破坏 JS ABI;JSON 桥接让契约是**纯数据**,演化更自由。
- **前端本就 JSON 中心**:前端通过 `fetch`/`JSON.parse` 消费,无需引入 wasm 类型定义,
  调试直观(浏览器里直接看字符串)。
- **与后端契约一致**:`/api/v1/translate/select` 同样返回 JSON,
  前端对"减字候选"只有一套心智模型。

---

## 后果(Consequences)

**正面**
- 边界清晰:Rust 复杂类型永不直接泄漏到 JS,重构 Rust 内部不影响前端。
- 错误可观测:解析失败返回结构化 `{"error": "..."}`,前端可精确提示。
- 跨版本兼容:新增字段/枚举变体只要 `serde` 用 `#[serde(default)]` 即可向后兼容。

**负面 / 注意**
- 比直曝 struct 多一次 JSON 序列化开销(对"单次翻译"量级可忽略)。
- 前端需自行维护与 JSON 字段对应的 TS 类型(`apps/web/src/lib/types.ts`),
  目前靠人工对齐;后续可考虑从 Rust 生成或加契约测试(见下)。

---

## 后续(Follow-ups)

- 在 `scripts/verify-wasm.mjs` 中增加"字段契约"断言,防止 Rust 字段改名/删字段而不知。
- 评估是否从 `taiyin-core` 的 `serde` 派生自动生成前端 TS 类型,消除人工对齐成本。

---

## 参考

- `crates/taiyin-core/src/wasm.rs` —— 桥接实现
- `team-uplift-plan.md` "P2-4 重大决策写 ADR" —— 本决策的来源诉求
