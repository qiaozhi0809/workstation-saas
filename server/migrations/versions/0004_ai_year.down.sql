DROP TABLE IF EXISTS year_upgrades;
DROP TABLE IF EXISTS ai_batch_items;
DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_chats;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS growth_records;
UPDATE enrollments SET status = 'active' WHERE status = 'promoted';
ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_check;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('active','graduated','transferred','removed'));
ALTER TABLE students DROP COLUMN IF EXISTS mask_no;
DROP SEQUENCE IF EXISTS student_mask_no_seq;
DROP TABLE IF EXISTS school_settings;
