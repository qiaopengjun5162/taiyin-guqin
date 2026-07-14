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
): NoteColumn {
  return {
    id: crypto.randomUUID(),
    jianpuNumber,
    jianpuOctave,
    jianpuDot: false,
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
