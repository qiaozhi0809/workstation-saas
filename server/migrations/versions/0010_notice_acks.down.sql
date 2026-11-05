DROP TABLE IF EXISTS notice_students;
ALTER TABLE notice_recipients
  DROP CONSTRAINT IF EXISTS notice_recipients_ack_content_ck,
  DROP COLUMN IF EXISTS ack_choice;
DROP INDEX IF EXISTS notices_class_created;
ALTER TABLE notices
  DROP CONSTRAINT IF EXISTS notices_require_ack_ck,
  DROP CONSTRAINT IF EXISTS notices_ack_options_ck,
  DROP CONSTRAINT IF EXISTS notices_students_without_parent_ck,
  DROP COLUMN IF EXISTS students_without_parent,
  DROP COLUMN IF EXISTS class_id,
  DROP COLUMN IF EXISTS ack_deadline,
  DROP COLUMN IF EXISTS ack_allow_note,
  DROP COLUMN IF EXISTS ack_options,
  DROP COLUMN IF EXISTS ack_kind,
  DROP COLUMN IF EXISTS audience;
