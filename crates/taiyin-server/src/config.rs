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

        Self {
            database_url,
            allowed_origins,
            translate_api_key,
            global_per_second,
            global_burst,
            translate_per_second,
            translate_burst,
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
                database_url: String::new(),
                allowed_origins: vec![],
                translate_api_key: None,
                global_per_second: 2,
                global_burst: 60,
                translate_per_second: 1,
                translate_burst: 5,
            }
            .cors_locked()
        );
        assert!(
            ServerConfig {
                database_url: String::new(),
                allowed_origins: vec!["https://x.test".into()],
                translate_api_key: None,
                global_per_second: 2,
                global_burst: 60,
                translate_per_second: 1,
                translate_burst: 5,
            }
            .cors_locked()
        );
    }
}
