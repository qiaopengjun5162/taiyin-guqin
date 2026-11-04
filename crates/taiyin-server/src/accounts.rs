//! # 账号与会话（最小可用版）
//!
//! ## 为什么需要它
//!
//! 此前曲谱的所有权只有一条腿：**本机随机凭证**（`scores.owner_token`，存在浏览器里）。
//! 它的代价是清缓存 / 换设备 = 永久失去自己旧谱的改删权——谱还能看、也能另存，
//! 但改不了删不掉。共享池要长期可用，必须有一种跨设备的身份。
//!
//! ## 这一版刻意不做什么
//!
//! - **不做邮箱验证**：没有邮件通道，验证了也是假的。
//! - **不做找回口令**：口令真丢了只能由管理员介入。这两条要在界面上如实说明，
//!   不能让人以为「注册了就等于安全托管」。
//! - **不用自证式 JWT**：会话 token 是随机 32 字节、存库、30 天过期，
//!   登出即删行——因为「能吊销」比「无需查库」重要得多（泄露时可立刻止损）。
//!
//! ## 与旧凭证的关系
//!
//! 两者**并存**，不是替换：`owner_token` 那条路径完全不动，
//! 登录用户发布时额外记 `owner_user_id`，之后换设备凭登录态即可改删。
//! 把老谱挂到账号下（认领）必须出示原凭证，否则任何人登录一下就能认领别人的谱。

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::http::HeaderMap;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::{PublicUser, User};

/// 会话有效期。太短逼人反复登录，太长则泄露后敞口大；30 天是这两头的折中。
const SESSION_TTL_DAYS: i64 = 30;
/// 口令最短长度。不设复杂度规则（那种规则只会逼人写 `P@ssw0rd1`），只卡长度。
pub const MIN_PASSWORD_LENGTH: usize = 8;
const MAX_PASSWORD_LENGTH: usize = 200;
const MAX_EMAIL_LENGTH: usize = 254;
const MAX_DISPLAY_NAME_LENGTH: usize = 40;

/// 会话 token 的随机字节数（32 字节 = 256 位，穷举不可行）。
const SESSION_TOKEN_BYTES: usize = 32;

/// 登录 / 注册成功后的返回体。
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user: PublicUser,
    pub token: String,
}

/// 生成口令散列。
///
/// Argon2id（OWASP 当前推荐），盐随机并随散列一起存——
/// 所以两条相同的口令不会得到相同的散列，拖库也拿不到彩虹表。
pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| {
            tracing::error!(error = %e, "password hash failed");
            AppError::ServiceUnavailable("口令处理失败，请稍后重试".into())
        })
}

