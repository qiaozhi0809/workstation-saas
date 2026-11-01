ALTER TABLE classes
  ADD COLUMN seat_version int NOT NULL DEFAULT 0,
  ADD CONSTRAINT classes_seat_dims CHECK (seat_rows BETWEEN 1 AND 12 AND seat_cols BETWEEN 1 AND 12);

ALTER TABLE enrollments
  ADD COLUMN class_role text CHECK (class_role IS NULL OR char_length(class_role) BETWEEN 1 AND 10),
  ADD COLUMN seat_locked boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT enrollments_seat_pair CHECK ((seat_row IS NULL) = (seat_col IS NULL)),
  ADD CONSTRAINT enrollments_lock_needs_seat CHECK (NOT seat_locked OR seat_row IS NOT NULL);
CREATE UNIQUE INDEX enrollments_one_per_seat
  ON enrollments (class_id, seat_row, seat_col)
  WHERE status = 'active' AND seat_row IS NOT NULL;

CREATE TABLE attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL CHECK (status IN ('leave','absent','late')),   -- 出勤 = 无记录
  reason text CHECK (reason IS NULL OR char_length(reason) <= 100),
  marked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, date)
);
CREATE TRIGGER attendances_touch BEFORE UPDATE ON attendances
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX attendances_class_date_status ON attendances (class_id, date, status);

CREATE TABLE attendance_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date date NOT NULL,
  confirmed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, date)
);
CREATE TRIGGER attendance_days_touch BEFORE UPDATE ON attendance_days
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id uuid NOT NULL,                       -- 一次操作(单人或全班)共享,用于幂等与整批撤销
  enrollment_id uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('individual','whole_class')),
  reason_text text NOT NULL CHECK (char_length(reason_text) BETWEEN 1 AND 20),
  score_delta int NOT NULL CHECK (score_delta BETWEEN -10 AND 10 AND score_delta <> 0),
  subject text,
  given_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  given_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (op_id, enrollment_id)
);
CREATE TRIGGER reviews_touch BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX reviews_class_given ON reviews (class_id, given_at DESC, id DESC);
CREATE INDEX reviews_enrollment_live ON reviews (enrollment_id, given_at) WHERE revoked_at IS NULL;

CREATE TABLE seat_arrangements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  version int NOT NULL,
  seat_rows int NOT NULL,
  seat_cols int NOT NULL,
  layout jsonb NOT NULL,                     -- [{"enrollment_id","row","col","locked"}]
  saved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, version)
);

CREATE TABLE class_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL UNIQUE REFERENCES classes(id) ON DELETE CASCADE,
  left_title text NOT NULL DEFAULT '今日课程',
  left_text text NOT NULL DEFAULT '',
  right_title text NOT NULL DEFAULT '今日事项',
  right_text text NOT NULL DEFAULT '',
  countdown_label text,
  countdown_date date,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER class_boards_touch BEFORE UPDATE ON class_boards
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE TABLE todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200),
  done boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER todos_touch BEFORE UPDATE ON todos
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
CREATE INDEX todos_owner ON todos (owner_user_id, done, created_at DESC);

CREATE TABLE user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  teacher_figure text NOT NULL DEFAULT 'female' CHECK (teacher_figure IN ('female','male')),
  idle_animation boolean NOT NULL DEFAULT true,
  review_reasons jsonb,                      -- NULL = 使用内置默认理由
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER user_preferences_touch BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
