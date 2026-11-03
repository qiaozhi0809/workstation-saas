-- 注意:upgrade 时删掉的重复评语不会恢复。
DROP INDEX IF EXISTS comments_one_per_content;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE academic_years DROP COLUMN IF EXISTS term2_start;
ALTER TABLE grades DROP COLUMN IF EXISTS stage;
