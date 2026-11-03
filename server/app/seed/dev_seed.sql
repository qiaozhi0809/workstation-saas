INSERT INTO schools (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', '示例小学');

INSERT INTO academic_years (id, school_id, name, start_date, end_date, is_active) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   '2026-2027', '2026-09-01', '2027-07-15', true);

INSERT INTO grades (id, school_id, academic_year_id, name, display_order) VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', '三年级', 3);

INSERT INTO classes (id, school_id, academic_year_id, grade_id, name, seat_rows, seat_cols, seat_layout, room) VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333',
   '三年二班', 6, 4, 'manual', '求知楼 201');

-- 密码 dev123:由 pgcrypto 生成 bcrypt($2a$,cost 10),Python bcrypt 可直接校验
INSERT INTO users (id, school_id, login_name, password_hash, display_name) VALUES
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
   'teacher01', crypt('dev123', gen_salt('bf', 10)), '张老师');

INSERT INTO teachers (id, user_id, employee_no, title, subjects) VALUES
  ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555',
   'T001', '语文', ARRAY['语文']);

INSERT INTO teacher_assignments (teacher_id, class_id, academic_year_id, identity, subject) VALUES
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', 'homeroom', '语文');

INSERT INTO role_bindings (user_id, role_type, scope, academic_year_id) VALUES
  ('55555555-5555-5555-5555-555555555555', 'homeroom_teacher',
   '{"class_id":"44444444-4444-4444-4444-444444444444"}'::jsonb,
   '22222222-2222-2222-2222-222222222222');

UPDATE classes SET homeroom_teacher_id = '66666666-6666-6666-6666-666666666666'
  WHERE id = '44444444-4444-4444-4444-444444444444';

INSERT INTO students (id, school_id, mk, name, gender, student_no, avatar_seed, family_structure) VALUES
  ('a0000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','S0001','王小一','男','2026001','seed-01','双亲家庭'),
  ('a0000002-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','S0002','李小二','女','2026002','seed-02',NULL),
  ('a0000003-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','S0003','张小三','男','2026003','seed-03',NULL),
  ('a0000004-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','S0004','赵小四','女','2026004','seed-04',NULL),
  ('a0000005-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','S0005','陈小五','男','2026005','seed-05',NULL),
  ('a0000006-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','S0006','刘小六','女','2026006','seed-06',NULL),
  ('a0000007-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','S0007','周小七','男','2026007','seed-07',NULL),
  ('a0000008-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','S0008','吴小八','女','2026008','seed-08',NULL),
  ('a0000009-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','S0009','孙小九','男','2026009','seed-09',NULL),
  ('a0000010-0000-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','S0010','林小十','女','2026010','seed-10',NULL);

-- 窗口函数必须自带 ORDER BY,外层 ORDER BY 不保证编号顺序
INSERT INTO enrollments (student_id, class_id, academic_year_id, seat_row, seat_col)
SELECT id, '44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
       ((row_number() OVER (ORDER BY mk) - 1) / 4) + 1,
       ((row_number() OVER (ORDER BY mk) - 1) % 4) + 1
FROM students
WHERE school_id = '11111111-1111-1111-1111-111111111111';

-- M2a:生日(含闰日)、职务、副班主任 teacher02、数学任课 teacher03(密码均为 dev123)
UPDATE students SET birthdate = v.b::date
FROM (VALUES
  ('S0001','2017-11-03'),('S0002','2017-11-20'),('S0003','2016-02-29'),('S0004','2017-05-12'),
  ('S0005','2017-08-08'),('S0006','2017-11-01'),('S0007','2017-01-15'),('S0008','2017-09-30'),
  ('S0009','2017-12-24'),('S0010','2017-06-01')
) AS v(mk, b)
WHERE students.mk = v.mk;

UPDATE enrollments e SET class_role = v.role
FROM students s, (VALUES ('S0001','班长'),('S0002','学习委员'),('S0005','体育委员')) AS v(mk, role)
WHERE e.student_id = s.id AND s.mk = v.mk;

INSERT INTO users (id, school_id, login_name, password_hash, display_name) VALUES
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
   'teacher02', crypt('dev123', gen_salt('bf', 10)), '王老师'),
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
   'teacher03', crypt('dev123', gen_salt('bf', 10)), '赵老师');

INSERT INTO teachers (id, user_id, employee_no, title, subjects) VALUES
  ('66666666-6666-6666-6666-666666666667', '77777777-7777-7777-7777-777777777777',
   'T002', '英语', ARRAY['英语']),
  ('66666666-6666-6666-6666-666666666668', '88888888-8888-8888-8888-888888888888',
   'T003', '数学', ARRAY['数学']);

