-- 内容治理最小闭环：举报 + 人工下架。
--
-- ## 为什么是「人工下架」而不是「举报够了自动下架」
--
-- 自动下架看起来省事，在这个项目里却是**给攻击者递刀**：注册不需要邮箱验证，
-- 一个人三分钟就能造出三个账号，把任何一首好谱举报到消失。
-- 所以这里的规矩是：举报只**记录与排序**（谁被举报得最多，管理员先看谁），
-- 真正下架必须由持有管理员口令的人点头。
--
-- 代价是下架不及时，收益是不会被人用来自助删帖——对一个公共曲谱库，
-- 误杀一首好谱比晚删一天垃圾谱严重得多。
--
-- ## 为什么举报必须登录
--
-- 本机凭证（`owner_token`）是「这台设备的钥匙」，不是人。要按人防重复举报就得存它，
-- 而它是**能改删曲谱的凭据**——为了一条举报记录多存一份凭据，等于自己扩大泄露面。
-- 登录账号是另一种情况：user_id 本身不是秘密，存它既安全又天然可追责。
-- 于是：**匿名能看、能发，但不能举报**。这与「收藏必须登录」是同一条线。
CREATE TABLE IF NOT EXISTS score_reports (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score_id UUID NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 主键天然去重：同一个人对同一首谱重复举报不会再插一行，
    -- 接口用 ON CONFLICT DO NOTHING 即可幂等，不需要先查后插。
    PRIMARY KEY (user_id, score_id)
);

-- 管理员按「被举报次数」排序看，这条索引直接支撑 GROUP BY score_id 的计数。
CREATE INDEX IF NOT EXISTS score_reports_score_idx ON score_reports(score_id);

-- 下架标记：NULL = 正常，有值 = 已下架（记录时间，便于事后追查「什么时候、因为什么」）。
--
-- 用时间戳而不是布尔：布尔只说「现在关着」，时间戳还能回答「关多久了」。
-- 不设 NOT NULL DEFAULT：绝大多行是 NULL，NULL 本身就是「正常」的默认语义。
ALTER TABLE scores ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- 列表查询一律带 `hidden_at IS NULL`，所以索引要按「未下架的列表」建，
-- 否则每翻一页都要把已下架的行也扫一遍。
CREATE INDEX IF NOT EXISTS scores_visible_updated_idx
    ON scores (updated_at DESC)
    WHERE hidden_at IS NULL;
