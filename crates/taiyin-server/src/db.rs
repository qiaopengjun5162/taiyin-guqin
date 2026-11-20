use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

use crate::llm::LlmConfig;

/// 应用的共享状态（注入 Axum Router）。
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub llm: LlmConfig,
}

/// 初始化数据库连接池并自动运行未应用的迁移。
///
/// 三个参数从环境变量读，默认值按「单机小服务」定：
///
/// - `DB_MAX_CONNECTIONS`（默认 10）：Postgres 每条连接是一个后端进程，
///   池子不是越大越好；1–2 vCPU 的机器上 10 条已经足够跑满 CPU。
///   多实例部署时要按 `实例数 × 10 ≤ max_connections` 估，否则会把库连满。
/// - `DB_ACQUIRE_TIMEOUT_SECS`（默认 5）：**这是关键的一条**。sqlx 默认 30 s，
///   池子饱和时请求会静静排队半分钟，然后以一个 500 收场——用户看到的是
///   「点了半天才报错」，日志里也没有慢查询可查（时间花在等连接上）。
///   5 s 让过载快速暴露成错误，而不是把延迟摊给所有人。
/// - `DB_MIN_CONNECTIONS`（默认 1）：保持一条热连接，避免冷启动首个请求多一次握手。
pub async fn init_pool(database_url: &str) -> anyhow::Result<PgPool> {
    let max_connections = env_parse("DB_MAX_CONNECTIONS", 10u32).max(1);
    let min_connections = env_parse("DB_MIN_CONNECTIONS", 1u32).min(max_connections);
    let acquire_secs = env_parse("DB_ACQUIRE_TIMEOUT_SECS", 5u64).max(1);

    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(std::time::Duration::from_secs(acquire_secs))
        .connect(database_url)
        .await?;

    tracing::info!(
        max_connections,
        min_connections,
        acquire_timeout_secs = acquire_secs,
        "database pool ready"
    );

    // 用 `migrate!` 宏在**编译期**把 migrations 嵌进二进制。
    //
    // 不能用 `Migrator::new(Path)` 运行时读目录：镜像运行阶段是 distroless，
    // 里面既没有 migrations 目录、也没有 shell 救场；且 `CARGO_MANIFEST_DIR`
    // 是构建机上的绝对路径（如 /app/crates/taiyin-server），运行时必然不存在，
    // 容器会在启动迁移这一步直接失败。
    let migrator = sqlx::migrate!("./migrations");
    migrator.run(&pool).await?;

    tracing::info!("database migrated");
    Ok(pool)
}

/// 读环境变量并解析；缺失 / 非法都回退默认值。
///
/// 与小服务的取向一致：一个笔误的调参变量不该让进程起不来，
/// 但日志里会打出最终生效值（见上面的 `database pool ready`）。
fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    /*
     * Rust 测试并行跑，而 `set_var` 是**进程级**全局状态。用各自唯一的 key
     * 避免互相踩；每个用例结束时清掉，不给后续用例留残留。
     */
    fn with_env<T>(key: &str, value: Option<&str>, f: impl FnOnce() -> T) -> T {
        match value {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }
        let out = f();
        unsafe { std::env::remove_var(key) };
        out
    }

    #[test]
    fn env_parse_falls_back_when_missing() {
        let got = with_env("TAIYIN_TEST_DB_MISSING", None, || {
            env_parse("TAIYIN_TEST_DB_MISSING", 10u32)
        });
        assert_eq!(got, 10);
    }

    #[test]
    fn env_parse_reads_valid_value() {
        let got = with_env("TAIYIN_TEST_DB_VALID", Some("25"), || {
            env_parse("TAIYIN_TEST_DB_VALID", 10u32)
        });
        assert_eq!(got, 25);
    }

    /// 笔误的调参变量不该让进程起不来——回退默认值，而不是 panic。
    #[test]
    fn env_parse_falls_back_on_garbage() {
        for bad in ["abc", "10.5", "", "  ", "-1"] {
            let got = with_env("TAIYIN_TEST_DB_GARBAGE", Some(bad), || {
                env_parse("TAIYIN_TEST_DB_GARBAGE", 10u32)
            });
            assert_eq!(got, 10, "输入 {bad:?} 应回退默认值");
        }
    }

    /// 前后空格要容忍：环境变量文件里手写 `DB_MAX_CONNECTIONS= 5` 很常见。
    #[test]
    fn env_parse_trims_whitespace() {
        let got = with_env("TAIYIN_TEST_DB_SPACES", Some("  7  "), || {
            env_parse("TAIYIN_TEST_DB_SPACES", 10u32)
        });
        assert_eq!(got, 7);
    }

    /// 解析成不同目标类型也必须成立（init_pool 里用了 u32 与 u64）。
    #[test]
    fn env_parse_works_for_u64() {
        let got = with_env("TAIYIN_TEST_DB_U64", Some("5"), || {
            env_parse("TAIYIN_TEST_DB_U64", 5u64)
        });
        assert_eq!(got, 5u64);
    }
}
