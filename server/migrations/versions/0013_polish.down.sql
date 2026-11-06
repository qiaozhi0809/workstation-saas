ALTER TABLE users DROP COLUMN IF EXISTS token_floor_at;
ALTER TABLE user_preferences DROP COLUMN IF EXISTS onboarded;
ALTER TABLE notice_students
  DROP COLUMN IF EXISTS class_name,
  DROP COLUMN IF EXISTS class_id;
