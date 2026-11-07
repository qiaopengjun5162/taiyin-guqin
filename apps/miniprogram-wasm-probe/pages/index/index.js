/**
 * WASM 探针页：在小程序 Worker 里跑 taiyin-core，验证 WXWebAssembly 链路。
 *
 * 这一页只做一件事：发一个 JSON 进去、把结果打出来。
 * 它证明「小程序里能不能跑我们的 Rust 编排核心」，不是产品页面。
 *
 * 真机验证最怕的不是报错，而是「一直转圈」——Worker 崩了、基础库太低、
 * wasm 路径 404，都可能让消息永远不来。所以每个阶段都有超时与明确的
 * 失败结论，页面上用一个大字 PASS / FAIL 收口，不用翻 console。
 */
var PROBE_TIMEOUT_MS = 12000;

Page({
    data: {
        title: '小程序 WASM 探针',
        subtitle: 'taiyin-core · Rust 编排核心 · WXWebAssembly',
        viewState: 'loading',
        verdict: 'PENDING',
        verdictText: '等待结果',
        statusText: '正在启动 Worker…',
        phase: '启动 Worker',
        rows: [],
        errorMsg: '',
    },

    worker: null,
    pending: null,
    nextId: 1,
    timeoutTimer: null,
    generation: 0,

    onLoad() {
        this.startProbe();
    },

    onUnload() {
        this.teardown();
    },

    teardown() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.pending = null;
    },

    startProbe() {
        this.teardown();
        // 每次重跑换一个代次；旧请求的回调发现代次不符就自行退出，
        // 避免上一轮的迟到失败把新一轮的成功覆盖掉。
        this.generation = this.generation + 1;
        var gen = this.generation;
        var that = this;

        this.setData({
            viewState: 'loading',
            verdict: 'PENDING',
            verdictText: '等待结果',
            statusText: '正在启动 Worker…',
            phase: '启动 Worker',
            rows: [],
            errorMsg: '',
        });

        // Worker 入口在 workers/ 目录；.wasm 放在 workers/ 之外的 /wasm/
        // （微信只打包 worker 目录里的 .js，非 .js 会被忽略，是平台既定行为）
        var worker;
        try {
            worker = wx.createWorker('workers/wasm-worker.js');
        } catch (e) {
            that.fail('创建 Worker 失败：' + (e && e.message ? e.message : e));
            return;
        }
        that.worker = worker;

        worker.onMessage(function (msg) {
            that.onResult(msg);
        });

        // 先跑无参函数，再跑真实计算。两者都通才算通。
        that.setData({ statusText: '正在实例化 wasm…', phase: '实例化 wasm' });
        that.rpc('get_jianzi_variant_groups', [])
            .then(function (raw) {
                if (gen !== that.generation) return;
                that.pushRow('get_jianzi_variant_groups', raw);
                that.setData({ statusText: '正在计算分句…', phase: '计算分句' });
                return that.rpc('split_phrases_to_json', [JSON.stringify({ units: [8, 8, 8, 16, 8, 8] })]);
            })
            .then(function (raw) {
                if (!raw || gen !== that.generation) return;
                that.pushRow('split_phrases_to_json', raw);
                that.setData({
                    viewState: 'ready',
                    verdict: 'PASS',
                    verdictText: 'PASS · 链路跑通',
                    statusText: '通过：WASM 在 Worker 里跑起来了',
                });
            })
            .catch(function (e) {
                if (gen !== that.generation) return;
                that.fail(String((e && e.message) || e));
            });
    },

    pushRow(name, raw) {
        // 产物是 JSON 字符串；截断显示，避免长串撑爆界面
        var text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        var rows = this.data.rows.concat([
            { name: name, text: text.length > 220 ? text.slice(0, 220) + '…' : text },
        ]);
        this.setData({ rows: rows });
    },

    rpc(fn, args) {
        var that = this;
        return new Promise(function (resolve, reject) {
            if (!that.worker) {
                reject(new Error('Worker 未启动'));
                return;
            }
            var id = that.nextId;
            that.nextId = that.nextId + 1;
            var settled = false;

            that.timeoutTimer = setTimeout(function () {
                if (settled) return;
                settled = true;
                that.pending = null;
                reject(new Error(
                    'Worker ' + PROBE_TIMEOUT_MS / 1000 + ' 秒内没回应（阶段：' +
                    that.data.phase + '）。常见原因：基础库过低、WXWebAssembly 不可用、' +
                    '/wasm/ 路径没打进包里。'
                ));
            }, PROBE_TIMEOUT_MS);

            that.pending = {
                id: id,
                resolve: function (v) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(that.timeoutTimer);
                    that.timeoutTimer = null;
                    resolve(v);
                },
                reject: function (e) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(that.timeoutTimer);
                    that.timeoutTimer = null;
                    reject(e);
                },
            };
            that.worker.postMessage({ id: id, fn: fn, args: args });
        });
    },

    onResult(msg) {
        var p = this.pending;
        if (!p || !msg) return;
        // 初始化失败的广播用 id=null；它不是对某个请求的回复，但足以让
        // 当前等待中的请求立刻失败，而不是一直转圈。
        var isBroadcast = msg.id === null || msg.id === undefined;
        if (!isBroadcast && msg.id !== p.id) return;
        this.pending = null;
        if (msg.ok) {
            p.resolve(msg.result);
        } else {
            p.reject(new Error(msg.error || 'wasm 调用失败'));
        }
    },

    fail(text) {
        this.setData({
            viewState: 'error',
            verdict: 'FAIL',
            verdictText: 'FAIL · 链路未跑通',
            statusText: '没跑通',
            errorMsg: text,
        });
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    },

    handleRetry() {
        this.startProbe();
    },
});
