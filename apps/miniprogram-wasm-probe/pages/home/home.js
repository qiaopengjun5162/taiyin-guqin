const app = getApp();

Page({
    data: {
        recordedCount: 0,
    },

    onShow() {
        this.setData({ recordedCount: (app.globalData.recordedNotes || []).length });
    },

    goCheckPosition() {
        wx.navigateTo({ url: '/pages/check-position/check-position' });
    },

    goRecordChar() {
        wx.navigateTo({ url: '/pages/record-char/record-char' });
    },

    goProbe() {
        wx.navigateTo({ url: '/pages/index/index' });
    },
});