INSERT INTO teacher_assignments (teacher_id, class_id, academic_year_id, identity, subject) VALUES
  ('66666666-6666-6666-6666-666666666667', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', 'assistant', NULL),
  ('66666666-6666-6666-6666-666666666668', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', 'subject', '数学');

INSERT INTO role_bindings (user_id, role_type, scope, academic_year_id) VALUES
  ('77777777-7777-7777-7777-777777777777', 'assistant_teacher',
   '{"class_id":"44444444-4444-4444-4444-444444444444"}'::jsonb,
   '22222222-2222-2222-2222-222222222222'),
  ('88888888-8888-8888-8888-888888888888', 'subject_teacher',
   '{"class_id":"44444444-4444-4444-4444-444444444444","subject":"数学"}'::jsonb,
   '22222222-2222-2222-2222-222222222222');

-- M2b:两场考试(语文/数学/英语各 100)与分数;classes.subjects 保持 NULL 以测学段预设
INSERT INTO exams (id, class_id, academic_year_id, name, exam_type, date, subjects, created_by_user_id) VALUES
  ('e0000001-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', '第一次月考', '月考', '2026-10-09',
   '[{"name":"语文","full":100},{"name":"数学","full":100},{"name":"英语","full":100}]'::jsonb,
   '55555555-5555-5555-5555-555555555555'),
  ('e0000002-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222', '期中考试', '期中', '2026-10-30',
   '[{"name":"语文","full":100},{"name":"数学","full":100},{"name":"英语","full":100}]'::jsonb,
   '55555555-5555-5555-5555-555555555555');

INSERT INTO scores (exam_id, enrollment_id, subject, value, entered_by_user_id)
SELECT v.exam_id::uuid, e.id, v.subject, v.value, '55555555-5555-5555-5555-555555555555'
FROM (
  SELECT x.exam_id, x.subject, (t.ord - 1) AS idx, t.val::numeric AS value
  FROM (VALUES
    ('e0000001-0000-0000-0000-000000000001', '语文', ARRAY[95,88,76,92,58,81,70,99,64,85]::numeric[]),
    ('e0000001-0000-0000-0000-000000000001', '数学', ARRAY[90,92,81,77,49,85,66,100,72,80]::numeric[]),
    ('e0000001-0000-0000-0000-000000000001', '英语', ARRAY[88,95,70,85,60,79,73,96,55,90]::numeric[]),
    ('e0000002-0000-0000-0000-000000000002', '语文', ARRAY[93,90,80,89,62,84,69,97,71,83]::numeric[]),
    ('e0000002-0000-0000-0000-000000000002', '数学', ARRAY[95,88,85,70,55,90,60,98,78,82]::numeric[]),
    ('e0000002-0000-0000-0000-000000000002', '英语', ARRAY[90,92,74,88,NULL,81,70,94,62,91]::numeric[])
  ) AS x(exam_id, subject, vals)
  CROSS JOIN LATERAL unnest(x.vals) WITH ORDINALITY AS t(val, ord)
) v
JOIN students s ON s.mk = 'S' || lpad((v.idx + 1)::text, 4, '0')
JOIN enrollments e ON e.student_id = s.id AND e.status = 'active';

-- M2c:成长记录(teacher01 记)与一条教师手写评语;mask_no 由序列按插入顺序自动得到 1-10
INSERT INTO growth_records (id, student_id, enrollment_id, class_id, academic_year_id,
                            type, date, content, created_by_user_id)
SELECT v.id::uuid, s.id, e.id, '44444444-4444-4444-4444-444444444444',
       '22222222-2222-2222-2222-222222222222', v.type, v.date::date, v.content,
       '55555555-5555-5555-5555-555555555555'
FROM (VALUES
  ('f0000001-0000-0000-0000-000000000001', 'S0001', '表扬', '2026-10-20', '主动帮同学讲解数学题'),
  ('f0000002-0000-0000-0000-000000000002', 'S0001', '谈话', '2026-10-28', '近期上课有些走神,约定每天整理错题'),
  ('f0000003-0000-0000-0000-000000000003', 'S0005', '家访', '2026-10-15', '与家长沟通作业习惯,家长表示配合')
) AS v(id, mk, type, date, content)
JOIN students s ON s.mk = v.mk
JOIN enrollments e ON e.student_id = s.id AND e.status = 'active';

INSERT INTO comments (id, student_id, enrollment_id, class_id, academic_year_id,
                      semester, content, generated_by_ai, created_by_user_id)
SELECT 'c0000001-0000-0000-0000-000000000001', s.id, e.id,
       '44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
       '2026-2027 第一学期',
       '做事认真踏实,是老师的好帮手。希望下学期在课堂上更大胆地表达自己的想法。',
       false, '55555555-5555-5555-5555-555555555555'
FROM students s
JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
WHERE s.mk = 'S0002';
