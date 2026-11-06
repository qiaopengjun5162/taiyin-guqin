let wasm;

let WASM_VECTOR_LEN = 0;

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
/**
 * 输出 JSON: `{"candidates": [{"score": 150, "note": {...}}]}`
 * @param {string} input_json
 * @returns {string}
 */
export function translate_jianpu_to_jianzi(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.translate_jianpu_to_jianzi(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 将一串简谱音符批量翻译为候选减字。
 *
 * 输入 JSON: `{"notes": [{"number": 5, "octave": 0}], "tuning": "ruibin"?}`
 * 输出 JSON: `{"candidates_per_note": [[...], [...]]}`
 * @param {string} input_json
 * @returns {string}
 */
export function translate_jianpu_sequence_to_jianzi(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.translate_jianpu_sequence_to_jianzi(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

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
 * @param {string} input_json
 * @returns {string}
 */
export function arrange_jianpu_sequence_to_jianzi(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.arrange_jianpu_sequence_to_jianzi(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

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
 * @param {string} input_json
 * @returns {string}
 */
export function split_phrases_to_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.split_phrases_to_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 减字字典（字全表）—— 返回经筛选 / 搜索后的减字目录。
 *
 * 输入 JSON: `{"tone":"","left":"","action":"","string":"","query":""}`（各字段均可省略）。
 * 输出 JSON: `{"total":50,"entries":[{id,state,note?,common,searchText},...]}`。
 *
 * 字典数据与筛选 / 搜索逻辑全部在 Rust（`jianzi_dictionary` 模块），
 * 前端仅负责把结果渲染成卡片与试听。
 * @param {string} input_json
 * @returns {string}
 */
export function get_jianzi_dictionary(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.get_jianzi_dictionary(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 减字字频统计 —— 给一首曲谱的减字，统计每个字出现次数、占比与写法变体。
 *
 * 输入 JSON: `{"notes":[{toneType,leftFinger,hui,fen,slide,rightAction,stringNumber},...]}`
 * 输出 JSON: `{"total":N,"rows":[{id,label,count,ratio,toneType,...,leftVariants,actionVariants},...]}`
 *
 * 按归一化字形聚合：名/夕、食/亻、省写（乚/勹/木/丁…）都会合并为同一减字，
 * 对应 LiberWord「系统自动合并所有标注」「每个字有多少变体」。
 * @param {string} input_json
 * @returns {string}
 */
export function analyze_jianzi_frequency(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.analyze_jianzi_frequency(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 减字写法变体对照表 —— 返回 `[{canonical, variants, note}, ...]` JSON。
 * @returns {string}
 */
export function get_jianzi_variant_groups() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.get_jianzi_variant_groups();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * 批量编码 —— 把一串减字压成码（如 `ad9g4`），供导出文本谱与按码检索。
 *
 * 输入 JSON: `{"notes": [{"toneType":"散","rightAction":"勾","stringNumber":"三", ...}]}`
 * 输出 JSON: `{"codes": ["sg3", null, ...]}`（不完整的字给 null，不让整批失败）
 * @param {string} input_json
 * @returns {string}
 */
export function encode_jianzi_batch(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.encode_jianzi_batch(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 批量解码 —— 把整段粘回来的文本（码 + 简谱 + 减字 + 小节线混排）收回成减字。
 *
 * 输入 JSON: `{"text": "ad9g4 sg3 | st5"}`
 * 输出 JSON: `{"total":3,"ok":2,"failed":1,"entries":[{"code","state","error"}]}`
 *
 * 这是「导出 → 再导入」闭环的另一半：码能整段粘回来变成曲谱，
 * 才真的是一份可搬运的存档。切词与解码都在 Rust，前端只管渲染与建列。
 * @param {string} input_json
 * @returns {string}
 */
export function decode_jianzi_batch(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decode_jianzi_batch(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_export_0;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('taiyin_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
