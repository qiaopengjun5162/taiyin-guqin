/**
 * 联袂指法：成组、同度（放合可八度）的左右手配合。
 *
 * 定义依据（成公亮《减字谱指法符号简释》，多源一致）：
 * - 分开：右手抹/勾得声 → 左指上一位 → 右指挑/剔得声 → 左指复下原位。三声、两实一虚，
 *   首尾同度，整体只占**一个**简谱位置。
 * - 同声（带合）：左指按弹后带起/抓起得散音，**同时**右弹空弦，两声如一声。
 * - 应合：左按弹出声后右手连弹散音，左指走手到与散音相合的音位。通常二声以上。
 * - 放合：按徽取声后内移放开空弦，随即按弹相邻弦（高八度）与放开的空弦相应。
 *
 * 这一层只做两件事：把相邻的几个音**归成一组**，以及在删除/插入之后把不合法的组**解掉**。
 * 「同声要同时发声」这类语义由播放器读 `kind` 自己处理，不塞进这里——
 * 否则这层会变成"什么都管"的上帝模块。
 */

import type { LianmeiKind, NoteColumn } from "./types";

export interface LianmeiOption {
  kind: LianmeiKind;
  /** 按钮上的简短提示 */
  hint: string;
  /** 默认成组时带几个后续音（分开/同声/放合固定两声；应合可以更多，先按最小两声） */
  memberCount: number;
  /** 是否允许与组首差八度（只有放合允许） */
  allowOctave: boolean;
}

export const LIANMEI_OPTIONS: LianmeiOption[] = [
  {
    kind: "同声",
    hint: "按音带起/抓起的同时右弹空弦，两声同时响",
    memberCount: 1,
    allowOctave: false,
  },
  {
    kind: "应合",
    hint: "右手连弹散音，左指走手去合",
    memberCount: 1,
    allowOctave: false,
  },
  {
    kind: "放合",
    hint: "放开空弦后按弹相邻弦，同度或高八度相应",
    memberCount: 1,
    allowOctave: true,
  },
  {
    kind: "分开",
    hint: "一个音分成两声（中间走手），整体占一个简谱位置",
    memberCount: 1,
    allowOctave: false,
  },
];

export interface LianmeiGroup {
  kind: LianmeiKind;
  headIndex: number;
  memberIndexes: number[];
}

/**
 * 清掉不成立的联袂关系，返回清理后的数组。
 *
 * 判为不成立的情形，都是在编辑过程中**必然出现**的：
 * 1. `headId` 指向的音已经不在了（组首被删）。
 * 2. 成员与组首不再相邻（中间插进了别的音）。
 * 3. 组首自己带着别人当 headId（链条指向不存在的组）。
 * 4. 组内 `kind` 不一致（只可能来自手改存档）。
 *
 * 没有任何要清的时候**返回原数组引用**——调用方常在渲染路径里跑它，
 * 每次返回新数组会让 React 认为谱面一直在变。
 */
export function normalizeLianmei(notes: NoteColumn[]): NoteColumn[] {
  const indexById = new Map<string, number>();
  notes.forEach((n, i) => indexById.set(n.id, i));

  /** 组首是否成立：至少有一个紧随其后的成员，且成员与它同类同组。 */
  const headIsValid = (headIdx: number): boolean => {
    const head = notes[headIdx];
    const link = head.lianmei;
    if (!link || link.headId !== head.id) return false;
    const follower = notes[headIdx + 1];
    return Boolean(
      follower?.lianmei &&
        follower.lianmei.headId === head.id &&
        follower.lianmei.kind === link.kind,
    );
  };

  let changed = false;
  const next = notes.map((note, i) => {
    const link = note.lianmei;
    if (!link) return note;

    const headIdx = indexById.get(link.headId);
    if (headIdx === undefined) {
      changed = true;
      return withoutLianmei(note);
    }

    const isHead = link.headId === note.id;
    const head = notes[headIdx];
    const headLink = head.lianmei;
    if (
      !headLink ||
      headLink.headId !== head.id ||
      headLink.kind !== link.kind ||
      (isHead ? headIdx !== i : headIdx >= i)
    ) {
      changed = true;
      return withoutLianmei(note);
    }

    // 相邻性：组首到本音之间，每一列都必须是同一组的成员
    for (let k = headIdx + 1; k <= i; k += 1) {
      const mid = notes[k].lianmei;
      if (!mid || mid.headId !== link.headId || mid.kind !== link.kind) {
        changed = true;
        return withoutLianmei(note);
      }
    }

    // 组首必须真的成组（有成员），否则自己也只是个孤零零的标记
    if (isHead && !headIsValid(i)) {
      changed = true;
      return withoutLianmei(note);
    }

    return note;
  });

  return changed ? next : notes;
}

