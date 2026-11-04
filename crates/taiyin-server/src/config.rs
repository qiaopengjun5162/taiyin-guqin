//! 服务端配置集中管理：从环境变量读取，供 `app()` 与 `main()` 使用。
//!
//! 集中配置而非散落 `std::env::var` 调用，便于测试、审计与复用。

use std::env;

/// 服务端运行配置。
#[derive(Clone, Debug)]
pub struct ServerConfig {
    /// PostgreSQL 连接串。
    pub database_url: String,
    /// 允许的 CORS 来源（逗号分隔）。为空表示开发态放开（permissive）。
    pub allowed_origins: Vec<String>,
    /// 可选：设置后 `/translate/select`（及未来受保护端点）需携带此 key。
    pub translate_api_key: Option<String>,
    /// 全局限流：每 IP 每秒请求数。
    pub global_per_second: u64,
    /// 全局限流：突发容量。
    pub global_burst: u32,
    /// 翻译端点限流：每 IP 每秒请求数（更严格，因为调用 Anthropic）。
    pub translate_per_second: u64,
    /// 翻译端点限流：突发容量。
    pub translate_burst: u32,
    /// 认证端点限流（注册 / 登录）：每 IP 每秒请求数。
    ///
    /// 比全局更严：口令散列是**故意慢**的（Argon2id 每次数百毫秒），
    /// 不设限等于给攻击者一个「发几十个请求就把单核 CPU 打满」的开关，
    /// 正常用户会全部超时。同时它也是撞库的唯一入口。
    pub auth_per_second: u64,
    /// 认证端点限流：突发容量。留出「打错再试一次」的余量。
    pub auth_burst: u32,
    /// 发布端点（`POST /api/v1/scores`）限流：每 IP 每秒请求数。
    ///
    /// 发布是**写库**操作，没有它，一台机器就能把社区列表灌成垃圾场
    /// （脚本循环 POST，每条都成一行，翻页翻不完、搜索也搜不出东西）。
    /// 真人发布一首谱要几十秒，1 次/秒已经非常宽松。
    pub write_per_second: u64,
    /// 发布端点限流：突发容量。留出「一次批量导入十来首」的余地。
    pub write_burst: u32,
    /// 一个**账号**最多能在社区保留多少首谱。
    ///
    /// 限流管的是「每秒几次」，管不住「慢慢来」：一秒发一首、连发两天，
    /// 就是一整库垃圾。配额是**存量**闸门，与限流的**速率**闸门互补。
    ///
    /// 100 这个数按「一个人的真实打谱量」定：认真打谱一年也就几十首，
    /// 真正要发到一百首以上的，多半该自己建站或分批整理，而不是占着公共列表。
    pub publish_quota_per_account: i64,
    /// 一个**本机凭证**（未登录）最多能保留多少首。
    ///
    /// 比账号低得多，因为本机凭证是**随手可换**的：清了缓存就是一个新身份。
    /// 给未登录用户和账号一样的额度，等于这个闸门对脚本完全无效。
    /// 但也不能太低——刚上手、还没决定注册的人，发十首二十首都很正常。
    pub publish_quota_per_device: i64,
}

impl ServerConfig {
    /// 从环境变量构造；任意变量缺失时回退到安全默认值。
    pub fn from_env() -> Self {
        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://taiyin:taiyin_dev@localhost:5432/taiyin".into());

        let allowed_origins = env::var("ALLOWED_ORIGINS")
            .map(|s| parse_origins(&s))
            .unwrap_or_default();

        let translate_api_key = env::var("TRANSLATE_API_KEY").ok().filter(|k| !k.is_empty());

        let global_per_second = parse_u64("GLOBAL_RATE_PER_SECOND", 2);
        let global_burst = parse_u32("GLOBAL_RATE_BURST", 60);
        let translate_per_second = parse_u64("TRANSLATE_RATE_PER_SECOND", 1);
        let translate_burst = parse_u32("TRANSLATE_RATE_BURST", 5);
        let auth_per_second = parse_u64("AUTH_RATE_PER_SECOND", 2);
        let auth_burst = parse_u32("AUTH_RATE_BURST", 8);
        let write_per_second = parse_u64("WRITE_RATE_PER_SECOND", 1);
        let write_burst = parse_u32("WRITE_RATE_BURST", 10);
        // 负数没有意义（夹到 0）；0 是**刻意保留**的：出事时把配额设成 0 就等于
        // 立刻关掉发布入口，不用改代码、不用回滚，比「停服务」温和得多。
        let publish_quota_per_account = parse_i64("PUBLISH_QUOTA_PER_ACCOUNT", 100).max(0);
        let publish_quota_per_device = parse_i64("PUBLISH_QUOTA_PER_DEVICE", 30).max(0);

        Self {
            database_url,
            allowed_origins,
            translate_api_key,
            global_per_second,
            global_burst,
            translate_per_second,
            translate_burst,
            auth_per_second,
            auth_burst,
            write_per_second,
            write_burst,
            publish_quota_per_account,
            publish_quota_per_device,
        }
    }

    /// 是否启用了来源白名单（否则 CORS 放开）。
    pub fn cors_locked(&self) -> bool {
        !self.allowed_origins.is_empty()
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            database_url: "postgres://taiyin:taiyin_dev@localhost:5432/taiyin".into(),
            allowed_origins: Vec::new(),
            translate_api_key: None,
            global_per_second: 2,
            global_burst: 60,
            translate_per_second: 1,
            translate_burst: 5,
            auth_per_second: 2,
            auth_burst: 8,
            write_per_second: 1,
            write_burst: 10,
            publish_quota_per_account: 100,
            publish_quota_per_device: 30,
        }
    }
}

/// 解析逗号分隔的来源列表，去除空白与空项。纯函数，便于单测。
pub fn parse_origins(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|o| !o.is_empty())
        .map(str::to_string)
        .collect()
}

fn parse_u64(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn parse_u32(key: &str, default: u32) -> u32 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn parse_i64(key: &str, default: i64) -> i64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_origins_handles_spaces_and_empty() {
        assert_eq!(
            parse_origins("https://a.example.com, https://b.example.com ,"),
            vec!["https://a.example.com", "https://b.example.com"]
        );
        assert!(parse_origins("   ").is_empty());
        assert!(parse_origins("").is_empty());
    }

    #[test]
    fn cors_locked_reflects_origins() {
        assert!(
            !ServerConfig {
                allowed_origins: vec![],
                ..ServerConfig::default()
            }
            .cors_locked()
        );
        assert!(
            ServerConfig {
                allowed_origins: vec!["https://x.test".into()],
                ..ServerConfig::default()
            }
            .cors_locked()
        );
    }

    /// 配额默认值不能是 0：0 等于「谁都不能发布」，真按默认值跑起来会发现
    /// 整个社区只读——这种错不会报错，只会静默地没人能发。
    #[test]
    fn publish_quota_defaults_are_permissive() {
        let cfg = ServerConfig::default();
        assert!(cfg.publish_quota_per_account > 0);
        assert!(cfg.publish_quota_per_device > 0);
        // 未登录额度必须更紧，否则「换一个新凭证」就等于重置配额。
        assert!(cfg.publish_quota_per_device < cfg.publish_quota_per_account);
    }
}
