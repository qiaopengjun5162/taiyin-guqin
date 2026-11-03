-- 收藏夹：登录用户把社区里喜欢的谱收起来。
--
-- 为什么需要：社区现在只有「列表 + 按曲名搜索」。谱一多，用户找到一首好谱
-- 之后下次还得重新翻——搜索要记得标题，翻页要记得大概位置。收藏给的是
-- 一个**稳定的短列表**，也是注册唯一能立刻感受到的好处。
--
-- 设计取舍：
-- - 必须有账号：本机凭证是「这台设备的钥匙」，不是人。把它当收藏主体，
--   等于清个缓存收藏就全丢，与收藏的语义相反。故 user_id NOT NULL。
-- - 主键 (user_id, score_id)：天然防重复收藏，重复 PUT 幂等，不需要先查后插。
-- - 两个外键都 ON DELETE CASCADE：谱被删、账号被删，收藏跟着走。
--   否则会留下指向不存在曲谱的僵尸行——列表里点开 404。
-- - 只记「谁收了什么」，不记收藏数：v1 不在列表里显示热度，
--   避免一开始就用一个没人验证过的数字影响大家对谱的判断。
CREATE TABLE IF NOT EXISTS favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score_id UUID NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, score_id)
);

-- 「我的收藏」按收藏时间倒序取页：最近收的在前，符合「刚看到过、还要再弹」的用法。
CREATE INDEX IF NOT EXISTS favorites_user_created_idx ON favorites(user_id, created_at DESC);
-- 反向查询（谁收藏了这首）留给以后的「收藏数」，先建好免得以后锁表。
CREATE INDEX IF NOT EXISTS favorites_score_idx ON favorites(score_id);
