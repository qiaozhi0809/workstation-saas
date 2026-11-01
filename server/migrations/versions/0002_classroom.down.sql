DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS todos;
DROP TABLE IF EXISTS class_boards;
DROP TABLE IF EXISTS seat_arrangements;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS attendance_days;
DROP TABLE IF EXISTS attendances;
DROP INDEX IF EXISTS enrollments_one_per_seat;
ALTER TABLE enrollments
  DROP CONSTRAINT IF EXISTS enrollments_lock_needs_seat,
  DROP CONSTRAINT IF EXISTS enrollments_seat_pair,
  DROP COLUMN IF EXISTS seat_locked,
  DROP COLUMN IF EXISTS class_role;
ALTER TABLE classes
  DROP CONSTRAINT IF EXISTS classes_seat_dims,
  DROP COLUMN IF EXISTS seat_version;
