-- notices:通知对象(老师 / 家长)、结构化回执、班级公告归属。新增列都有默认值,旧通知全部是 teachers / none。
ALTER TABLE notices
  ADD COLUMN audience text NOT NULL DEFAULT 'teachers'
    CHECK (audience IN ('teachers','parents')),
  ADD COLUMN ack_kind text NOT NULL DEFAULT 'none'
    CHECK (ack_kind IN ('none','confirm','choice')),
  ADD COLUMN ack_options jsonb,
  ADD COLUMN ack_allow_note boolean NOT NULL DEFAULT false,
  ADD COLUMN ack_deadline timestamptz,
  ADD COLUMN class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  ADD COLUMN students_without_parent integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT notices_students_without_parent_ck CHECK (students_without_parent >= 0),
  ADD CONSTRAINT notices_ack_options_ck CHECK ((ack_kind = 'choice') = (ack_options IS NOT NULL)),
  ADD CONSTRAINT notices_require_ack_ck CHECK (require_ack = (ack_kind <> 'none'));

CREATE INDEX notices_class_created ON notices (class_id, created_at DESC) WHERE class_id IS NOT NULL;

-- notice_recipients:选择题的选项序号;留言 200 字上限
ALTER TABLE notice_recipients
  ADD COLUMN ack_choice smallint,
  ADD CONSTRAINT notice_recipients_ack_content_ck
    CHECK (ack_content IS NULL OR char_length(ack_content) <= 200);

-- 发给家长的通知:每个范围内学生一行,记录由哪位主家长代收(一位家长多个孩子只有一条收件行)
CREATE TABLE notice_students (
  notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (notice_id, student_id)
);
CREATE INDEX notice_students_parent ON notice_students (notice_id, parent_user_id);
