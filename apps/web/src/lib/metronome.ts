/**
 * 节拍器纯逻辑：强拍判定与拍点时间推进。
 */

/** 该拍是否为强拍（每小节第一拍）。 */
export function isDownbeat(beatIndex: number, beatsPerBar: number): boolean {
  return beatIndex % beatsPerBar === 0;
}

/**
 * 节拍器点击调度器：给定当前拍点时间与拍长，产出下一次点击。
 * 返回 null 表示已越过 horizon，本轮不再调度。
 */
export function nextClick(
  beatTime: number,
  beatIndex: number,
  beatSec: number,
  beatsPerBar: number,
  horizon: number,
): { time: number; accent: boolean } | null {
  if (beatTime >= horizon) return null;
  return { time: beatTime, accent: isDownbeat(beatIndex, beatsPerBar) };
}

/** 推进到下一拍。 */
export function advanceBeat(
  beatTime: number,
  beatIndex: number,
  beatSec: number,
): [number, number] {
  return [beatTime + beatSec, beatIndex + 1];
}
