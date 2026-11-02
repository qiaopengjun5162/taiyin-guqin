-- 曲谱自带定弦（调式）。
--
-- 同一组减字在不同定弦上音高不同：正调五弦是 A，蕤宾调紧五弦到 B♭。
-- 谱子不记定弦，隔天打开时全局定弦已经被换成别的，再往里加音就会按
-- 错误定弦反推，差半音且不易察觉。
--
-- 默认值取正调，正好覆盖迁移前已存在的所有曲谱（那个版本只有正调可用）。
ALTER TABLE scores ADD COLUMN IF NOT EXISTS tuning TEXT NOT NULL DEFAULT 'zhengdiao';
