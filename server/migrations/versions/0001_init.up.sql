CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION trg_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  logo_url text,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  locale text NOT NULL DEFAULT 'zh-CN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER schools_touch BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CREATE TRIGGER academic_years_touch BEFORE UPDATE ON academic_years
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE UNIQUE INDEX academic_years_one_active ON academic_years (school_id) WHERE is_active;

CREATE TABLE grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER grades_touch BEFORE UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade_id uuid NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  name text NOT NULL,
  seat_rows int NOT NULL DEFAULT 7,
  seat_cols int NOT NULL DEFAULT 4,
  homeroom_teacher_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER classes_touch BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX classes_school_year ON classes (school_id, academic_year_id);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  login_name text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','archived')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, login_name)
);
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_no text,
  title text,
  subjects text[] NOT NULL DEFAULT '{}',
  bio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER teachers_touch BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  mk text NOT NULL,                 -- 永久脱敏编号
  name text NOT NULL,
  gender text,
  student_no text,
  birthdate date,
  avatar_seed text,
  family_structure text,
  learning_summary text,
  personality text,
  health_notes text,
  tags text[] NOT NULL DEFAULT '{}',
  teacher_notes jsonb,              -- {"<作者 user_id>": <笔记>},只返回调用者本人那条
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, mk)
);
CREATE TRIGGER students_touch BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  seat_row int,
  seat_col int,
  entered_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','graduated','transferred')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER enrollments_touch BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE UNIQUE INDEX enrollments_one_active_per_year
  ON enrollments (student_id, academic_year_id) WHERE status = 'active';
CREATE INDEX enrollments_class_status ON enrollments (class_id, status);

CREATE TABLE teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  identity text NOT NULL CHECK (identity IN ('homeroom','subject','assistant')),
  subject text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER teacher_assignments_touch BEFORE UPDATE ON teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX teacher_assignments_teacher_class ON teacher_assignments (teacher_id, class_id);

CREATE TABLE parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  wechat_openid text,
  occupation text,
  relation_hint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER parents_touch BEFORE UPDATE ON parents
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE parent_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relation text,
  is_primary boolean NOT NULL DEFAULT false,
  notify_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, student_id)
);
CREATE UNIQUE INDEX parent_links_one_primary ON parent_links (student_id) WHERE is_primary;

CREATE TABLE role_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_type text NOT NULL CHECK (role_type IN (
    'principal','dean','grade_head','it_admin',
    'homeroom_teacher','subject_teacher','assistant_teacher',
    'primary_parent','secondary_parent'
  )),
  scope jsonb NOT NULL DEFAULT '{}',   -- {school_id?, grade_id?, class_id?, student_id?, subject?}
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX role_bindings_user ON role_bindings (user_id);
CREATE INDEX role_bindings_year ON role_bindings (academic_year_id);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  object_type text,
  object_id text,
  ip inet,
  user_agent text,
  success boolean NOT NULL,
  extra jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_user_at ON audit_logs (user_id, at DESC);
CREATE INDEX audit_logs_object ON audit_logs (object_type, object_id);
