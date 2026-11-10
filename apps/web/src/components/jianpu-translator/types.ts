import type { NoteColumn } from "@/lib/types";
import type { TuningId } from "@/lib/tuning";

export interface JianpuTranslatorProps {
  onSelect: (columns: NoteColumn[]) => void;
}

export type InputMode = "single" | "sequence";

export type Tuning = "zheng" | "ruibin" | "manjiao";

export const TUNING_OPTIONS: { value: Tuning; label: string }[] = [
  { value: "zheng", label: "正调" },
  { value: "ruibin", label: "蕤宾调" },
  { value: "manjiao", label: "慢角调" },
];

/**
 * 翻译器调式（Rust wire 值）→ 应用定弦标识。
 *
 * 两套命名是历史原因：WASM 接口用 `zheng/ruibin/manjiao`，本机定弦存储用
 * `zhengdiao/...`。候选卡片要按定弦算实际音高（试听、弦名），必须能对上。
 */
export const TUNING_TO_ID: Record<Tuning, TuningId> = {
  zheng: "zhengdiao",
  ruibin: "ruibin",
  manjiao: "manjiao",
};

/**
 * 编排引擎支持的定弦。
 *
 * WASM 候选生成只建模「1=F 清乐七声」的简谱（见 Rust `jianpu.rs::Tuning`）：
 * 输入是「数字 + 八度」，没有升降号。清商 / 太簇 / 凄凉的空弦含 D♯、F♯，
 * 这套记谱写不出来，所以它们只用于存谱、调音、播放，不进编排。
 * `scripts/verify-tuning-contract.mjs` 会核对这份名单与 `TUNING_OPTIONS` 一致。
 */
export const ARRANGEMENT_TUNING_IDS: readonly TuningId[] = [
  "zhengdiao",
  "ruibin",
  "manjiao",
];

export function isArrangementTuning(id: TuningId): boolean {
  return ARRANGEMENT_TUNING_IDS.includes(id);
}

/**
 * 应用定弦标识 → 翻译器调式。
 *
 * 后三种外调没有对应的编排调式，这里返回正调**只作为下拉的默认值**：
 * 调用方必须先用 `isArrangementTuning` 判断并显示可见提示，
 * 不能把它当成无声的降级——否则编排按正调、播放按外调，弹出来差半音。
 */
export function tuningFromId(id: TuningId): Tuning {
  return id === "ruibin" ? "ruibin" : id === "manjiao" ? "manjiao" : "zheng";
}

// WASM 真实契约：note_type 序列化为中文（散/泛/按），left_finger/right_action 为 Rust 枚举名
const TONE_TYPES = ["散", "泛", "按"] as const;
type ToneType = (typeof TONE_TYPES)[number];

export function parseToneType(value: string): ToneType | null {
  return (TONE_TYPES as readonly string[]).includes(value)
    ? (value as ToneType)
    : null;
}

const CHINESE_DIGITS = [
  "",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
];

export function toChineseNumber(n: number): string {
  if (n <= 10) return CHINESE_DIGITS[n];
  if (n <= 13) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    if (tens === 1) return `十${CHINESE_DIGITS[ones]}`;
    return `${CHINESE_DIGITS[tens]}十${CHINESE_DIGITS[ones]}`;
  }
  return String(n);
}
