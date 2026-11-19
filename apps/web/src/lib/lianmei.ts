/**
 * 联袂指法 —— 前端薄壳。
 *
 * 成组/解组/音程判定的**唯一实现**在 Rust：`crates/taiyin-core/src/lianmei.rs`。
 * 这里只做三件事：调 WASM、把结果套回 `NoteColumn`、保持「无变化就沿用原引用」的契约。
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
 * 否则这层会变成「什么都管」的上帝模块。
 *
 * 非浏览器客户端（App / 小程序 / 第三方）走同一份逻辑的 HTTP 出口：
 * `POST /api/v1/lianmei/{normalize,groups,relation}` 与 `/link`、`/clear`。
 */

import type { LianmeiKind, NoteColumn } from "./types";
import { getWasmSync, isWasmReady } from "./taiyin-wasm";

export interface LianmeiOption {
  kind: LianmeiKind;
  /** 按钮上的简短提示 */
  hint: string;
  /** 默认成组时带几个后续音 */
  memberCount: number;
  /** 是否允许与组首差八度（只有放合允许） */
  allowOctave: boolean;
}

/**
 * 四种指法的元数据。
 *
 * 纯静态文案 + 两条布尔规则；真值在 Rust 的 `LianmeiKind`（`allow_octave` /
 * `member_count`），两边由 `lianmei-contract.test.ts` 钉住。
 */
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

export type LianmeiRelation = "同度" | "八度" | "不合";

/** Rust 侧的联袂标记形状（只有算法需要的两个字段）。 */
interface WireLink {
  kind: LianmeiKind;
  headId: string;
}

interface WireNote {
  id: string;
  lianmei: WireLink | null;
}

interface WireResult {
  error?: string;
  changed?: boolean;
  notes?: WireNote[];
}

/**
 * 只把算法需要的两个字段抽出来送给 Rust。
 *
 * 核心库不该知道简谱、时值、歌词——那是 `NoteColumn` 的事，不是成组算法的事。
 * 这样同一套逻辑也能服务将来的谱字节点树。
 */
function toWire(notes: NoteColumn[]): WireNote[] {
  return notes.map((n) => ({ id: n.id, lianmei: n.lianmei ?? null }));
}

/**
 * 把 Rust 返回的联袂标记套回原音符。
 *
 * 按下标逐个对齐（Rust 保证输出与输入等长、同序），只改 `lianmei`，
 * 其它字段保持原引用——否则下游的浅比较会全部失效。
 */
function applyLinks(notes: NoteColumn[], wire: WireNote[]): NoteColumn[] {
  return notes.map((note, i) => {
    const link = wire[i]?.lianmei ?? null;
    const prev = note.lianmei;
    if (!prev && !link) return note;
    if (prev && link && prev.kind === link.kind && prev.headId === link.headId) {
      return note;
    }
    if (!link) {
      // 用 delete 而不是留一个 undefined 键：与「没标过联袂」的音符序列化结果完全一致
      const next = { ...note };
      delete next.lianmei;
      return next;
    }
    return { ...note, lianmei: { kind: link.kind, headId: link.headId } };
  });
}

/** 把 Rust 的 `{notes, changed}` 结果落成前端数组，无变化时原样返回。 */
function applyResult(notes: NoteColumn[], raw: string): NoteColumn[] {
  const parsed = JSON.parse(raw) as WireResult;
  if (parsed.error) throw new Error(parsed.error);
  // 无变化必须返回**同一引用**，否则渲染路径每帧都会认为谱面变了
  if (!parsed.changed || !parsed.notes) return notes;
  return applyLinks(notes, parsed.notes);
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
  if (!isWasmReady()) return notes;
  return applyResult(
    notes,
    getWasmSync().normalize_lianmei(JSON.stringify({ notes: toWire(notes) })),
  );
}

/**
 * 解析出所有成立的联袂组。
 *
 * 只认「组首 + 紧随其后的连续成员」这一段：不连续的（中间隔音）直接忽略，
 * 与 `normalizeLianmei` 的判定保持一致，避免「这里算组、那里不算」。
 */
export function lianmeiGroups(notes: NoteColumn[]): LianmeiGroup[] {
  if (!isWasmReady()) return [];
  const raw = getWasmSync().lianmei_groups(JSON.stringify({ notes: toWire(notes) }));
  const parsed = JSON.parse(raw) as { error?: string; groups?: LianmeiGroup[] };
  if (parsed.error) throw new Error(parsed.error);
  return parsed.groups ?? [];
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
 * 越界时不硬凑：返回原数组。宁可「点了没反应」，也不要拿最后一个音凑一组——
 * 那会造出一组合法性没人能解释的谱。这条判据在 Rust 里，前端不重复实现。
 */
export function linkLianmei(
  notes: NoteColumn[],
  headIndex: number,
  kind: LianmeiKind,
  memberCount?: number,
): NoteColumn[] {
  if (!isWasmReady()) return notes;
  const option = LIANMEI_OPTIONS.find((o) => o.kind === kind);
  const count = memberCount ?? option?.memberCount ?? 1;
  return applyResult(
    notes,
    getWasmSync().link_lianmei(
      JSON.stringify({
        notes: toWire(notes),
        headIndex,
        kind,
        memberCount: count,
      }),
    ),
  );
}

/** 解除以该下标为首（或该下标所在）的整组联袂。 */
export function clearLianmei(notes: NoteColumn[], index: number): NoteColumn[] {
  if (!isWasmReady()) return notes;
  return applyResult(
    notes,
    getWasmSync().clear_lianmei(JSON.stringify({ notes: toWire(notes), index })),
  );
}

/**
 * 判断音程关系。
 *
 * 用**比例**而不是绝对差：绝对差在高音区太宽松（差 5Hz 在低音是一整个半音，
 * 在高音只是几音分），拿它判同度会把明显不同的音判成同度。
 * 容差与判据都在 Rust 的 `lianmei_relation`。
 */
export function lianmeiRelation(
  freqA: number | null,
  freqB: number | null,
): LianmeiRelation {
  if (!isWasmReady()) return "不合";
  const raw = getWasmSync().lianmei_relation(JSON.stringify({ freqA, freqB }));
  const parsed = JSON.parse(raw) as { error?: string; relation?: LianmeiRelation };
  if (parsed.error) throw new Error(parsed.error);
  return parsed.relation ?? "不合";
}

/** 该关系是否符合这种联袂指法的要求。 */
export function relationFits(kind: LianmeiKind, rel: LianmeiRelation): boolean {
  if (rel === "同度") return true;
  if (rel === "八度") {
    return LIANMEI_OPTIONS.find((o) => o.kind === kind)?.allowOctave ?? false;
  }
  return false;
}
