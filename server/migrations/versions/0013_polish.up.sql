-- M5d:通知班级快照、首次引导状态、令牌下限。只对已有表加列:要么可空,要么带 DEFAULT;
-- 不加 CHECK / 唯一约束,不 SET NOT NULL,不改类型。升级旧库时任何旧数据都不会让它中途失败。

-- notice_students:发送时刻学生所在的班(快照,L87)。class_name 独立存文本,班级删除后仍能显示。
ALTER TABLE notice_students
  ADD COLUMN class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  ADD COLUMN class_name text;

-- 旧行回填:每个学生取一条注册——在读(active)优先,其次最近入班的一条;只 JOIN 仍存在的班
-- (enrollments.class_id 外键保证引用的班都在);没有任何注册的学生留 NULL。
UPDATE notice_students ns
SET class_id = pick.class_id, class_name = pick.class_name
FROM (
  SELECT DISTINCT ON (e.student_id) e.student_id, c.id AS class_id, c.name AS class_name
  FROM enrollments e
  JOIN classes c ON c.id = e.class_id
  ORDER BY e.student_id, (e.status = 'active') DESC, e.entered_at DESC, e.id
) pick
WHERE pick.student_id = ns.student_id;

-- user_preferences:各语境(teacher / parent / admin)首次引导完成的时间,{} = 都没看过
ALTER TABLE user_preferences
  ADD COLUMN onboarded jsonb NOT NULL DEFAULT '{}'::jsonb;

-- users:令牌签发下限。关闭 / 重置两步验证时写 now(),早于它签发的令牌一律失效(L144)
ALTER TABLE users
  ADD COLUMN token_floor_at timestamptz;
