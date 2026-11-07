/**
 * 页面行为校验器：在没有微信开发者工具的情况下，**真的把页面逻辑跑一遍**。
 *
 * 做法：桩出小程序运行时的四个全局（Page / getApp / wx / setData），
 * 让 `pages/*.js` 原样 require 进来；`wx.createWorker` 返回一个
 * **进程内的假 Worker**，背后接的仍是 `workers/wasm-api.js` + 真 wasm 产物。
 * 于是页面发出的每一条 `{id, fn, args}` 都会走真实 WASM 计算，
 * setData 收到的就是真数据——可以断言「点了之后卡片里到底有什么」。
 *
 * 它证明的是：页面数据流、状态机、记录/去重、错误分支都对。
 * 它**不**证明：WXML 排版、样式、真机性能（那些要 IDE / 真机）。
 *
 * 用法: node scripts/verify-page-logic.cjs
 */
const { readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");

const root = resolve(__dirname, "..");
const api = require(join(root, "workers/wasm-api.js"));

// ── 真 wasm 的进程内 Worker ──
const mockInstantiate = (path, imports) => {
    const abs = resolve(root, path.replace(/^\//, ""));
    return WebAssembly.instantiate(readFileSync(abs), imports).then((r) => ({
        module: r.module,
        instance: r.instance,
    }));
};

function createInProcessWorker() {
    let deliver = null;
    let handler = null;
    const state = { terminated: false, requests: [] };

    api.serve({
        wasmPath: "/wasm/taiyin_core_bg.wasm",
        instantiateFn: mockInstantiate,
        postMessage: (m) => {
            // ⚠️ 微信的 worker.onMessage 回调拿到的是**消息体本身**，不是 {data} 包装。
            // 这里必须原样交付：先包一层 {data} 会让 wasm-client 把每条响应都当成
            // 「id=null 的初始化失败广播」，症状是全页报「wasm 初始化失败」。
            if (deliver) deliver(m);
        },
        onMessage: (h) => {
            handler = h;
        },
    });

    return {
        state,
        onMessage(cb) {
            deliver = cb;
        },
        postMessage(msg) {
            state.requests.push(msg.fn);
            handler({ data: msg });
        },
        terminate() {
            state.terminated = true;
        },
    };
}

// ── 运行时桩 ──
let capturedOptions = null;
let lastWorker = null;
const toasts = [];
const navigations = [];
const modalAnswers = [];

global.Page = (options) => {
    capturedOptions = options;
};
global.getApp = () => ({ globalData: globalThis.__appGlobalData });
global.wx = {
    createWorker() {
        lastWorker = createInProcessWorker();
        return lastWorker;
    },
    showToast(o) {
        toasts.push(o && o.title);
    },
    navigateTo(o) {
        navigations.push(o && o.url);
    },
    showModal(o) {
        // 默认「确定」
        const answer = modalAnswers.length ? modalAnswers.shift() : true;
        if (o && o.success) o.success({ confirm: answer });
    },
};

function loadPage(relPath) {
    capturedOptions = null;
    lastWorker = null;
    const abs = join(root, relPath);
    delete require.cache[require.resolve(abs)];
    require(abs);
    if (!capturedOptions) throw new Error(`${relPath} 没有调用 Page()`);
    const page = Object.assign({}, capturedOptions);
    page.data = JSON.parse(JSON.stringify(capturedOptions.data || {}));
    page.setData = function (patch) {
        Object.assign(this.data, patch);
    };
    return page;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (fn()) return true;
        await sleep(10);
    }
    throw new Error(`等待超时：${label}`);
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
    globalThis.__appGlobalData = { appName: "太音 · 减字谱", recordedNotes: [] };

    // ─────────── 查音位 ───────────
    console.log("== 查音位页 ==");
    const cp = loadPage("pages/check-position/check-position.js");
    check("data 有默认值（简谱 1 / 中音 / 正调）", cp.data.number === 1 && cp.data.octave === 0 && cp.data.tuning === "zheng", JSON.stringify({ n: cp.data.number, o: cp.data.octave, t: cp.data.tuning }));

    cp.onLoad();
    // Worker 是在 onLoad 里建的，别在 onLoad 之前断言
    check("onLoad 创建了 Worker", !!lastWorker);
    await waitFor(() => cp.data.loading === false && (cp.data.candidates.length > 0 || cp.data.error), "查音位首次查询");
    check("首次查询无错误", cp.data.error === "", cp.data.error);
    check("拿到候选（简谱 1 · 中音 · 正调）", cp.data.candidates.length > 0, String(cp.data.candidates.length));
    check("摘要写了条数", /\d+ 个弹法/.test(cp.data.summary), cp.data.summary);

    const first = cp.data.candidates[0];
    check("候选主行非空", !!first.line && first.line.length > 0, JSON.stringify(first));
    check("候选有弦与指法字段", !!first.stringText && !!first.rightAction, JSON.stringify({ s: first.stringText, r: first.rightAction }));
    check("按舒适度降序（首项分数最高）", cp.data.candidates.every((c, i, a) => i === 0 || a[i - 1].score >= c.score), "排序不对");
    check("徽位写法是「徽在前、分在后」", cp.data.candidates.every((c) => !/分徽/.test(c.huiText)), (cp.data.candidates.find((c) => /分徽/.test(c.huiText)) || {}).huiText);

    // 记录一个
    cp.recordCandidate({ currentTarget: { dataset: { index: 0 } } });
    check("记录后 globalData 有 1 条", globalThis.__appGlobalData.recordedNotes.length === 1, String(globalThis.__appGlobalData.recordedNotes.length));
    check("记录项带 key 与可读文本", !!globalThis.__appGlobalData.recordedNotes[0].key && !!globalThis.__appGlobalData.recordedNotes[0].line, JSON.stringify(globalThis.__appGlobalData.recordedNotes[0]));
    check("卡片标记为已记下", cp.data.candidates[0].recorded === true);
    check("弹了 toast", toasts.includes("已记下"), JSON.stringify(toasts));

    // 重复记录不重复入账
    cp.recordCandidate({ currentTarget: { dataset: { index: 0 } } });
    check("同一条不重复记", globalThis.__appGlobalData.recordedNotes.length === 1, String(globalThis.__appGlobalData.recordedNotes.length));

    // 切调式：重建查询，不得报错
    cp.pickTuning({ currentTarget: { dataset: { value: "ruibin" } } });
    await waitFor(() => cp.data.loading === false && (cp.data.candidates.length > 0 || cp.data.error), "切蕤宾调后查询");
    check("切调式后仍无错误", cp.data.error === "", cp.data.error);
    check("切调式后仍有候选", cp.data.candidates.length > 0, String(cp.data.candidates.length));
    check("切调式后 tuning 已更新", cp.data.tuning === "ruibin", cp.data.tuning);

    // 连续快速切换不应留下错误的 loading 状态
    cp.pickNumber({ currentTarget: { dataset: { value: 5 } } });
    cp.pickNumber({ currentTarget: { dataset: { value: 3 } } });
    await waitFor(() => cp.data.loading === false, "快速连点后收尾");
    check("快速连点后 loading 归位", cp.data.loading === false);
    check("快速连点后 number 是最后点的 3", cp.data.number === 3, String(cp.data.number));

    cp.onUnload();
    check("onUnload 终止了 Worker", lastWorker.state.terminated === true);

    // ─────────── 记一个字 ───────────
    console.log("== 记一个字页 ==");
    const rc = loadPage("pages/record-char/record-char.js");
    rc.onLoad();
    rc.onShow();
    check("onShow 拉到刚才记下的 1 条", rc.data.recorded.length === 1, String(rc.data.recorded.length));

    // 空输入不发起请求，只给提示
    rc.decode();
    check("空输入给提示而不是请求", /先输一串减字码/.test(rc.data.error), rc.data.error);

    rc.setData({ codeInput: "ad9g4 sg3", error: "" });
    rc.decode();
    await waitFor(() => rc.data.decoding === false && rc.data.hasResult, "解码");
    check("解出 2 条", rc.data.entries.length === 2, String(rc.data.entries.length));
    check("结果行写了条数", /解出 2 条/.test(rc.data.resultLine), rc.data.resultLine);
    check("每条都有中文结构", rc.data.entries.every((e) => e.stateText && e.stateText.length > 0), JSON.stringify(rc.data.entries.map((e) => e.stateText)));
    check("码原样回显", rc.data.entries[0].code === "ad9g4", rc.data.entries[0].code);

    // 错误码：认不出的时值要显示为失败而不是静默
    rc.setData({ codeInput: "ad9g4:5" });
    rc.decode();
    await waitFor(() => rc.data.decoding === false, "错误码解码");
    check("认不出的时值标为失败", rc.data.entries[0].failed === true, JSON.stringify(rc.data.entries[0]));
    check("失败项带原因", /认不出的时值/.test(rc.data.entries[0].error), rc.data.entries[0].error);

    // 清空记录
    rc.clearRecorded();
    check("清空后 recorded 为空", rc.data.recorded.length === 0);
    check("清空后 globalData 也为空", globalThis.__appGlobalData.recordedNotes.length === 0);

    // 减字码里没有任何可解析 token
    rc.setData({ codeInput: "。。。", error: "", hasResult: false });
    rc.decode();
    await waitFor(() => rc.data.decoding === false, "非法输入");
    check("无可解析 token 时给出错误而不是空结果", !!rc.data.error, rc.data.error);

    rc.onUnload();
    check("记一个字页也终止了 Worker", lastWorker.state.terminated === true);

    // ─────────── 首页跳转 ───────────
    console.log("== 首页 ==");
    const home = loadPage("pages/home/home.js");
    home.onShow();
    check("首页读到记录数", home.data.recordedCount === 0, String(home.data.recordedCount));
    home.goCheckPosition();
    home.goRecordChar();
    check(
        "两个入口指向已注册页面",
        navigations.includes("/pages/check-position/check-position") &&
            navigations.includes("/pages/record-char/record-char"),
        JSON.stringify(navigations),
    );

    console.log(failed === 0 ? "\n全部通过（页面行为成立）" : `\n${failed} 项失败`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error("校验器自身出错:", e);
    process.exit(1);
});
