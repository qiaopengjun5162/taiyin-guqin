/**
 * 减字结构 ↔ 可读中文的映射与格式化。
 *
 * 移植自 web 端 `candidate.ts` / `types.ts`，保证小程序与网页对同一个
 * WASM 候选的解释完全一致（弦/徽/指法的中文标签、分数写法）。
 * 本文件是**纯逻辑、零小程序 API 依赖**，可被 Node 校验脚本直接 require。
 */

// Rust 枚举名 → 中文指法标签（左手）
const LEFT_FINGER_MAP = {
  Da: "大",
  Ming: "夕",
  Zhong: "中",
  Shi: "亻",
  Gui: "跪",
};

// Rust 枚举名 → 中文指法标签（右手）
const RIGHT_ACTION_MAP = {
  Tiao: "乚",
  Gou: "勹",
  Mo: "木",
  Ti: "剔",
  Tuo: "乇",
  Bo: "尸",
  Da: "丁",
  Zhai: "倽",
};

// 徽位「分」数值 → 中文（fen === 5 特例为「半」）
const FEN_MAP = {
  3: "三分",
  6: "六分",
  8: "八分",
};

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

/** 1-13 → 中文数字（弦 1-7、徽 1-13 都用它）。 */
function toChineseNumber(n) {
  if (typeof n !== "number" || isNaN(n)) return String(n == null ? "" : n);
  if (n <= 10) return CHINESE_DIGITS[n] || String(n);
  if (n <= 13) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    if (tens === 1) return `十${CHINESE_DIGITS[ones]}`;
    return `${CHINESE_DIGITS[tens]}十${CHINESE_DIGITS[ones]}`;
  }
  return String(n);
}

/**
 * 把一个 WASM 候选的 note 结构转成可读展示对象。
 * note 字段（来自 translate_jianpu_to_jianzi）：
 *   note_type: "散" | "泛" | "按"（已是中文）
 *   left_finger: Rust 枚举名（可空）
 *   hui: { hui: number, fen: number | null }（可空）
 *   right_action: Rust 枚举名
 *   string_number: number（1-7）
 */
function buildCandidateDisplay(note) {
  if (!note) return null;
  const display = {
    toneType: note.note_type || "",
    leftFinger: note.left_finger
      ? LEFT_FINGER_MAP[note.left_finger] || note.left_finger
      : "",
    rightAction: note.right_action
      ? RIGHT_ACTION_MAP[note.right_action] || note.right_action
      : "",
    stringText: note.string_number != null ? `${toChineseNumber(note.string_number)}弦` : "",
    huiText: "",
  };
  if (note.hui) {
    // 顺序必须是「徽在前、分在后」：九徽六分。
    // 曾把 fen 拼在「徽」之前，输出「九六分徽」——不报错，但读起来是错的指法。
    const base = toChineseNumber(note.hui.hui);
    const fen = note.hui.fen;
    let fenText = "";
    if (fen != null) {
      fenText = fen === 5 ? "半" : FEN_MAP[fen] || `${fen}分`;
    }
    display.huiText = base ? `${base}徽${fenText}` : "";
  }
  return display;
}

/**
 * 把候选 note 压成一行可读文本，如「按音 · 三弦九徽六分 · 大指勾」。
 * 用于卡片副标题与分享/复制。
 */
function candidateToLine(note) {
  const d = buildCandidateDisplay(note);
  if (!d) return "";
  const parts = [];
  if (d.toneType) parts.push(d.toneType);
  if (d.stringText || d.huiText) {
    parts.push([d.stringText, d.huiText].filter(Boolean).join(""));
  }
  if (d.leftFinger) parts.push(`${d.leftFinger}指`);
  if (d.rightAction) parts.push(d.rightAction);
  return parts.join(" · ");
}

// decode_jianzi_batch 返回 entries: [{ code, state, error }]。
// state 的形状随码而定（可能是归一化结构或字符串），这里做**通用**展示，
// 不假设具体字段，从而对新码表也鲁棒。
const STATE_LABELS = {
  toneType: "音色",
  leftFinger: "左手",
  rightAction: "右手",
  stringNumber: "弦",
  hui: "徽",
  fen: "分",
  slide: "走手",
};

function displayDecodeState(state) {
  if (state == null) return "";
  if (typeof state === "string") return state;
  if (typeof state !== "object") return String(state);
  const parts = [];
  const keys = Object.keys(state);
  for (const k of keys) {
    const v = state[k];
    if (v == null || v === "") continue;
    const label = STATE_LABELS[k] || k;
    parts.push(`${label}:${v}`);
  }
  return parts.join(" ");
}

module.exports = {
  LEFT_FINGER_MAP,
  RIGHT_ACTION_MAP,
  FEN_MAP,
  CHINESE_DIGITS,
  toChineseNumber,
  buildCandidateDisplay,
  candidateToLine,
  displayDecodeState,
};
