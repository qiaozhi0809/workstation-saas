CREATE TABLE school_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, key)
);
CREATE TRIGGER school_settings_touch BEFORE UPDATE ON school_settings
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- 学生永久脱敏编号(AI 里写作【学生07】):全校递增,已有行按 (created_at, mk) 回填
CREATE SEQUENCE student_mask_no_seq;
ALTER TABLE students ADD COLUMN mask_no integer;
UPDATE students s SET mask_no = r.n
FROM (SELECT id, row_number() OVER (ORDER BY created_at, mk) AS n FROM students) r
WHERE s.id = r.id;
SELECT setval('student_mask_no_seq', COALESCE(max(mask_no), 0) + 1, false) FROM students;
ALTER TABLE students
  ALTER COLUMN mask_no SET DEFAULT nextval('student_mask_no_seq'),
  ALTER COLUMN mask_no SET NOT NULL,
  ADD CONSTRAINT students_school_mask_no_key UNIQUE (school_id, mask_no);
ALTER SEQUENCE student_mask_no_seq OWNED BY students.mask_no;

ALTER TABLE enrollments DROP CONSTRAINT enrollments_status_check;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('active','graduated','transferred','removed','promoted'));

CREATE TABLE growth_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('表扬','谈话','家访','获奖','提醒','其他')),
  date date NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER growth_records_touch BEFORE UPDATE ON growth_records
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX growth_records_student ON growth_records (student_id, date DESC, created_at DESC);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  semester text NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  generated_by_ai boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER comments_touch BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX comments_student ON comments (student_id, created_at DESC);

CREATE TABLE ai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  template_id text,
  title text NOT NULL,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  params jsonb NOT NULL DEFAULT '{}',   -- 模板字段值或自由对话的资料开关
  save_as text CHECK (save_as IN ('comment')),
  mask boolean NOT NULL,
  batch_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER ai_chats_touch BEFORE UPDATE ON ai_chats
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX ai_chats_owner ON ai_chats (user_id, class_id, updated_at DESC);

CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL DEFAULT '',
  sent text,   -- 用户消息:实际发出的已脱敏全文
  status text NOT NULL DEFAULT 'done' CHECK (status IN ('streaming','done','error','stopped')),
  error text,
  prompt_tokens integer,
  completion_tokens integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER ai_messages_touch BEFORE UPDATE ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX ai_messages_chat ON ai_messages (chat_id, created_at);

CREATE TABLE ai_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
  position integer NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  note text,
  status text NOT NULL DEFAULT 'wait' CHECK (status IN ('wait','run','done','err')),
  content text NOT NULL DEFAULT '',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, position)
);
CREATE TRIGGER ai_batch_items_touch BEFORE UPDATE ON ai_batch_items
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE year_upgrades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  from_year_id uuid NOT NULL REFERENCES academic_years(id),
  to_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  plan jsonb NOT NULL,
  summary jsonb NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
