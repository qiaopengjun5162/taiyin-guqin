/**
 * 查音位 —— 小程序轻用核心页。
 *
 * 选简谱数字 + 八度 + 调式 → 调 WASM `translate_jianpu_to_jianzi`
 * → 把返回的候选（弦/徽/左手/右手）用 lib/maps.js 转成中文卡片。
 *
 * 为什么不在小程序里内置减字字体：字体层是 GSUB 连字（私有 PUA 映射），
 * 小程序对自定义字体与 SVG 内联的支持都受限；这一版**只讲结构**（哪根弦、哪个徽、
 * 哪根手指），结构信息对「找到音在哪」已经够用，且不会出现「字画不出来还硬说能画」。
 */
const maps = require("../../lib/maps.js");
const { createSession } = require("../../lib/wasm-client.js");

const app = getApp();

const OCTAVES = [
    { label: "低音", value: -1 },
    { label: "中音", value: 0 },
    { label: "高音", value: 1 },
];

const TUNINGS = [
    { label: "正调", value: "zheng" },
    { label: "蕤宾调", value: "ruibin" },
    { label: "慢角调", value: "manjiao" },
];

function recordKey(item) {
    return [item.toneType, item.stringText, item.huiText, item.leftFinger, item.rightAction].join("|");
}

Page({
    data: {
        numbers: [1, 2, 3, 4, 5, 6, 7],
        octaves: OCTAVES,
        tunings: TUNINGS,
        number: 1,
        octave: 0,
        tuning: "zheng",
        loading: false,
        error: "",
        summary: "",
        candidates: [],
        recordedKeys: {},
    },

    onLoad() {
        this.session = null;
        this.sessionError = "";
        this.queryToken = 0;
        try {
            this.session = createSession();
        } catch (e) {
            this.sessionError = String((e && e.message) || e);
        }
        this.query();
    },

    onUnload() {
        if (this.session) {
            this.session.destroy();
        }
        this.session = null;
    },

    pickNumber(e) {
        const value = Number(e.currentTarget.dataset.value);
        if (value === this.data.number) return;
        this.setData({ number: value });
        this.query();
    },

    pickOctave(e) {
        const value = Number(e.currentTarget.dataset.value);
        if (value === this.data.octave) return;
        this.setData({ octave: value });
        this.query();
    },

    pickTuning(e) {
        const value = e.currentTarget.dataset.value;
        if (value === this.data.tuning) return;
        this.setData({ tuning: value });
        this.query();
    },

    query() {
        if (!this.session) {
            this.setData({ error: this.sessionError || "WASM 会话未建立" });
            return;
        }
        const { number, octave, tuning } = this.data;
        const token = this.queryToken + 1;
        this.queryToken = token;
        this.setData({ loading: true, error: "" });

        const payload = JSON.stringify({ number: number, octave: octave, tuning: tuning });

        this.session
            .call("translate_jianpu_to_jianzi", [payload])
            .then((raw) => {
                // 快速连点会发出多个请求；只认最后一次，避免旧结果盖掉新结果。
                if (token !== this.queryToken) return;
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (err) {
                    throw new Error("WASM 返回的不是 JSON");
                }
                if (parsed && parsed.error) {
                    throw new Error(parsed.error);
                }
                const list = (parsed && parsed.candidates) || [];
                const recorded = this.data.recordedKeys || {};
                const candidates = list.map((item, index) => {
                    const note = item && item.note ? item.note : null;
                    const display = maps.buildCandidateDisplay(note) || {
                        toneType: "",
                        leftFinger: "",
                        rightAction: "",
                        stringText: "",
                        huiText: "",
                    };
                    const view = {
                        index: index,
                        score: item && typeof item.score === "number" ? item.score : 0,
                        toneType: display.toneType,
                        leftFinger: display.leftFinger,
                        rightAction: display.rightAction,
                        stringText: display.stringText,
                        huiText: display.huiText,
                        line: maps.candidateToLine(note),
                    };
                    view.key = recordKey(view);
                    view.recorded = !!recorded[view.key];
                    return view;
                });

                this.setData({
                    loading: false,
                    candidates: candidates,
                    summary: candidates.length
                        ? `这个音在七弦十三徽上一共 ${candidates.length} 个弹法，按舒适度排序。`
                        : "这个音在当前调式下没有可用落点（换个八度或调式试试）。",
                });
            })
            .catch((err) => {
                if (token !== this.queryToken) return;
                this.setData({
                    loading: false,
                    error: String((err && err.message) || err),
                    candidates: [],
                    summary: "",
                });
            });
    },

    recordCandidate(e) {
        const index = Number(e.currentTarget.dataset.index);
        const item = this.data.candidates[index];
        if (!item) return;
        const list = app.globalData.recordedNotes || [];
        if (list.some((n) => n.key === item.key)) {
            return;
        }
        list.push({
            key: item.key,
            line: item.line,
            toneType: item.toneType,
            stringText: item.stringText,
            huiText: item.huiText,
            leftFinger: item.leftFinger,
            rightAction: item.rightAction,
            source: `${this.data.number}${this.data.octave > 0 ? "（高）" : this.data.octave < 0 ? "（低）" : ""}`,
        });
        app.globalData.recordedNotes = list;
        const recordedKeys = Object.assign({}, this.data.recordedKeys);
        recordedKeys[item.key] = true;
        const candidates = this.data.candidates.slice();
        candidates[index] = Object.assign({}, candidates[index], { recorded: true });
        this.setData({ recordedKeys: recordedKeys, candidates: candidates });
        wx.showToast({ title: "已记下", icon: "success", duration: 900 });
    },
});
