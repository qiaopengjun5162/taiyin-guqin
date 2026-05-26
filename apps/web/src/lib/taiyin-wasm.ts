/**
 * taiyin-core WASM 桥接 —— 动态加载封装。
 *
 * WASM 模块需要在客户端动态加载（Next.js SSR 下不可用）。
 * 所有函数接收和返回 JSON 字符串，通过 serde 序列化桥接。
 *
 * 使用示例：
 * ```ts
 * import { createOpenStringNote } from "@/lib/taiyin-wasm";
 *
 * const json = await createOpenStringNote("挑", 5);
 * // json = '{"note_type":"散",...}'
 * ```
 *
 * 如果 WASM 尚未加载（首次调用），会自动初始化。
 */

// NOTE: 保持类型定义与 wasm/Cargo.toml 中 wasm.rs 的导出签名一致。
// 重新构建 WASM 后需手动同步类型。

interface WasmModule {
  parse_note(json: string): string;
  parse_score(json: string): string;
  create_open_string_note(right_action: string, string_number: number): string;
  create_pressed_note(
    left_finger: string,
    hui: number,
    fen: number | null,
    right_action: string,
    string_number: number,
  ): string;
  create_fan_yin_note(
    left_finger: string,
    hui: number,
    fen: number | null,
    right_action: string,
    string_number: number,
  ): string;
  create_score(title: string, author: string): string;
}

let instance: WasmModule | null = null;

async function getWasm(): Promise<WasmModule> {
  if (instance) return instance;
  // 动态导入 JS glue 代码（通过 @/wasm/ 别名解析到 wasm/taiyin_core.js）
  const mod = await import("@/wasm/taiyin_core");
  // 默认导出是 __wbg_init，接受可选的 path/URL 参数
  // 不传参时默认使用 import.meta.url + 'taiyin_core_bg.wasm'，
  // 但在 Next.js 打包后 import.meta.url 指向 chunk URL，路径解析会错误。
  // 因此显式传入通过 public/ 静态服务的 .wasm 文件 URL。
  // __wbg_init accepts { module_or_path: ... } | InitInput | Promise<InitInput>
  await (mod.default as (path: string) => Promise<unknown>)("/wasm/taiyin_core_bg.wasm");
  instance = mod as unknown as WasmModule;
  return instance;
}

// ── 导出函数（客户端可用） ──

export async function parseNote(json: string): Promise<string> {
  const wasm = await getWasm();
  return wasm.parse_note(json);
}

export async function parseScore(json: string): Promise<string> {
  const wasm = await getWasm();
  return wasm.parse_score(json);
}

export async function createOpenStringNote(
  rightAction: string,
  stringNumber: number,
): Promise<string> {
  const wasm = await getWasm();
  return wasm.create_open_string_note(rightAction, stringNumber);
}

export async function createPressedNote(
  leftFinger: string,
  hui: number,
  fen: number | null,
  rightAction: string,
  stringNumber: number,
): Promise<string> {
  const wasm = await getWasm();
  return wasm.create_pressed_note(leftFinger, hui, fen, rightAction, stringNumber);
}

export async function createFanYinNote(
  leftFinger: string,
  hui: number,
  fen: number | null,
  rightAction: string,
  stringNumber: number,
): Promise<string> {
  const wasm = await getWasm();
  return wasm.create_fan_yin_note(leftFinger, hui, fen, rightAction, stringNumber);
}

export async function createScore(title: string, author: string): Promise<string> {
  const wasm = await getWasm();
  return wasm.create_score(title, author);
}
