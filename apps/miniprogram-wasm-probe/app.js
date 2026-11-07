App({
    globalData: {
        appName: '太音 · 减字谱',
        // 查音位页「记录」下来的候选，供「记一个字」页汇总展示。
        // 只放内存，不落 storage：这一版是轻用演示，别假装有账号体系。
        recordedNotes: [],
    },
});
