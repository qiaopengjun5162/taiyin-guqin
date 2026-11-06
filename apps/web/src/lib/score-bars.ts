/**
 * 小节切分 —— 把一串音符按拍号切成「小节」。
 *
 * 为什么单独抽出来：
 * 原来这件事是在 `ScoreView` 的渲染循环里边算边插小节线的，算完就没了。
 * 但「小节」本身是排版的一等公民——小节换行、等宽小节都要以它为单位成组
 * （一个小节不能被拆到两行）。渲染时再顺手算，就只能得到「一个扁平的
 * 音符+小节线数组」，成组的边界信息已经丢了。
 *
 * 所以这里只做一件事：输入音符与每小节拍数，输出小节数组。
 * 纯函数、不碰 DOM，可以单独钉住行为。
 */

import type { NoteColumn } from "./types";
import { durationToBeats } from "./jianzi";

/** 一个小节：组内音符 + 首音在全谱中的下标（保持原序号，不重新编号）。 */
export interface Bar {
  notes: NoteColumn[];
  startIndex: number;
}

/**
 * 按拍号切分小节。
 *
 * 规则与迁移前的渲染循环逐条对齐（改这里要同步 `score-view.test.tsx` 的断言）：
 * 1. 当前小节已有音，再加这一音会**超过**拍数 → 先收口，本音另起小节。
 * 2. 加完这一音正好**够**拍数 → 收口（小节线落在它后面）。
 * 3. 单音本身比一小节还长（如 3/4 里的全音符）→ 自己独占一节，不会被继续塞。
 *
 * 注意第 1 条用的是「超过」而不是「达到」：正好填满时应当收口于本音之后，
 * 而不是把它推到下一节。两个判断差一拍，整张谱的小节线就全错位。
 */
export function groupIntoBars(notes: NoteColumn[], beatsPerBar: number): Bar[] {
  // 拍数非法时不当作 0 处理：那会让每个音各自成节、小节线满天飞。
  // 退回 4/4 是乐谱里最不坏的一档默认。
  const per = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;

  const bars: Bar[] = [];
  let current: NoteColumn[] = [];
  let currentStart = 0;
  let acc = 0;

  notes.forEach((note, index) => {
    const beats = durationToBeats(note.duration, note.jianpuDot);

    if (current.length > 0 && acc + beats > per) {
      bars.push({ notes: current, startIndex: currentStart });
      current = [];
      acc = 0;
    }

    if (current.length === 0) currentStart = index;
    current.push(note);
    acc += beats;

    if (acc >= per) {
      bars.push({ notes: current, startIndex: currentStart });
      current = [];
      acc = 0;
    }
  });

  if (current.length > 0) {
    bars.push({ notes: current, startIndex: currentStart });
  }

  return bars;
}

/**
 * 单个音符在谱面上的基准宽度（px）。
 *
 * 与 `ScoreView` 里音符列的 `w-[72px]` 是同一个数——等宽小节的宽度就是
 * 拿它乘出来算的。抽成常量是为了让「排版算宽度」和「渲染定宽度」不会
 * 各写一份然后悄悄漂开（漂了的表现是等宽小节右边缘参差）。
 */
export const NOTE_COLUMN_WIDTH = 72;

/** 相邻音符列的间距（px），对应 flow / barline 布局里的 `gap-3`。 */
export const NOTE_COLUMN_GAP = 12;

/**
 * 等宽小节的统一宽度：按「全谱最长的小节」定。
 *
 * 取最长而不是固定值，是为了不让音符多的小节挤成一团；取全谱统一而不是
 * 逐节自适应，才是「等宽」——各节宽度一致，右边缘能对齐成一条线。
 *
 * `gap` 要跟当前密度走（紧凑/标准/疏朗的列间距不同），传错了表现是
 * 等宽小节右边缘参差。空谱返回 0，调用方据此退回自适应宽度。
 */
export function equalBarWidth(bars: Bar[], gap: number = NOTE_COLUMN_GAP): number {
  if (bars.length === 0) return 0;
  const maxCount = bars.reduce((max, bar) => Math.max(max, bar.notes.length), 0);
  if (maxCount === 0) return 0;
  return maxCount * NOTE_COLUMN_WIDTH + (maxCount - 1) * Math.max(0, gap);
}

/**
 * 拍号 → 每小节拍数。
 *
 * 现在只有 3/4、4/4、6/8 三档，但 6/8 记的是「六拍」而不是「三拍」——
 * 与 `beatsPerBar` 的既有语义（节拍器按它走、慢练按它数拍）保持一致，
 * 不要在这里偷偷换算成复拍子。
 */
export function beatsPerBarFromLabel(label: string): number {
  const [top] = label.split("/");
  const n = Number.parseInt(top, 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
}
