import type { NoteColumn, JianziState, JianpuNumber, JianpuOctave, Duration } from "./types";

export interface ExampleScore {
  id: string;
  title: string;
  description: string;
  notes: NoteColumn[];
}

function makeJianzi(
  toneType: JianziState["toneType"],
  rightAction: string,
  stringNumber: string,
  leftFinger: string | null = null,
  hui: string | null = null,
  fen: string | null = null,
): JianziState {
  return {
    toneType,
    rhythmMode: null,
    leftFinger,
    hui,
    fen,
    rightAction,
    stringNumber,
  };
}

function makeNote(
  jianpuNumber: JianpuNumber,
  jianpuOctave: JianpuOctave,
  jianzi: JianziState,
  duration: Duration = "四分",
  jianpuDot: boolean = false,
): NoteColumn {
  return {
    id: crypto.randomUUID(),
    jianpuNumber,
    jianpuOctave,
    jianpuDot,
    duration,
    jianzi,
  };
}

/**
 * 预置示例曲谱片段。
 *
 * 数据为展示用，优先保证减字渲染正确与旋律可辨识，
 * 不追求与某一流派指法完全一致。
 */
export const EXAMPLE_SCORES: ExampleScore[] = [
  {
    id: "canghaixiaoxiao",
    title: "沧海一声笑（片段）",
    description: "全散音旋律，适合熟悉弦序与空弦音",
    notes: [
      // 6 5 3 5
      makeNote("6", "", makeJianzi("散", "乚", "二")),
      makeNote("5", "", makeJianzi("散", "乚", "一")),
      makeNote("3", "", makeJianzi("散", "乚", "五")),
      makeNote("5", "", makeJianzi("散", "乚", "一")),
      // 3 2 1 6,
      makeNote("3", "", makeJianzi("散", "乚", "五")),
      makeNote("2", "", makeJianzi("散", "乚", "四")),
      makeNote("1", "", makeJianzi("散", "乚", "三")),
      makeNote("6", ",", makeJianzi("散", "乚", "二")),
    ],
  },
  {
    id: "xianwencao",
    title: "仙翁操（片段）",
    description: "散音与按音交替，体验走手音",
    notes: [
      // 5 3 1
      makeNote("5", "", makeJianzi("散", "乚", "六")),
      makeNote("3", "", makeJianzi("散", "乚", "五")),
      makeNote("1", "", makeJianzi("按", "乚", "三", "大", "九")),
      // 2 3 5 —
      makeNote("2", "", makeJianzi("按", "乚", "四", "大", "九")),
      makeNote("3", "", makeJianzi("散", "乚", "五")),
      makeNote("5", "", makeJianzi("散", "勾", "六")),
      makeNote("5", "", makeJianzi("散", "乚", "六")),
    ],
  },
  {
    id: "huafeihua",
    title: "花非花（片段）",
    description:
      "词：[唐]白居易；曲：黄自；徐波编配。1=C、4/4、中慢速。" +
      "数据参考杨青《古琴弹奏经典歌曲三十首》（人民音乐出版社）。" +
      "按音指法取通用指法以保证可演奏性，不保证与原谱指法完全一致。",
    notes: [
      // ── 引子（散板记谱，按 4 拍估时）──
      // (5)
      makeNote("5", "", makeJianzi("散", "勹", "六"), "全"),

      // ── 前奏 ──
      // (6 5 3)
      makeNote("6", "", makeJianzi("按", "乚", "一", "大", "七")),
      makeNote("5", "", makeJianzi("散", "勹", "六")),
      makeNote("3", "", makeJianzi("散", "乚", "五")),
      // (2 5)
      makeNote("2", "", makeJianzi("按", "勹", "四", "大", "九")),
      makeNote("5", "", makeJianzi("散", "勹", "六")),
      // (6)
      makeNote("6", "", makeJianzi("散", "勹", "二")),
      // (2 3 1 -)
      makeNote("2", "", makeJianzi("按", "勹", "四", "大", "九")),
      makeNote("3", "", makeJianzi("散", "乚", "五")),
      makeNote("1", "", makeJianzi("散", "勹", "五"), "二分"),

      // ── 第一段歌词：花非花 雾非雾 ──
      // (6 5 5 3)
      makeNote("6", "", makeJianzi("按", "乚", "一", "大", "七")),
      makeNote("5", "", makeJianzi("散", "木", "六")),
      makeNote("5", "", makeJianzi("散", "乚", "六")),
      makeNote("3", "", makeJianzi("散", "木", "五")),
      // (1 5 2 1 6 -)
      makeNote("1", "·", makeJianzi("按", "乚", "五", "大", "九")),
      makeNote("5", "·", makeJianzi("散", "乚", "六")),
      makeNote("2", "·", makeJianzi("按", "乚", "四", "大", "九")),
      makeNote("1", "·", makeJianzi("散", "勹", "五")),
      makeNote("6", "·", makeJianzi("散", "勹", "二")),
      makeNote("5", "", makeJianzi("散", "乚", "六"), "二分"),

      // ── 第二段歌词：夜半来 天明去 ──
      // (5 5 1 6. 5)
      makeNote("5", "", makeJianzi("散", "乚", "六")),
      makeNote("5", "", makeJianzi("散", "乚", "六")),
      makeNote("1", "·", makeJianzi("按", "乚", "五", "大", "九")),
      makeNote("6", "·", makeJianzi("散", "勹", "二"), "四分", true),
      makeNote("5", "·", makeJianzi("散", "勹", "六")),
      // (3 2 1 2 -)
      makeNote("3", "", makeJianzi("散", "勹", "五")),
      makeNote("2", "·", makeJianzi("按", "乚", "四", "大", "九")),
      makeNote("1", "·", makeJianzi("散", "勹", "五")),
      makeNote("2", "·", makeJianzi("按", "乚", "四", "大", "九")),
      makeNote("1", "·", makeJianzi("散", "勹", "五"), "二分"),

      // ── 第三段：来如春梦 不多时 去似朝云 无觅处 ──
      // (2 3 5 6 5)
      makeNote("2", "", makeJianzi("按", "勹", "四", "大", "九")),
      makeNote("3", "", makeJianzi("散", "丁", "五")),
      makeNote("5", "", makeJianzi("散", "乚", "六")),
      makeNote("6", "", makeJianzi("散", "勹", "二")),
      makeNote("5", "", makeJianzi("散", "勹", "六")),
      // (5 2 1 6 -)
      makeNote("5", "", makeJianzi("散", "勹", "六")),
      makeNote("2", "·", makeJianzi("按", "勹", "四", "大", "九")),
      makeNote("1", "·", makeJianzi("散", "勹", "五")),
      makeNote("6", "·", makeJianzi("散", "勹", "二")),
      makeNote("5", "·", makeJianzi("散", "勹", "六"), "二分"),
      // (1 5 3 1 5 2)
      makeNote("1", "·", makeJianzi("按", "乚", "五", "大", "九")),
      makeNote("5", "·", makeJianzi("散", "乚", "六")),
      makeNote("3", "·", makeJianzi("散", "乚", "五")),
      makeNote("1", "·", makeJianzi("散", "勹", "五")),
      makeNote("5", "·", makeJianzi("散", "乚", "六")),
      makeNote("2", "·", makeJianzi("按", "乚", "四", "大", "九")),
      // (6 2 3 1 -)
      makeNote("6", "·", makeJianzi("散", "勹", "二")),
      makeNote("2", "·", makeJianzi("按", "勹", "四", "大", "九")),
      makeNote("3", "·", makeJianzi("散", "木", "五")),
      makeNote("1", "·", makeJianzi("散", "勹", "五"), "二分"),
    ],
  },
  {
    id: "fanyinlianxi",
    title: "泛音练习",
    description: "七徽、十徽泛音，体会清亮音色",
    notes: [
      makeNote("5", "", makeJianzi("泛", "乚", "七", "大", "七")),
      makeNote("5", "", makeJianzi("泛", "乚", "四", "大", "七")),
      makeNote("1", "", makeJianzi("泛", "乚", "三", "大", "十")),
      makeNote("2", "", makeJianzi("泛", "乚", "四", "大", "十")),
      makeNote("3", "", makeJianzi("泛", "乚", "五", "大", "十")),
      makeNote("5", "", makeJianzi("泛", "乚", "七", "大", "七")),
    ],
  },
];

/** 按 ID 查找示例曲谱。 */
export function findExampleScore(id: string): ExampleScore | undefined {
  return EXAMPLE_SCORES.find((s) => s.id === id);
}
