CREATE TABLE grade_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade_id uuid NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  exam_type text NOT NULL CHECK (exam_type IN ('月考','期中','期末','周测','单元测','模拟考','其他')),
  date date NOT NULL,
  subjects jsonb NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER grade_exams_touch BEFORE UPDATE ON grade_exams
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX grade_exams_grade_date ON grade_exams (grade_id, date DESC);

ALTER TABLE exams ADD COLUMN grade_exam_id uuid REFERENCES grade_exams(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX exams_one_per_grade_exam ON exams (grade_exam_id, class_id)
  WHERE grade_exam_id IS NOT NULL;

CREATE TABLE notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  from_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 50),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  target jsonb NOT NULL,
  target_label text NOT NULL,
  require_ack boolean NOT NULL DEFAULT false,
  recalled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notices_from_created ON notices (from_user_id, created_at DESC);

CREATE TABLE notice_recipients (
  notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz,
  acked_at timestamptz,
  ack_content text,
  PRIMARY KEY (notice_id, user_id)
);
CREATE INDEX notice_recipients_user ON notice_recipients (user_id, notice_id);

CREATE INDEX audit_logs_at ON audit_logs (at DESC);
CREATE INDEX audit_logs_action_at ON audit_logs (action, at DESC);

DO $$
DECLARE
  dup record;
BEGIN
  FOR dup IN
    SELECT class_id, count(*) AS n
    FROM teacher_assignments
    WHERE identity = 'homeroom' AND ended_at IS NULL
    GROUP BY class_id
    HAVING count(*) > 1
  LOOP
    RAISE EXCEPTION 'class % has % active homeroom assignments; end all but one before migrating',
      dup.class_id, dup.n;
  END LOOP;
END $$;

CREATE UNIQUE INDEX teacher_assignments_one_homeroom ON teacher_assignments (class_id)
  WHERE identity = 'homeroom' AND ended_at IS NULL;
