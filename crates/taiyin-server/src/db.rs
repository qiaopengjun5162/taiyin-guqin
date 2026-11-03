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
pub async fn init_pool(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;

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
