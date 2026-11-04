DROP INDEX IF EXISTS teacher_assignments_one_homeroom;
DROP INDEX IF EXISTS audit_logs_action_at;
DROP INDEX IF EXISTS audit_logs_at;
DROP TABLE IF EXISTS notice_recipients;
DROP TABLE IF EXISTS notices;
DROP INDEX IF EXISTS exams_one_per_grade_exam;
ALTER TABLE exams DROP COLUMN IF EXISTS grade_exam_id;
DROP TABLE IF EXISTS grade_exams;
