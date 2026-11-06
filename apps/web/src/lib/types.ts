/// <reference types="react" />

/** 音色类型——散音（空弦）、泛音、按音（按弦）。 */
export type NoteType = "散" | "泛" | "按";

/** 节奏模式——决定时值的解释方式。 */
export type RhythmMode = "板" | "散" | "宕";

/**
 * 会改变音高走向的两个记号 —— 只有它们走「滑音」合成分支。
 * 单独拎出来是因为「急」不会让音高滑动，混进来会把急弹当注音弹。
 */
export type PitchSlide = "绰" | "注";

/**
 * 谱字上的装饰记号——字体把它们压在同一个槽位里（徽分之后、右手指法之前），
 * 所以同一个谱字只能带一个，互斥。
 *
 * - 绰：从本位**下方**滑上来，落在减字标注的徽位上（本位是终点）。
 * - 注：从本位**上方**滑下来。
 * - 急：急弹记号，标的是「这一声弹得急促」，不改音高。
 *
 * 绰/注 改变的是音高走向，不是装饰：同一谱字有没有绰，弹出来是两回事。
 * 只有按音能有这几样——散音是空弦、泛音要虚按在徽位节点上，都滑不了。
 */
export type SlideMark = PitchSlide | "急";

/** 减字键盘状态——一个正在拼装中的谱字。 */
export interface JianziState {
  toneType: NoteType | null;
  rhythmMode: RhythmMode | null;
  leftFinger: string | null;
  hui: string | null;
  fen: string | null;
  /** 装饰记号（绰/注/急）；写在分数之后、右手指法之前——字体连字规则要求如此。 */
  slide: SlideMark | null;
  rightAction: string | null;
  stringNumber: string | null;
}

/** 键盘配置：每个分区可选的按键列表。 */
export interface KeyboardConfig {
  toneTypes: NoteType[];
  rhythmModes: RhythmMode[];
  leftFingers: string[];
  huiPositions: string[];
  fenOptions: string[];
  slides: SlideMark[];
  rightActions: string[];
  stringNumbers: string[];
}

/**
 * 预设：古琴正调标准按键。
 *
 * 左手指法采用传统减字偏旁写法：
 * - 亻 = 食指（取"食"的左半）
 * - 夕 = 名指（取"名"的左半）
 *
 * 节奏模式：
 * - 板 = 严格节拍（入拍）
 * - 散 = 自由节奏（散板/入乱）
 * - 宕 = 跌宕（变换拍子）
 */
export const DEFAULT_KEYBOARD: KeyboardConfig = {
  toneTypes: ["散", "泛", "按"],
  rhythmModes: ["板", "散", "宕"],
  leftFingers: ["大", "夕", "中", "亻", "跪"],
  huiPositions: [
    "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
    // 古琴共十三徽。十一～十三徽在《流水》《潇湘水云》等曲里很常见，
    // 原先键盘只到「十」，这些音根本录不进去。
    "十一", "十二", "十三",
  ],
  // 徽位之间的微分：一分～九分，另加「半」（正中间）。
  // 减字里分数只写数字，序列化时由 jianziToText 去掉「分」字。
  fenOptions: [
    "一分", "二分", "三分", "四分", "五分",
    "六分", "七分", "八分", "九分", "半",
  ],
  // 装饰记号：绰（下方向上滑到本位）、注（上方向下滑到本位）、急（急弹）。
  // 字体把它们压进同一个槽位，所以三选一；顺序同样有硬要求——分数在前、记号在后。
  slides: ["绰", "注", "急"],
  // 传统减字偏旁写法：乇=托 尸=劈/擘 木=抹 乚=挑 勹=勾 剔 丁=打 倽=摘
  // 复合指法（双指法连字）：字体 GSUB 原生支持 抹挑/勾剔/抹勾/打摘
  // （"仰托"字体无连字规则，仅解析器容错支持，不提供录入）
  rightActions: ["乇", "尸", "木", "乚", "勹", "剔", "丁", "倽",
    "抹挑", "勾剔", "抹勾", "打摘"],
  stringNumbers: ["一", "二", "三", "四", "五", "六", "七"],
};

// ──────────────────────────────────────────────
// 乐谱流类型
// ──────────────────────────────────────────────

/** 简谱数字（0 为休止符） */
export type JianpuNumber = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7";

/** 时值 */
export type Duration = "全" | "二分" | "四分" | "八分" | "十六分";

/** 简谱八度标记：· 高八度，, 低八度 */
export type JianpuOctave = "" | "·" | "··" | "," | ",,";

/** 单个复合音符列 —— 简谱 + 减字 + 时值的垂直组合 */
/**
 * 联袂指法：两声以上成组、音高相同（放合可差八度）的左右手配合。
 *
 * 四种指法的结构并不一样，这里只承载"成组关系"，具体差异由库函数解释：
 * - 分开：首尾同度，中间是走手虚音，整体占**一个**简谱位置
 * - 同声：两声**同时**发声（左指带起 + 右弹空弦）
 * - 应合：散音连着弹，左指走手去合，通常二声以上
 * - 放合：相邻弦，同度**或八度**
 */
export type LianmeiKind = "分开" | "同声" | "应合" | "放合";

/**
 * 一条联袂关系。
 *
 * 组内每个音都带这个字段，靠 `headId` 归组；组首的 `headId` 等于自己的 id。
 * 用 id 而不是下标，是因为删音/重排之后下标会整体前移，按下标存的组会散掉。
 * 相邻性不在这里保证——由 `normalizeLianmei` 兜（中间插了别的音就解组）。
 */
export interface LianmeiLink {
  kind: LianmeiKind;
  headId: string;
}

export interface NoteColumn {
  id: string;
  jianpuNumber: JianpuNumber | null;
  jianpuOctave: JianpuOctave;
  jianpuDot: boolean;
  duration: Duration;
  jianzi: JianziState;
  /** 歌词字（可选，按字对齐到音符下方；器乐段留空） */
  lyric?: string;
  /** 联袂关系（可选）；不在任何联袂里就不设这个字段 */
  lianmei?: LianmeiLink;
}

/** 默认简谱数字列表 */
export const DEFAULT_JIANPU_NUMBERS: JianpuNumber[] = [
  "1", "2", "3", "4", "5", "6", "7",
];

/** 默认时值列表 */
export const DEFAULT_DURATIONS: Duration[] = [
  "全", "二分", "四分", "八分", "十六分",
];
