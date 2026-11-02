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

/** 应用定弦标识 → 翻译器调式。 */
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
