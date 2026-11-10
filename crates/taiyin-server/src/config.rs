//! 服务端配置集中管理：从环境变量读取，供 `app()` 与 `main()` 使用。
//!
//! 集中配置而非散落 `std::env::var` 调用，便于测试、审计与复用。

use std::env;

use crate::mailer::Mailer;

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
    /// 管理员口令（`x-admin-token`）。为 `None` 时管理端接口整体不可用。
    ///
    /// 只有一个人维护的服务，为它建一套角色表 / 权限系统不划算；
    /// 一把高熵口令 + 只读的管理端接口就够用，且不引入「谁把我设成管理员了」这类问题。
    /// **留空是安全的默认值**：没配就没有管理入口，不会因为忘记配置而敞开。
    pub admin_token: Option<String>,
    /// 寄信后端（找回口令的重置链接从这里发出）。
    ///
    /// 放在配置里而不是 `AppState`：和 `admin_token` 一样是「启动时装好的策略件」，
    /// 测试用 `..ServerConfig::default()` 就不用改一行（默认 `Log`，不真发信）。
    pub mailer: Mailer,
    /// 找回口令链接的站点前缀（重置链接 = `{app_base_url}/?reset_token=...`）。
    ///
    /// 生产是 GitHub Pages 的静态前端地址（含 basePath），开发填本机前端地址。
    pub app_base_url: String,
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
        // 空串等同「没配」：`docker run -e ADMIN_TOKEN=` 是很容易发生的手滑，
        // 若把它当成「口令就是空字符串」，任何人带一个空头就能进管理端。
        let admin_token = env::var("ADMIN_TOKEN")
            .ok()
            .filter(|t| !t.trim().is_empty());

        // 发信后端自取所需环境变量（SMTP_HOST 等，见 mailer.rs）；没配则降级为日志模式。
        let mailer = Mailer::from_env();
        // 默认指向 GitHub Pages 的静态前端（含 basePath），换前端部署时用 APP_BASE_URL 覆盖。
        let app_base_url = env::var("APP_BASE_URL")
            .unwrap_or_else(|_| "https://qiaopengjun5162.github.io/taiyin-guqin".into());

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
            admin_token,
            mailer,
            app_base_url,
        }
    }

    /// 是否启用了来源白名单（否则 CORS 放开）。
    pub fn cors_locked(&self) -> bool {
        !self.allowed_origins.is_empty()
    }

    /// 限流值必须都 >= 1：governor 的 `finish()` 对 0 会返回 `None`。
    ///
    /// 配额 0 是**刻意保留**的应急关闸（见 `from_env`）；限流没有对应的语义。
    /// 与其在启动时以一句含糊的 `expect` 失败，不如说清是哪个变量、合法范围，
    /// 以及想关掉发布入口该用什么——限流 0 通常是手滑或想「关闸」，两种都该指路。
    pub fn validate_rate_limits(&self) -> Result<(), String> {
        let pairs: [(&str, u64); 8] = [
            ("GLOBAL_RATE_PER_SECOND", self.global_per_second),
            ("GLOBAL_RATE_BURST", self.global_burst as u64),
            ("TRANSLATE_RATE_PER_SECOND", self.translate_per_second),
            ("TRANSLATE_RATE_BURST", self.translate_burst as u64),
            ("AUTH_RATE_PER_SECOND", self.auth_per_second),
            ("AUTH_RATE_BURST", self.auth_burst as u64),
            ("WRITE_RATE_PER_SECOND", self.write_per_second),
            ("WRITE_RATE_BURST", self.write_burst as u64),
        ];
        for (name, v) in pairs {
            if v == 0 {
                return Err(format!(
                    "{name} 不能为 0（限流的每秒数与突发容量都必须 >= 1）。\
                     想立刻关掉发布入口请用配额 0：PUBLISH_QUOTA_PER_ACCOUNT=0 \
                     / PUBLISH_QUOTA_PER_DEVICE=0，不用限流来关闸。"
                ));
            }
        }
        Ok(())
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
            admin_token: None,
            // 默认 Log（不真发信）——测试/开发没配 SMTP，绝不能默认往外发信
            mailer: Mailer::default(),
            app_base_url: "https://qiaopengjun5162.github.io/taiyin-guqin".into(),
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

    /// 限流 0 不能悄悄让服务起不来：要指明是哪个变量，并把「想关闸」
    /// 引到配额 0 上去（配额 0 是刻意保留的应急关闸）。
    #[test]
    fn rate_limits_reject_zero_with_guidance() {
        let cfg = ServerConfig::default();
        assert!(cfg.validate_rate_limits().is_ok(), "默认配置应可用");

        let bad = ServerConfig {
            global_burst: 0,
            ..ServerConfig::default()
        };
        let msg = bad.validate_rate_limits().expect_err("burst=0 应被拒");
        assert!(msg.contains("GLOBAL_RATE_BURST"), "应指明是哪个变量：{msg}");
        assert!(
            msg.contains("PUBLISH_QUOTA_PER_ACCOUNT=0"),
            "应指引用配额 0 关闸：{msg}"
        );

        let bad_rate = ServerConfig {
            translate_per_second: 0,
            ..ServerConfig::default()
        };
        assert!(
            bad_rate
                .validate_rate_limits()
                .expect_err("per_second=0 应被拒")
                .contains("TRANSLATE_RATE_PER_SECOND")
        );
    }
}
