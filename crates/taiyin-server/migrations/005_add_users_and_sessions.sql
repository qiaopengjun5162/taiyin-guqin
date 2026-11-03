-- 账号体系（最小可用版）与「认领旧谱」。
--
-- 背景：此前只有「本机随机凭证」（`scores.owner_token`）——清缓存 / 换设备 =
-- 永久失去自己旧谱的改删权：谱还能看、也能另存成新谱，但改不了也删不掉。
-- 共享池要长期可用，必须有一种跨设备的身份。
--
-- 设计取舍：
-- - 邮箱 + 口令，不做邮箱验证（没有邮件通道），v1 也不做找回口令
--   （口令真丢了只能由管理员介入）。这一点要在 README / 界面上如实说明。
-- - 会话 token 是随机 32 字节（base64url），30 天过期，存库因此可吊销
--   （登出即删行），而不是自证式的 JWT。
-- - `scores.owner_user_id` 与 `owner_token` **并存**，老凭证路径完全不受影响：
--   登录用户发布时同时记 user_id，之后换设备凭登录态即可改删；
--   「认领」把已有的本机凭证谱挂到账号下，且必须出示原凭证——
--   否则任何人登录一下就能认领别人的谱。
ALTER TABLE scores ADD COLUMN IF NOT EXISTS owner_user_id UUID;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS scores_owner_user_id_idx ON scores(owner_user_id);
