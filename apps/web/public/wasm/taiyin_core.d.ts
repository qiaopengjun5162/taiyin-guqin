/* tslint:disable */
/* eslint-disable */
/**
 * 输出 JSON: `{"candidates": [{"score": 150, "note": {...}}]}`
 */
export function translate_jianpu_to_jianzi(input_json: string): string;
/**
 * 将一串简谱音符批量翻译为候选减字。
 *
 * 输入 JSON: `{"notes": [{"number": 5, "octave": 0}], "tuning": "ruibin"?}`
 * 输出 JSON: `{"candidates_per_note": [[...], [...]]}`
 */
export function translate_jianpu_sequence_to_jianzi(input_json: string): string;
/**
 * 整段简谱的**全局指法编排**（Viterbi 动态规划）。
 *
 * 输入 JSON: `{"notes": [{"number": 5, "octave": 0}], "tuning": "ruibin"?}`
 * 输出 JSON:
 * `{"candidates_per_note": [[...]], "selections": [0, 0, null], "total_cost": 1234,
 *   "stats": {...}, "greedy_stats": {...}, "identical_to_greedy": false,
 *   "phrases": [{"index":0,"start":0,"end":11,"note_count":12,"stats":{...}}]}`
 *
 * 与 `translate_jianpu_sequence_to_jianzi` 的区别：那一版逐音贪心，只跟前一个音
 * 比远近；这一版把整句当一条路径求全局最优，牺牲个别音的单音舒适度，
 * 换取整句少换把、少跨弦。两个字段（候选 / 选中）出自同一次计算，
 * 前端照单全收，不需要按索引去猜另一份数据。
 *
 * `stats` / `greedy_stats` 是同一段简谱两条路径的活动量（换弦、同指挪位、
 * 技法切换），界面据此把「编排到底省了什么」说成琴人能懂的话；
 * `identical_to_greedy` 让界面在没有改善时不必硬夸。
 *
 * `phrases` 是按气口切出来的乐句（前一个音留了两拍及以上即为一处气口），
 * 逐句带上 `start` / `end`（**输入数组**的下标，含两端）、音数与活动量。
 * 长曲一句一句练，界面据此标出「第几句」以及哪一句最赶。
 */
export function arrange_jianpu_sequence_to_jianzi(input_json: string): string;
/**
 * 按时值切句 —— 谱面画「第 N 句」、按句循环慢练都要用同一组句界。
 *
 * 输入 JSON: `{"units": [8, 8, 16, 8]}`，单位是 1/8 拍（四分 = 8、二分 = 16），
 * `null` 表示这个音没给时值（按「没有气口」处理）。
 * 输出 JSON: `{"phrases": [{"start": 0, "end": 2}, {"start": 3, "end": 3}]}`，
 * 下标取自入参、两端都含。
 *
 * 为什么单独导出一个函数，而不是让前端自己按 `时值 >= 两拍` 切：阈值在
 * [`crate::jianpu::phrase_ranges`] 里，前端抄一份就会各自漂——谱面上分了 5 句、
 * 编排按 4 句算，用户点「第 3 句」练到的却是别的地方，而且没有任何地方会报错。
 * 这里只做切分，不跑编排：画一条分隔线不该先算一遍最优指法。
 */
export function split_phrases_to_json(input_json: string): string;
/**
 * 减字字典（字全表）—— 返回经筛选 / 搜索后的减字目录。
 *
 * 输入 JSON: `{"tone":"","left":"","action":"","string":"","query":""}`（各字段均可省略）。
 * 输出 JSON: `{"total":50,"entries":[{id,state,note?,common,searchText},...]}`。
 *
 * 字典数据与筛选 / 搜索逻辑全部在 Rust（`jianzi_dictionary` 模块），
 * 前端仅负责把结果渲染成卡片与试听。
 */
export function get_jianzi_dictionary(input_json: string): string;
/**
 * 减字字频统计 —— 给一首曲谱的减字，统计每个字出现次数、占比与写法变体。
 *
 * 输入 JSON: `{"notes":[{toneType,leftFinger,hui,fen,slide,rightAction,stringNumber},...]}`
 * 输出 JSON: `{"total":N,"rows":[{id,label,count,ratio,toneType,...,leftVariants,actionVariants},...]}`
 *
 * 按归一化字形聚合：名/夕、食/亻、省写（乚/勹/木/丁…）都会合并为同一减字，
 * 对应 LiberWord「系统自动合并所有标注」「每个字有多少变体」。
 */
export function analyze_jianzi_frequency(input_json: string): string;
/**
 * 减字写法变体对照表 —— 返回 `[{canonical, variants, note}, ...]` JSON。
 */
export function get_jianzi_variant_groups(): string;
/**
 * 批量编码 —— 把一串减字压成码（如 `ad9g4`），供导出文本谱与按码检索。
 *
 * 输入 JSON: `{"notes": [{"toneType":"散","rightAction":"勾","stringNumber":"三", ...}]}`
 * 输出 JSON: `{"codes": ["sg3", null, ...]}`（不完整的字给 null，不让整批失败）
 */
export function encode_jianzi_batch(input_json: string): string;
/**
 * 批量解码 —— 把整段粘回来的文本（码 + 简谱 + 减字 + 小节线混排）收回成减字。
 *
 * 输入 JSON: `{"text": "ad9g4 sg3 | st5"}`
 * 输出 JSON: `{"total":3,"ok":2,"failed":1,"entries":[{"code","state","error"}]}`
 *
 * 这是「导出 → 再导入」闭环的另一半：码能整段粘回来变成曲谱，
 * 才真的是一份可搬运的存档。切词与解码都在 Rust，前端只管渲染与建列。
 */
export function decode_jianzi_batch(input_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly analyze_jianzi_frequency: (a: number, b: number) => [number, number];
  readonly arrange_jianpu_sequence_to_jianzi: (a: number, b: number) => [number, number];
  readonly decode_jianzi_batch: (a: number, b: number) => [number, number];
  readonly encode_jianzi_batch: (a: number, b: number) => [number, number];
  readonly get_jianzi_dictionary: (a: number, b: number) => [number, number];
  readonly get_jianzi_variant_groups: () => [number, number];
  readonly split_phrases_to_json: (a: number, b: number) => [number, number];
  readonly translate_jianpu_sequence_to_jianzi: (a: number, b: number) => [number, number];
  readonly translate_jianpu_to_jianzi: (a: number, b: number) => [number, number];
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
