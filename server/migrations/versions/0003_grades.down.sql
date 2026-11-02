DROP TABLE IF EXISTS scores;
DROP TABLE IF EXISTS exams;
UPDATE enrollments SET status = 'transferred' WHERE status = 'removed';
ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_check;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('active','graduated','transferred'));
ALTER TABLE students
  DROP COLUMN IF EXISTS contacts,
  DROP COLUMN IF EXISTS note,
  DROP COLUMN IF EXISTS family_note,
  DROP COLUMN IF EXISTS boarding;
ALTER TABLE classes DROP COLUMN IF EXISTS subjects;
