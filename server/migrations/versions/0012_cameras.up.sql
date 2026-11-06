-- M5c:节次、课表、摄像头。只建新表,外键都在新表上,不改已有表。

-- 节次时间:每校一套,节次号 1–12
CREATE TABLE periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  no smallint NOT NULL CHECK (no BETWEEN 1 AND 12),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  CHECK (starts_at < ends_at),
  UNIQUE (school_id, no)
);

-- 课表:班级 × 学年 × 星期(1–7)× 节次;老师删除后置空
CREATE TABLE timetable_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  period_no smallint NOT NULL,
  subject text NOT NULL,
  teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, academic_year_id, weekday, period_no)
);
CREATE INDEX timetable_entries_teacher_weekday ON timetable_entries (teacher_id, weekday);

-- 摄像头:rtsp_username / rtsp_password 存 v2: 密文
CREATE TABLE cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  location text NOT NULL CHECK (location IN ('教室','走廊','操场','食堂','其他')),
  rtsp_url text NOT NULL,
  rtsp_username text,
  rtsp_password text,
  enabled boolean NOT NULL DEFAULT true,
  transcode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cameras_school_class ON cameras (school_id, class_id);

CREATE TRIGGER timetable_entries_touch BEFORE UPDATE ON timetable_entries
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE TRIGGER cameras_touch BEFORE UPDATE ON cameras
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
