-- 自助找回口令的一次性令牌。
--
-- 背景：0.05 的账号体系写明「v1 不做找回口令」，过渡方案是管理员重置
-- （008 之后的 /api/v1/admin/users/reset-password）。但「忘口令 = 找管理员」
-- 人一多就成瓶颈，自助找回是账号体系该有的正路。
--
-- 设计取舍：
-- - 只存 sha256(令牌)：和口令同理，库里不落能直接用的明文。库被拖走时
--   攻击者拿到的只是散列，而令牌只活 30 分钟，穷举 256 位熵也不可行。
-- - `used_at` 非空 = 已消费。令牌**一次有效**：重置成功即标记，
--   同一链接不能改两次口令（邮件可能在转发/同步里被别人看到）。
-- - 找回成功时把该用户**其余未用令牌一并删掉**：连点「发链接」发了三封，
--   旧链接该一起作废，否则「到底哪封算数」是笔糊涂账。
-- - 不做邮箱验证（注册仍然不验）。找回令牌只发到注册邮箱本身，
--   就是一种「控制该邮箱」的证明——比注册时假模假样验一把更实在。
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
