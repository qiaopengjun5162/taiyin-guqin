import type { NoteColumn } from "./types";

/**
 * 覆盖前的确认文案：说清「会丢什么」，而不是干巴巴一句「确定吗」。
 */
export const UNSAVED_CONFIRM_MESSAGE =
  "当前曲谱有未保存的修改，载入别的内容会丢失这些修改。确定继续吗？";

/**
 * 曲谱指纹：判断「当前内容是否与上次保存 / 载入时一致」。
 *
 * 为什么不直接 `JSON.stringify(notes)`：
 *
 * 1. `id` 只是 React 列的 key。删掉一列再加回内容相同的一列，
 *    音乐上没有变化，却会因 id 不同被判成「已修改」。
 * 2. `jianzi` 的键序取决于数据来源（本地构造 vs 服务器返回的 JSON）。
 *    键序不同时 `JSON.stringify` 结果不同，会让刚载入的谱立刻被判定为
 *    「有未保存修改」——一打开分享链接就弹确认框。
 *
 * 因此把每列摊平成**固定顺序**的元组再序列化，只保留真正会被保存的内容。
 */
export function scoreFingerprint(
  title: string,
  notes: NoteColumn[],
  tuning: string,
): string {
  // 联袂关系记「离组首多远」而不是组首的 id：id 不进指纹（见上面第 1 条），
  // 分享链接换个 id 就会让刚载入的谱被判成已修改。
  const indexById = new Map(notes.map((n, i) => [n.id, i]));
  const columns = notes.map((n, i) => [
    n.jianpuNumber,
    n.jianpuOctave,
    n.jianpuDot ? 1 : 0,
    n.duration,
    n.jianzi.toneType,
    n.jianzi.rhythmMode,
    n.jianzi.leftFinger,
    n.jianzi.hui,
    n.jianzi.fen,
    n.jianzi.slide,
    n.jianzi.rightAction,
    n.jianzi.stringNumber,
    n.lyric ?? "",
    // 不列这一项的话，只标了联袂的谱会被判成"没改过"，关页面不提示、标记静默丢失
    n.lianmei
      ? `${n.lianmei.kind}|${i - (indexById.get(n.lianmei.headId) ?? i)}`
      : "",
  ]);
  return JSON.stringify([title, tuning, columns]);
}

/**
 * 有未保存修改时拦下覆盖动作。
 *
 * 抽成函数是为了让调用点语义明确（`if (!confirmDiscard()) return;`），
 * 也便于在测试里替换 `window.confirm`。
 */
export function confirmDiscard(): boolean {
  return window.confirm(UNSAVED_CONFIRM_MESSAGE);
}
