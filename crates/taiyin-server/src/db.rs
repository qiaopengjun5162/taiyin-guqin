use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// 应用的共享状态（注入 Axum Router）。
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

/// 初始化数据库连接池并自动运行未应用的迁移。
pub async fn init_pool(database_url: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;

    let migrator = sqlx::migrate::Migrator::new(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/migrations"
    )))
    .await?;
    migrator.run(&pool).await?;

    tracing::info!("database migrated");
    Ok(pool)
}
