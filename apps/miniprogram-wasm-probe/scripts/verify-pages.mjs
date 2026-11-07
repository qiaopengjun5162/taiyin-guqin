/**
 * 页面数据链路的 Node 校验器：**真 wasm 产出 → lib/maps.js 渲染**。
 *
 * 为什么单独一个校验器：`verify-adapter.mjs` 只证明「函数能调通」，
 * 它不看返回值长什么样；而页面最典型的静默失败是
 * **WASM 返回了正确结构，但映射表漏了一个枚举名** → 卡片上是空白，
 * 不报错、不崩溃，只是「点了没内容」。
 *
 * 这个校验器喂真实 wasm 产物、拿真实候选，再走与页面**同一份** maps.js，
 * 断言每一条候选都能渲染出非空的可读文本；并反向检查实际出现的
 * Rust 枚举名是否都在映射表里（漏一个就红）。
 *
 * 用法: node scripts/verify-pages.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const probeRoot = resolve(here, "..");

const api = require(resolve(probeRoot, "workers/wasm-api.js"));
const maps = require(resolve(probeRoot, "lib/maps.js"));

// ── 与真 Worker 同一条 serve() 路径（替身只换 instantiate） ──
const mockInstantiate = (path, imports) => {
    const abs = resolve(probeRoot, path.replace(/^\//, ""));
    const bytes = readFileSync(abs);
    return WebAssembly.instantiate(bytes, imports).then((r) => ({
        module: r.module,
        instance: r.instance,
    }));
};

const inbox = [];
const outbox = [];
const ready = api.serve({
    wasmPath: "/wasm/taiyin_core_bg.wasm",
    instantiateFn: mockInstantiate,
    postMessage: (m) => outbox.push(m),
    onMessage: (handler) => {
        inbox.push(handler);
    },
});

const pending = new Map();
let nextId = 1;

const drain = () => {
    while (outbox.length) {
        const m = outbox.shift();
        if (m.id === null) {
            for (const p of pending.values()) p.reject(new Error(m.error));
            pending.clear();
            continue;
        }
        const p = pending.get(m.id);
        if (!p) continue;
        pending.delete(m.id);
        if (m.ok) p.resolve(m.result);
        else p.reject(new Error(m.error));
    }
};

function rpc(fn, args) {
    const id = nextId++;
    return new Promise((resolveP, rejectP) => {
        pending.set(id, { resolve: resolveP, reject: rejectP });
        inbox.forEach((h) => h({ data: { id, fn, args } }));
        const tick = () => {
            drain();
            if (pending.has(id)) setTimeout(tick, 5);
        };
        setTimeout(tick, 5);
    });
}

let failed = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`);
    else {
        failed++;
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    }
};

async function main() {
    await ready;
    drain();

    // ── 1. 纯映射单测（不依赖 wasm，先把「中文怎么写」钉死） ──
    console.log("== 映射表（纯函数） ==");
    const cn = maps.toChineseNumber;
    check("弦 1–7 中文", [1, 2, 3, 4, 5, 6, 7].map(cn).join("") === "一二三四五六七", [1, 2, 3, 4, 5, 6, 7].map(cn).join(""));
    check("徽 10–13 中文", [10, 11, 12, 13].map(cn).join("/") === "十/十一/十二/十三", [10, 11, 12, 13].map(cn).join("/"));

    const san = maps.buildCandidateDisplay({
        note_type: "散",
        left_finger: null,
        hui: null,
        right_action: "Tiao",
        string_number: 1,
    });
    check("散音：无徽位、弦写对、指法写对", san.toneType === "散" && san.huiText === "" && san.stringText === "一弦" && san.rightAction === "乚", JSON.stringify(san));

    const an = maps.buildCandidateDisplay({
        note_type: "按",
        left_finger: "Da",
        hui: { hui: 9, fen: 6 },
        right_action: "Gou",
        string_number: 4,
    });
    check("按音：大指 / 九徽六分 / 勾", an.leftFinger === "大" && an.huiText === "九徽六分" && an.stringText === "四弦" && an.rightAction === "勹", JSON.stringify(an));

    const ban = maps.buildCandidateDisplay({
        note_type: "按",
        left_finger: "Ming",
        hui: { hui: 7, fen: 5 },
        right_action: "Tiao",
        string_number: 2,
    });
    check("fen=5 特例写成「半」", ban.huiText === "七徽半", JSON.stringify(ban));

    // 音色沿用 wire 契约的单字（散/泛/按），与网页端 parseToneType 的取值域一致——
    // 别在这边自作主张改写成「按音」，否则和网页/导出稿的说法对不上。
    const line = maps.candidateToLine({
        note_type: "按",
        left_finger: "Zhong",
        hui: { hui: 10, fen: 8 },
        right_action: "Mo",
        string_number: 6,
    });
    check("candidateToLine 四段齐全", line === "按 · 六弦十徽八分 · 中指 · 木", line);

    check(
        "displayDecodeState 把结构键换成中文",
        maps.displayDecodeState({ toneType: "按", stringNumber: 4, hui: "九" }) === "音色:按 弦:4 徽:九",
        maps.displayDecodeState({ toneType: "按", stringNumber: 4, hui: "九" }),
    );

    // ── 2. 真 wasm：查音位候选 → 渲染 ──
    console.log("== 真 wasm：translate_jianpu_to_jianzi ==");
    const raw = await rpc("translate_jianpu_to_jianzi", [
        JSON.stringify({ number: 1, octave: 0, tuning: "zheng" }),
    ]);
    const parsed = JSON.parse(raw);
    check("没有 error 字段", !parsed.error, parsed.error);
    const candidates = parsed.candidates || [];
    check("简谱 1（中音·正调）有候选", candidates.length > 0, `got ${candidates.length}`);

    // 每一个候选都必须渲染出非空主行——这是页面「点了没内容」的直接守卫
    let blank = 0;
    const seenLeft = new Set();
    const seenRight = new Set();
    for (const c of candidates) {
        const note = c.note || {};
        const text = maps.candidateToLine(note);
        const d = maps.buildCandidateDisplay(note);
        if (!text || !d || !d.toneType || !d.stringText) blank++;
        if (note.left_finger) seenLeft.add(note.left_finger);
        if (note.right_action) seenRight.add(note.right_action);
    }
    check(`全部 ${candidates.length} 条候选都能渲染（无空白卡）`, blank === 0, `${blank} 条渲染为空`);

    // ── 3. 反向覆盖：实际出现的枚举名必须都在映射表里 ──
    console.log("== 映射覆盖（漏一个就会静默空白） ==");
    const leftMissing = [...seenLeft].filter((k) => !maps.LEFT_FINGER_MAP[k]);
    const rightMissing = [...seenRight].filter((k) => !maps.RIGHT_ACTION_MAP[k]);
    check(
        `左手枚举都在映射表（本次出现 ${[...seenLeft].join(",") || "无"}）`,
        leftMissing.length === 0,
        leftMissing.join(","),
    );
    check(
        `右手枚举都在映射表（本次出现 ${[...seenRight].join(",") || "无"}）`,
        rightMissing.length === 0,
        rightMissing.join(","),
    );
    // 映射表本身不该少于 Rust 枚举数（左手 5、右手 8），否则某些音色永远渲染不出
    check("LEFT_FINGER_MAP 至少 5 项", Object.keys(maps.LEFT_FINGER_MAP).length >= 5, String(Object.keys(maps.LEFT_FINGER_MAP).length));
    check("RIGHT_ACTION_MAP 至少 8 项", Object.keys(maps.RIGHT_ACTION_MAP).length >= 8, String(Object.keys(maps.RIGHT_ACTION_MAP).length));

    // ── 4. 真 wasm：减字码解码 → 展示 ──
    console.log("== 真 wasm：decode_jianzi_batch ==");
    const dec = JSON.parse(await rpc("decode_jianzi_batch", [JSON.stringify({ text: "ad9g4 sg3" })]));
    check("解出 2 条", dec.ok === 2 && (dec.entries || []).length === 2, JSON.stringify({ ok: dec.ok, n: (dec.entries || []).length }));
    const firstText = maps.displayDecodeState(dec.entries[0].state);
    check("第 1 条能渲染出中文结构", !!firstText && firstText.length > 0, firstText);
    const rest = JSON.parse(await rpc("decode_jianzi_batch", [JSON.stringify({ text: "r:2" })]));
    check("休止符标记 isRest", rest.entries[0].isRest === true, JSON.stringify(rest.entries[0]));

    const bad = JSON.parse(await rpc("decode_jianzi_batch", [JSON.stringify({ text: "ad9g4:5" })]));
    check("认不出的时值报错而不是退回四分", bad.failed === 1, JSON.stringify(bad.entries[0]));

    console.log(failed === 0 ? "\n全部通过（页面数据链路成立）" : `\n${failed} 项失败`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error("校验器自身出错:", e);
    process.exit(1);
});
