use sqlx::postgres::PgPoolOptions;

pub async fn test_pool() -> sqlx::PgPool {
    test_pool_with(2).await
}

/// 指定连接数建池。
///
/// 默认 2 条连接对绝大多数用例够用，但**并发**用例不行：连接池本身就是一道
/// 串行化闸门，2 条连接下 8 个并发请求会被池挡成 2 个 2 个地跑，
/// 事务里的行锁 / 建议锁根本没机会正面相撞——测试会「恰好通过」，
/// 而真实的错（少加锁）一点也测不出来。
pub async fn test_pool_with(max_connections: u32) -> sqlx::PgPool {
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://taiyin:taiyin_dev@localhost:5432/taiyin".into());
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
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
