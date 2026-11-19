/**
 * 减字 → 音高推算。
 *
 * 由减字状态（弦序 + 徽位 + 分 + 音色）反推实际振动频率与简谱唱名，
 * 供「AI 识别 → 点听 / 导入为可演奏曲谱」使用。
 *
 * 空弦音来自 `tuning.ts` 的定弦表（正调 / 蕤宾调 / 慢角调），
 * 再乘以基准音频率——两者是独立维度：定弦决定弦间音程，基准音决定整体高低。
 *
 * 物理模型（以该定弦的空弦频率为基准）：
 * - 散音：直接取空弦频率。
 * - 按音：在距岳山 p（按弦点占全弦比例）处按实，有效弦长为 (1−p)，
 *         频率 = 空弦 / (1−p)。
 * - 泛音：轻触谐波节点，频率为谐波次数 n × 空弦；n 由按弦点 p 的最简分数
 *         分母决定（七徽 1/2→2 次，五/九徽 1/3→3 次，四/十徽 1/4→4 次，…）。
 *   注意：不能用 open/p 表示泛音（九徽 p=2/3 时 open/p 仅为 1.5 次，错误），
 *         正确做法是取谐波次数 n × 空弦。
 */

import type { JianziState, JianpuNumber, JianpuOctave } from "./types";
import { CONCERT_PITCH_DEFAULT } from "./concert-pitch";
import { DEFAULT_TUNING, type TuningId } from "./tuning";
import { getWasmSync, isWasmReady } from "./taiyin-wasm";

/** 推算用的上下文：用哪种定弦、A4 定到多少。 */
export interface PitchContext {
  tuning?: TuningId;
  concertPitch?: number;
}

/** 十三徽距岳山的比例（p，占全弦长）。 */
const HUI_FRACTION: Record<number, number> = {
  1: 1 / 8,
  2: 1 / 6,
  3: 1 / 5,
  4: 1 / 4,
  5: 1 / 3,
  6: 2 / 5,
  7: 1 / 2,
  8: 3 / 5,
  9: 2 / 3,
  10: 3 / 4,
  11: 4 / 5,
  12: 5 / 6,
  13: 7 / 8,
};

/** 各徽对应的泛音谐波次数（p 最简分数之分母）。 */
const HUI_HARMONIC: Record<number, number> = {
  1: 8,
  2: 6,
  3: 5,
  4: 4,
  5: 3,
  6: 5,
  7: 2,
  8: 5,
  9: 3,
  10: 4,
  11: 5,
  12: 6,
  13: 8,
};

/**
 * 简谱唱名 → 相对宫音（1=F）的半音偏移。**全项目唯一来源**。
 *
 * Rust `jianpu.rs::DEGREE_SEMITONES` 与它同源，由
 * `scripts/verify-domain-contracts.mjs` 做跨语言静态比对；播放用的
 * `player.ts::SEMITONES` 与示例谱一致性测试都从这里派生，别再抄第二份。
 */
export const JIANPU_DEGREES: readonly [JianpuNumber, number][] = [
  ["1", 0], ["2", 2], ["3", 4], ["4", 5], ["5", 7], ["6", 9], ["7", 11],
];

/**
 * 徽位 → 该处轻触得到的泛音谐波次数（一徽 8 次、七徽 2 次…）。
 *
 * 对外暴露是因为「琴面音位全览」也要用同一张表：图上标的泛音若与
 * 点下去听到的次数不一致，那张图就只是装饰。非法徽位返回 null。
 */
export function huiHarmonic(hui: number): number | null {
  return HUI_HARMONIC[hui] ?? null;
}

/** 中文数字徽位 → 整数（支持 一～十三）。 */
export function chineseNumToHui(hui: string | null): number | null {
  if (!hui) return null;
  const map: Record<string, number> = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
  };
  if (hui === "十") return 10;
  if (hui.startsWith("十") && hui.length === 2) {
    const d = map[hui[1]];
    return d != null ? 10 + d : null; // 十一/十二/十三
  }
  let n = 0;
  for (const ch of hui) {
    const v = map[ch];
    if (v == null) return null;
    n += v;
  }
  return n > 0 && n <= 13 ? n : null;
}

/** 分位 → 占相邻两徽间隔的比例（三分→0.3，六分→0.6，半→0.5）。 */
function fenToFraction(fen: string | null): number {
  if (!fen) return 0;
  if (fen === "半") return 0.5;
  const map: Record<string, number> = {
    "一分": 0.1, "二分": 0.2, "三分": 0.3, "四分": 0.4, "五分": 0.5,
    "六分": 0.6, "七分": 0.7, "八分": 0.8, "九分": 0.9,
  };
  return map[fen] ?? 0;
}

/**
 * 由徽位 + 分位计算按弦点占全弦比例 p。
 * 分位在两徽之间线性内插（向龙龈方向 p 增大）；十三徽外推用上一间隔。
 */
export function huiFraction(hui: number, fen: string | null): number | null {
  const base = HUI_FRACTION[hui];
  if (base == null) return null;
  const f = fenToFraction(fen);
  if (f === 0) return base;
  if (hui < 13) {
    const next = HUI_FRACTION[hui + 1];
    return base + f * (next - base);
  }
  const prev = HUI_FRACTION[12];
  const step = base - prev; // 上一间隔长度（正）
  return base + f * step;
}

