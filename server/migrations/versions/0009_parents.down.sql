ALTER TABLE comments DROP COLUMN IF EXISTS parent_visible;
DROP INDEX IF EXISTS parent_links_parent;
DROP INDEX IF EXISTS parent_links_one_primary;
-- 回退前可能已有"旧主家长已结束、新主家长未结束"的两条主家长,先把已结束的降为非主家长
UPDATE parent_links SET is_primary = false WHERE status = 'ended' AND is_primary;
CREATE UNIQUE INDEX parent_links_one_primary ON parent_links (student_id) WHERE is_primary;
ALTER TABLE parent_links
  DROP CONSTRAINT IF EXISTS parent_links_ended_at_ck,
  DROP CONSTRAINT IF EXISTS parent_links_readonly_since_ck,
  DROP COLUMN IF EXISTS created_by_user_id,
  DROP COLUMN IF EXISTS ended_at,
  DROP COLUMN IF EXISTS readonly_since,
  DROP COLUMN IF EXISTS status;
