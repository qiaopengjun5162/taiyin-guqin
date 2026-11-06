/**
 * WASM 探针页：在小程序 Worker 里跑 taiyin-core，验证 WXWebAssembly 链路。
 *
 * 这一页只做一件事：发一个 JSON 进去、把结果打出来。
 * 它证明「小程序里能不能跑我们的 Rust 编排核心」，不是产品页面。
 */
Page({
    data: {
        title: '小程序 WASM 探针',
        subtitle: 'taiyin-core · Rust 编排核心 · WXWebAssembly',
        viewState: 'loading',
        statusText: '正在启动 Worker…',
        rows: [],
        errorMsg: '',
    },

    worker: null,
    pending: null,
    nextId: 1,

    onLoad() {
        this.startProbe();
    },

    onUnload() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    },

    startProbe() {
        this.setData({ viewState: 'loading', statusText: '正在启动 Worker…', rows: [], errorMsg: '' });

        // Worker 入口在 workers/ 目录；.wasm 放在 workers/ 之外的 /wasm/
        // （微信只打包 worker 目录里的 .js，非 .js 会被忽略，是平台既定行为）
        var worker;
        try {
            worker = wx.createWorker('workers/wasm-worker.js');
        } catch (e) {
            this.fail('创建 Worker 失败：' + (e && e.message ? e.message : e));
            return;
        }
        this.worker = worker;

        var that = this;
        worker.onMessage(function (msg) {
            that.onResult(msg);
        });

        // 先跑无参函数，再跑真实计算。两者都通才算通。
        this.setData({ statusText: '正在实例化 wasm…' });
        this.rpc('get_jianzi_variant_groups', [])
            .then(function (raw) {
                that.pushRow('get_jianzi_variant_groups', raw);
                that.setData({ statusText: '正在计算分句…' });
                return that.rpc('split_phrases_to_json', [JSON.stringify({ units: [8, 8, 8, 16, 8, 8] })]);
            })
            .then(function (raw) {
                that.pushRow('split_phrases_to_json', raw);
                that.setData({ viewState: 'ready', statusText: '通过：WASM 在 Worker 里跑起来了' });
            })
            .catch(function (e) {
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
            that.nextId += 1;
            that.pending = { id: id, resolve: resolve, reject: reject };
            that.worker.postMessage({ id: id, fn: fn, args: args });
        });
    },

    onResult(msg) {
        var p = this.pending;
        if (!p || !msg || msg.id !== p.id) return;
        this.pending = null;
        if (msg.ok) {
            p.resolve(msg.result);
        } else {
            p.reject(new Error(msg.error || 'wasm 调用失败'));
        }
    },

    fail(text) {
        this.setData({ viewState: 'error', statusText: '没跑通', errorMsg: text });
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    },

    handleRetry() {
        this.startProbe();
    },
});