/**
 * 减字状态 → Rust 的 `PitchQuery`。
 *
 * 分位在核心侧用「占相邻两徽间隔的比例」表示（三分 = 0.3、半 = 0.5），
 * 所以这里先换成数字再送过去——**换算规则仍与 `fenToFraction` 一致**，
 * 它同时也是本文件 `huiFraction` 用的那份。
 */
function toWireQuery(state: JianziState) {
  const huiNum = state.hui ? chineseNumToHui(state.hui) : null;
  return {
    stringNumber: state.stringNumber
      ? "一二三四五六七".indexOf(state.stringNumber) + 1
      : 0,
    toneType: state.toneType ?? "",
    hui: huiNum,
    fenFraction: state.fen ? fenToFraction(state.fen) : null,
  };
}

/** 定弦标识 → Rust 的 `Tuning`；核心只建模前三种，其余回落到正调。 */
function wireTuning(tuning: TuningId): string {
  return tuning === "ruibin" || tuning === "manjiao" ? tuning : "zhengdiao";
}

/**
 * 减字状态 → 实际振动频率 (Hz)；无法推算返回 null。
 *
 * ## 物理模型只在 Rust 一份（2026-11-18 迁入 `crates/taiyin-core/src/pitch.rs`）
 *
 * 同一个减字在网页、小程序、App 上必须算出同一个音高——差半音就是另一个音，
 * 且不会报错。这里只负责把状态打包成 JSON，算在核心里。
 *
 * ## 引擎未就绪时返回 null
 *
 * 不退回本地估算：**一个错的音高比没有音高更糟**。用户不会去核对，
 * 只会照着一个错音练。null 会让调用方显示「推不出音高」，那是诚实的。
 */
export function jianziToFrequency(state: JianziState, ctx: PitchContext = {}): number | null {
  if (!state.stringNumber || !state.toneType) return null;
  if (!isWasmReady()) return null;
  const parsed = JSON.parse(
    getWasmSync().jianzi_pitch(
      JSON.stringify({
        ...toWireQuery(state),
        tuning: wireTuning(ctx.tuning ?? DEFAULT_TUNING),
        concertPitch: ctx.concertPitch ?? CONCERT_PITCH_DEFAULT,
      }),
    ),
  ) as { frequency?: number | null; error?: string };
  if (parsed.error) return null;
  return typeof parsed.frequency === "number" ? parsed.frequency : null;
}

/**
 * 频率 → 最接近的可表示简谱唱名（1=F 记谱）。
 *
 * 实现同样在核心：构造一个「散音、绝对 MIDI」的伪查询不现实，
 * 所以这里直接换算频率 → 简谱级数与八度。
 *
 * 基准与 `jianpuToMidi` 同一套：未标记八度的「1」= F2（MIDI 41，正调三弦）。
 * 古琴低音区（一～三弦空弦）落在低八度记号，中高音区（四五弦、按音/泛音）
 * 落在无记号或高八度记号。搜索范围在 ±2 八度（可表示记号的上限）；
 * 超出窗口的音高（如七弦一徽泛音 D6）会吸附到最近的边界记号——纯显示用途，
 * 不影响播放（播放以减字为准）。
 *
 * ## 为什么这段留在前端
 *
 * 它是「MIDI → 唱名」的**纯查表**，不含物理模型，也不产生跨端分歧：
 * 网页和小程序各自查同一张 `JIANPU_DEGREES` 表（该表本身由
 * `scripts/verify-domain-contracts.mjs` 与 Rust `DEGREE_SEMITONES` 逐项比对）。
 * 把这条也搬进核心，收益是消灭 20 行查表，代价是多一次 WASM 往返——
 * 而它被谱面渲染路径逐音调用。
 */
export function frequencyToJianpu(
  freq: number,
  concertPitch: number = CONCERT_PITCH_DEFAULT,
): { number: JianpuNumber; octave: JianpuOctave } | null {
  if (!isFinite(freq) || freq <= 0) return null;
  const targetMidi = 69 + 12 * Math.log2(freq / concertPitch);
  // 1=F 基准：未标记「1」= F2 = MIDI 41，与 player.jianpuToMidi 一致。
  const BASE_MIDI = 41;
  const offsets: JianpuOctave[] = ["", "·", "··", ",", ",,"];
  let bestNum: JianpuNumber = "1";
  let bestOct: JianpuOctave = "";
  let bestErr = Infinity;
  for (const [num, s] of JIANPU_DEGREES) {
    for (const o of offsets) {
      const off =
        o === "·" ? 12 : o === "··" ? 24 : o === "," ? -12 : o === ",," ? -24 : 0;
      const err = Math.abs(targetMidi - (BASE_MIDI + s + off));
      if (err < bestErr) {
        bestErr = err;
        bestNum = num;
        bestOct = o;
      }
    }
  }
  return { number: bestNum, octave: bestOct };
}

/** 减字状态 → 最接近的可表示简谱唱名；无法推算返回 null。 */
export function jianziToJianpu(
  state: JianziState,
  ctx: PitchContext = {},
): { number: JianpuNumber; octave: JianpuOctave } | null {
  const freq = jianziToFrequency(state, ctx);
  if (freq == null) return null;
  return frequencyToJianpu(freq, ctx.concertPitch ?? CONCERT_PITCH_DEFAULT);
}
