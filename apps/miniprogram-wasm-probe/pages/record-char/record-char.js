/**
 * 记一个字 —— 两件事：
 *   ① 展示「查音位」里点「记下」攒下来的位置（onShow 从 globalData 拉）；
 *   ② 手输减字码（如 ad9g4 / sg3 / ad9g4:8.）→ 调 WASM `decode_jianzi_batch`
 *      解出它到底是什么意思（音色/弦/徽/左右手/时值）。
 *
 * 减字码是**有损**编码（见 Rust `jianzi_code`）：往返只比归一化字形，
 * 所以这里只做「码 → 结构」单向展示，不承诺能从结构反推出唯一的码。
 */
const maps = require("../../lib/maps.js");
const { createSession } = require("../../lib/wasm-client.js");

const app = getApp();

Page({
    data: {
        recorded: [],
        codeInput: "",
        decoding: false,
        error: "",
        resultLine: "",
        entries: [],
        hasResult: false,
    },

    onLoad() {
        this.session = null;
        this.sessionError = "";
        try {
            this.session = createSession();
        } catch (e) {
            this.sessionError = String((e && e.message) || e);
        }
    },

    onShow() {
        this.setData({ recorded: (app.globalData.recordedNotes || []).slice() });
    },

    onUnload() {
        if (this.session) {
            this.session.destroy();
        }
        this.session = null;
    },

    onCodeInput(e) {
        this.setData({ codeInput: e.detail.value });
    },

    clearRecorded() {
        const self = this;
        wx.showModal({
            title: "清空记下的位置？",
            content: "只清这份临时记录，不影响任何已保存的曲谱。",
            success(res) {
                if (!res.confirm) return;
                app.globalData.recordedNotes = [];
                self.setData({ recorded: [] });
            },
        });
    },

    decode() {
        const text = (this.data.codeInput || "").trim();
        if (!text) {
            this.setData({ error: "先输一串减字码，例如 ad9g4 或 sg3" });
            return;
        }
        if (!this.session) {
            this.setData({ error: this.sessionError || "WASM 会话未建立" });
            return;
        }
        this.setData({ decoding: true, error: "" });

        this.session
            .call("decode_jianzi_batch", [JSON.stringify({ text: text })])
            .then((raw) => {
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (err) {
                    throw new Error("WASM 返回的不是 JSON");
                }
                if (parsed && parsed.error) {
                    throw new Error(parsed.error);
                }
                const list = (parsed && parsed.entries) || [];
                const entries = list.map((entry, index) => {
                    const isRest = entry && entry.isRest;
                    const failed = !!(entry && entry.error);
                    const stateText = failed
                        ? ""
                        : isRest
                          ? "休止符"
                          : maps.displayDecodeState(entry && entry.state);
                    const tail = [];
                    if (entry && entry.duration) tail.push(entry.duration);
                    if (entry && entry.dotted) tail.push("附点");
                    return {
                        index: index,
                        code: (entry && entry.code) || "",
                        stateText: stateText,
                        tail: tail.join(" · "),
                        error: (entry && entry.error) || "",
                        failed: failed,
                        isRest: !!isRest,
                    };
                });

                const okCount = typeof parsed.ok === "number" ? parsed.ok : 0;
                const failedCount = typeof parsed.failed === "number" ? parsed.failed : 0;
                let line = `解出 ${okCount} 条`;
                if (failedCount > 0) line += `，${failedCount} 条没认出来`;

                this.setData({
                    decoding: false,
                    entries: entries,
                    hasResult: true,
                    resultLine: line,
                });
            })
            .catch((err) => {
                this.setData({
                    decoding: false,
                    error: String((err && err.message) || err),
                    entries: [],
                    hasResult: false,
                    resultLine: "",
                });
            });
    },
});
