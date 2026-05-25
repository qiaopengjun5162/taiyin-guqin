/**
 * 拼音 → 减字部首查询字典
 *
 * 通过前缀匹配实现"打 d 提示'大'"的效果。
 * 后续可编译进 Rust WASM 内核，前端仅做渲染。
 */

/** 拼音 → 候选词列表映射 */
const PINYIN_MAP: Record<string, string[]> = {
  // ── 左手指法 ──
  d: ["大"],
  da: ["大", "丁"],
  da4: ["大"],
  xi: ["夕", "名"],
  xi4: ["夕"],
  ming: ["名"],
  ming2: ["名"],
  zhong: ["中"],
  zhong1: ["中"],
  shi: ["食", "尸"],
  shi2: ["食", "十"],
  gui: ["跪"],
  gui4: ["跪"],

  // ── 右手指法 ──
  tuo: ["乇"],
  tuo1: ["乇"],
  bo: ["尸", "擘"],
  bo4: ["尸"],
  pi: ["尸", "劈"],
  pi1: ["尸"],
  pi3: ["劈"],
  mo: ["木"],
  mo4: ["木"],
  tiao: ["乚"],
  tiao3: ["乚"],
  gou: ["勹"],
  gou1: ["勹"],
  ti: ["剔"],
  ti1: ["剔"],
  da3: ["丁"],
  zhai: ["倽"],
  zhai1: ["倽"],
  zhai2: ["摘"],

  // ── 徽位 ──
  yi: ["一"],
  er: ["二"],
  san: ["三"],
  si: ["四"],
  wu: ["五"],
  liu: ["六"],
  qi: ["七"],
  ba: ["八"],
  jiu: ["九"],

  // ── 弦序 ──
  xian: ["一", "二", "三", "四", "五", "六", "七"],
  xian1: ["一"],

  // ── 音色 ──
  san4: ["散"],
  fan: ["泛"],
  fan4: ["泛"],
  an: ["按"],
  an4: ["按"],

  // ── 节奏 ──
  ban: ["板"],
  ban3: ["板"],
  san3: ["散"],
  dang: ["宕"],
  dang4: ["宕"],
};

/** 根据输入前缀查找匹配的候选词 */
export function lookupPinyin(prefix: string): string[] {
  if (!prefix) return [];
  const p = prefix.toLowerCase();
  const results = new Set<string>();
  for (const [key, values] of Object.entries(PINYIN_MAP)) {
    if (key.startsWith(p)) {
      for (const v of values) results.add(v);
    }
  }
  return [...results];
}

/** 判断字符串是否包含拼音（含字母） */
export function isPinyin(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}

/** 简谱数字映射 */
const JIANPU_MAP: Record<string, string> = {
  yi: "1",
  er: "2",
  san: "3",
  si: "4",
  wu: "5",
  liu: "6",
  qi: "7",
};

/** 尝试将拼音 token 转为简谱数字 */
export function pinyinToJianpu(pinyin: string): string | null {
  return JIANPU_MAP[pinyin.toLowerCase()] ?? null;
}