/// 校验口令。散列串损坏 / 算法不识别都按「不匹配」处理，不区分报错——
/// 区分了等于告诉攻击者这个账号用的是不是旧算法。
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// 生成会话 token（base64url，可直接放进 `Authorization` 头）。
pub fn generate_session_token() -> String {
    let mut bytes = [0u8; SESSION_TOKEN_BYTES];
    fill_random(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn fill_random(buf: &mut [u8]) {
    use rand::RngCore;
    rand::thread_rng().fill_bytes(buf);
}

/// 一次性口令的长度：≥ `MIN_PASSWORD_LENGTH`（8），又短不到「随手就能猜」。
const TEMP_PASSWORD_LENGTH: usize = 12;

/// 生成一次性口令（管理员重置时用）。
///
/// 字母表刻意去掉 `0/O/1/l/I` 这类「念出来分不清」的字符——
/// 这串要由管理员在聊天工具里转告本人，念错一位就得多来一轮。
/// 随机源是 `thread_rng`（密码学安全），12 位 ≈ 69 位熵，够挡在线猜测。
pub fn generate_temporary_password() -> String {
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..TEMP_PASSWORD_LENGTH)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

/// 从 `Authorization: Bearer <token>` 取出当前登录用户。
///
/// 查库而非自证：会话要能吊销（登出即失效），也要能被管理员单条清理。
/// 过期会话等同于未登录，不单独报错——避免泄露「这个 token 曾经有效」。
pub async fn current_user(headers: &HeaderMap, pool: &PgPool) -> AppResult<Option<User>> {
    let Some(token) = bearer_token(headers) else {
        return Ok(None);
    };

    let user = sqlx::query_as::<_, User>(
        "SELECT u.id, u.email, u.password_hash, u.display_name, u.created_at \
         FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.token = $1 AND s.expires_at > now()",
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

/// 读取 `Authorization: Bearer <...>`。缺失 / 格式不对都视为未携带。
pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let rest = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?;
    let rest = rest.trim();
    (!rest.is_empty()).then_some(rest)
}

/// 建会话并存库，返回 token。
pub async fn create_session(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    let token = generate_session_token();
    let expires_at = session_expires_at();
    sqlx::query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)")
        .bind(&token)
        .bind(user_id)
        .bind(expires_at)
        .execute(pool)
        .await?;
    Ok(token)
}

/// 吊销会话（登出）。删掉不存在的 token 不算错误——幂等更符合「登出」的语义。
pub async fn revoke_session(pool: &PgPool, token: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM sessions WHERE token = $1")
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}

/// 会话过期时间点（登出即删行，所以这个时间只是入库时的上界）。
pub fn session_expires_at() -> DateTime<Utc> {
    Utc::now() + Duration::days(SESSION_TTL_DAYS)
}

/// 校验并归一化邮箱。
///
/// 只做形状检查（不发验证邮件，假装验证了更糟）：去空白、转小写，
/// 避免 `A@x.com` 与 `a@x.com` 注册成两个账号。
pub fn normalize_email(raw: &str) -> AppResult<String> {
    let email = raw.trim().to_lowercase();
    if email.is_empty() {
        return Err(AppError::Validation("邮箱不能为空".into()));
    }
    if email.chars().count() > MAX_EMAIL_LENGTH {
        return Err(AppError::Validation("邮箱太长了".into()));
    }
    // 极简形状校验：不追求 RFC 完整，目的是挡住明显的手误与滥用。
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if local.is_empty() || domain.is_empty() || !domain.contains('.') || parts.next().is_some() {
        return Err(AppError::Validation("邮箱格式不对".into()));
    }
    Ok(email)
}

/// 校验口令长度。刻意不检查字符种类——那是把「难记」当成「安全」。
pub fn validate_password(password: &str) -> AppResult<()> {
    let len = password.chars().count();
    if len < MIN_PASSWORD_LENGTH {
        return Err(AppError::Validation(format!(
            "口令至少 {MIN_PASSWORD_LENGTH} 位"
        )));
    }
    if len > MAX_PASSWORD_LENGTH {
        return Err(AppError::Validation("口令太长了".into()));
    }
    Ok(())
}

/// 昵称（可空，空则匿名）。按字符数而非字节数截断，中文才不会被砍成半个字。
pub fn normalize_display_name(raw: Option<&str>) -> AppResult<String> {
    let name = raw.unwrap_or_default().trim();
    if name.chars().count() > MAX_DISPLAY_NAME_LENGTH {
        return Err(AppError::Validation(format!(
            "昵称不能超过 {MAX_DISPLAY_NAME_LENGTH} 字"
        )));
    }
    Ok(name.to_string())
}

/// 转成可下发的结构（不含 `password_hash`）。
pub fn public_user(user: &User) -> PublicUser {
    PublicUser {
        id: user.id,
        email: user.email.clone(),
        display_name: user.display_name.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_verify_roundtrip() {
        let hash = hash_password("qin-you-2026").unwrap();
        assert!(verify_password("qin-you-2026", &hash));
        assert!(!verify_password("qin-you-2027", &hash));
    }

    #[test]
    fn same_password_yields_different_hashes() {
        let a = hash_password("same-password").unwrap();
        let b = hash_password("same-password").unwrap();
        // 盐不同 → 散列必须不同，否则拖库就能用彩虹表反推
        assert_ne!(a, b);
    }

    #[test]
    fn broken_hash_is_treated_as_mismatch() {
        assert!(!verify_password("whatever", "not-a-valid-hash"));
    }

    #[test]
    fn email_normalization() {
        assert_eq!(
            normalize_email("  Qin@Example.COM ").unwrap(),
            "qin@example.com"
        );
        assert!(normalize_email("").is_err());
        assert!(normalize_email("nosign").is_err());
        assert!(normalize_email("a@b").is_err());
        assert!(normalize_email("a@b@c.com").is_err());
    }

    #[test]
    fn password_length_rules() {
        assert!(validate_password("1234567").is_err());
        assert!(validate_password("12345678").is_ok());
        assert!(validate_password(&"x".repeat(201)).is_err());
    }

    #[test]
    fn temporary_password_is_long_random_and_unambiguous() {
        let a = generate_temporary_password();
        let b = generate_temporary_password();
        assert_ne!(a, b, "两次生成必须不同，否则随机源没接上");
        assert_eq!(a.chars().count(), TEMP_PASSWORD_LENGTH);
        // 必须过登录那关的长度规则，否则「生成的口令登不进去」
        assert!(validate_password(&a).is_ok());
        // 去掉易混字符：念给对方听不能出现 0/O/1/l/I
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() && !"0O1lI".contains(c)));
    }

    #[test]
    fn session_token_is_random_and_url_safe() {
        let a = generate_session_token();
        let b = generate_session_token();
        assert_ne!(a, b);
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
        assert_eq!(
            URL_SAFE_NO_PAD.decode(&a).unwrap().len(),
            SESSION_TOKEN_BYTES
        );
    }

    #[test]
    fn bearer_parsing_is_lenient_but_not_silent() {
        let mut h = HeaderMap::new();
        assert!(bearer_token(&h).is_none());

        h.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer abc123".parse().unwrap(),
        );
        assert_eq!(bearer_token(&h), Some("abc123"));

        h.insert(
            axum::http::header::AUTHORIZATION,
            "bearer abc".parse().unwrap(),
        );
        assert_eq!(bearer_token(&h), Some("abc"));

        h.insert(
            axum::http::header::AUTHORIZATION,
            "Basic xyz".parse().unwrap(),
        );
        assert!(bearer_token(&h).is_none());
    }
}
