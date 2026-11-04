-- 社区列表要能「按热度排序」：热度 = 收藏数。
--
-- 不每次 LIST 时 JOIN favorites 做 COUNT（并发下慢且会锁表），而是落一个计数器列，
-- 收藏 / 取消时在同一条语句里 +/-，读列表时直接 ORDER BY 这一列。
ALTER TABLE scores ADD COLUMN IF NOT EXISTS favorites_count BIGINT NOT NULL DEFAULT 0;

-- 已有数据回填：把历史收藏数算进来，否则老谱永远是 0、永远排不到前面。
UPDATE scores SET favorites_count = (
  SELECT count(*) FROM favorites WHERE favorites.score_id = scores.id
);

-- 热度排序的索引：favorites_count 降序，并列用 updated_at 降序（与默认排序一致）。
CREATE INDEX IF NOT EXISTS scores_popular_idx ON scores (favorites_count DESC, updated_at DESC);
