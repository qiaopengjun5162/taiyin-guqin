use sqlx::postgres::PgPoolOptions;

pub async fn test_pool() -> sqlx::PgPool {
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://taiyin:taiyin_dev@localhost:5432/taiyin".into());
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .expect("connect to postgres (run `just docker-up` first)");
    let migrator = sqlx::migrate::Migrator::new(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/migrations"
    )))
    .await
    .expect("load migrations");
    migrator.run(&pool).await.expect("run migrations");
    pool
}
