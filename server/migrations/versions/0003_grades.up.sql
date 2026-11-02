ALTER TABLE classes ADD COLUMN subjects jsonb;   -- NULL = 尚未初始化,读取时按学段预设推断

ALTER TABLE students
  ADD COLUMN boarding boolean NOT NULL DEFAULT false,
  ADD COLUMN family_note text,
  ADD COLUMN note text,
  ADD COLUMN contacts jsonb NOT NULL DEFAULT '[]';

ALTER TABLE enrollments DROP CONSTRAINT enrollments_status_check;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('active','graduated','transferred','removed'));

CREATE TABLE exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  exam_type text NOT NULL CHECK (exam_type IN ('月考','期中','期末','周测','单元测','模拟考','其他')),
  date date NOT NULL,
  subjects jsonb NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER exams_touch BEFORE UPDATE ON exams
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX exams_class_date ON exams (class_id, date DESC, created_at DESC);

CREATE TABLE scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  subject text NOT NULL,
  value numeric(5,1) CHECK (value IS NULL OR value >= 0),   -- NULL = 缺考;未录 = 无记录
  entered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, enrollment_id, subject)
);
CREATE TRIGGER scores_touch BEFORE UPDATE ON scores
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