function withoutLianmei(note: NoteColumn): NoteColumn {
  // 用 delete 而不是「解构后丢掉」：后者会留下一个未使用的变量，
  // 在 lint 里是警告；而且 delete 之后对象上没有 lianmei 这个键，
  // 与"没标过联袂"的音符序列化结果完全一致。
  const next = { ...note };
  delete next.lianmei;
  return next;
}

/**
 * 解析出所有成立的联袂组。
 *
 * 只认「组首 + 紧随其后的连续成员」这一段：不连续的（中间隔音）直接忽略，
 * 与 `normalizeLianmei` 的判定保持一致，避免"这里算组、那里不算"。
 */
export function lianmeiGroups(notes: NoteColumn[]): LianmeiGroup[] {
  const groups: LianmeiGroup[] = [];

  notes.forEach((note, i) => {
    if (!note.lianmei) return;
    if (note.lianmei.headId !== note.id) return;

    const kind = note.lianmei.kind;
    const memberIndexes: number[] = [];
    for (let j = i + 1; j < notes.length; j += 1) {
      const link = notes[j].lianmei;
      if (!link || link.headId !== note.id || link.kind !== kind) break;
      memberIndexes.push(j);
    }
    if (memberIndexes.length > 0) {
      groups.push({ kind, headIndex: i, memberIndexes });
    }
  });

  return groups;
}

/** 某一下标在联袂里的角色；不在任何组里返回 null。 */
export function lianmeiRoleAt(
  notes: NoteColumn[],
  index: number,
): { kind: LianmeiKind; isHead: boolean } | null {
  const link = notes[index]?.lianmei;
  if (!link) return null;
  const head = notes.find((n) => n.id === link.headId);
  if (!head || !head.lianmei) return null;
  return { kind: link.kind, isHead: link.headId === notes[index].id };
}

/**
 * 把 `headIndex` 起的 `memberCount` 个后续音与组首连成一组。
 *
 * 越界时不硬凑：返回原数组。宁可"点了没反应"，也不要拿最后一个音凑一组——
 * 那会造出一组合法性没人能解释的谱。
 */
export function linkLianmei(
  notes: NoteColumn[],
  headIndex: number,
  kind: LianmeiKind,
  memberCount?: number,
): NoteColumn[] {
  const option = LIANMEI_OPTIONS.find((o) => o.kind === kind);
  const count = memberCount ?? option?.memberCount ?? 1;
  // 越界就不成组（含 count 为 0 或负数的情况）
  if (count < 1) return notes;
  if (headIndex < 0 || headIndex + count > notes.length - 1) return notes;

  const head = notes[headIndex];
  const next = notes.map((n) => n);

  // 先把要涉及的音从旧组里摘出来，否则会出现"一员属两组"
  for (let k = headIndex; k <= headIndex + count; k += 1) {
    next[k] = withoutLianmei(next[k]);
  }

  next[headIndex] = { ...next[headIndex], lianmei: { kind, headId: head.id } };
  for (let k = 1; k <= count; k += 1) {
    next[headIndex + k] = {
      ...next[headIndex + k],
      lianmei: { kind, headId: head.id },
    };
  }
  return next;
}

/** 解除以该下标为首（或该下标所在）的整组联袂。 */
export function clearLianmei(notes: NoteColumn[], index: number): NoteColumn[] {
  const link = notes[index]?.lianmei;
  if (!link) return notes;
  const headId = link.headId;
  return notes.map((n) =>
    n.lianmei?.headId === headId ? withoutLianmei(n) : n,
  );
}

/** 两个频率的音程关系，用于判断这组联袂写不写得通。 */
export type LianmeiRelation = "同度" | "八度" | "不合";

/**
 * 判断音程关系。
 *
 * 用**比例**而不是绝对差：绝对差在高音区太宽松（差 5Hz 在低音是一整个半音，
 * 在高音只是几音分），拿它判同度会把明显不同的音判成同度。
 */
export function lianmeiRelation(
  freqA: number | null,
  freqB: number | null,
): LianmeiRelation {
  if (freqA == null || freqB == null || freqA <= 0 || freqB <= 0) return "不合";
  const ratio = Math.max(freqA, freqB) / Math.min(freqA, freqB);
  // 同度容差 1%：约 17 音分，宽出人耳能分辨的范围一点，用来吃掉浮点误差与
  // 徽位分的小数换算误差，但不足以把半音（6%）判成同度。
  if (Math.abs(ratio - 1) <= 0.01) return "同度";
  if (Math.abs(ratio - 2) <= 0.02) return "八度";
  return "不合";
}

/** 该关系是否符合这种联袂指法的要求。 */
export function relationFits(kind: LianmeiKind, rel: LianmeiRelation): boolean {
  if (rel === "同度") return true;
  if (rel === "八度") {
    return LIANMEI_OPTIONS.find((o) => o.kind === kind)?.allowOctave ?? false;
  }
  return false;
}
