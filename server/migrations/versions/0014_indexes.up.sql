-- v1.1:两个索引,不加列、不改类型。
-- notice_students.class_id(0013 加的快照列,FK ON DELETE SET NULL):删班时级联置空要按 class_id 找行,
-- 之前没有索引是全表扫(L229)。
CREATE INDEX ix_notice_students_class_id ON notice_students (class_id);

-- 同一年级里班名唯一(L263):组织端的应用层重名检查各自只看得见已提交的行,两个会话并发建 / 改成
-- 同名仍可能重名;唯一索引兜底,撞上它的写入方返回 409 NAME_TAKEN。
-- 旧库里已有同年级重名班会让这一步失败:预检 "classes 同年级重名"(precheck.py)先列出来让人改名。
CREATE UNIQUE INDEX uq_classes_grade_name ON classes (grade_id, name);
