from datetime import date
from uuid import UUID, uuid4

import pytest

from app.ai.context import (
    Access,
    class_context,
    exam_context,
    failing_students,
    load_exam_data,
    regressed_students,
    student_context,
    system_prompt,
)
from app.ai.stats import exam_stats, exam_table, rank_changes, subject_stats
from app.domain.classes.service import class_scope_of
from app.domain.exams.schemas import SubjectFull
from app.models import Enrollment, Exam, SchoolClass, Score, Student, User
from app.rbac.bindings import load_bindings
from tests.helpers import enrollment_of, freeze
from tests.seed_ids import (
    ASSISTANT_USER_ID,
    CLASS_ID,
    EXAM_IDS,
    STUDENT_IDS,
    SUBJECT_USER_ID,
    TEACHER_USER_ID,
    YEAR_ID,
)

TODAY = date(2026, 11, 2)


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    freeze(monkeypatch, "2026-11-02T02:00:00+00:00")


def _cls(db) -> SchoolClass:
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    assert cls is not None
    return cls


def _who(db, user_id: str):
    cls = _cls(db)
    bindings = load_bindings(db, UUID(user_id), UUID(YEAR_ID))
    return cls, bindings, Access.of(bindings, class_scope_of(cls))


def _load(db, exam_id: str):
    cls, _, access = _who(db, TEACHER_USER_ID)
    return load_exam_data(db, cls, db.get(Exam, UUID(exam_id)), access)


def test_exam_stats_match_frontend_rules(db):
    st = exam_stats(*_load(db, EXAM_IDS[1]))
    assert st is not None
    assert (round(st.avg, 1), st.max, st.min, st.n) == (236.1, 289, 117, 10)
    assert (round(st.pass_rate * 100), round(st.good_rate * 100), round(st.sd, 1)) == (90, 50, 47.7)
    assert [r.rank for r in st.table][:3] == [1, 2, 3]


def test_subject_stats_cover_absent_and_low(db):
    subjects, scores, ids = _load(db, EXAM_IDS[1])
    en = subject_stats(subjects, scores, "英语", ids)
    assert en is not None
    assert en.n == 9  # 陈小五缺考,不计入
    assert round(en.rate, 1) == 82.4
    assert subject_stats(subjects, scores, "物理", ids) is None


def test_ties_share_rank_and_all_absent_unranked():
    subjects = [SubjectFull(name="语文", full=150), SubjectFull(name="数学", full=150)]
    a, b, c = uuid4(), uuid4(), uuid4()
    scores = {
        a: {"语文": 140.0, "数学": 130.0},
        b: {"语文": 130.0, "数学": 140.0},
        c: {"语文": None, "数学": None},
    }
    table = exam_table(subjects, scores, [c, a, b])
    assert [(r.total, r.rank) for r in table] == [(270.0, 1), (270.0, 1), (None, None)]
    assert table[2].enrollment_id == c
    st = exam_stats(subjects, scores, [a, b, c])
    assert st is not None and st.n == 2
    assert exam_stats(subjects, {c: {"语文": None}}, [c]) is None


def test_next_rank_after_tie_skips():
    subjects = [SubjectFull(name="语文", full=100)]
    ids = [uuid4() for _ in range(3)]
    scores = {ids[0]: {"语文": 90.0}, ids[1]: {"语文": 90.0}, ids[2]: {"语文": 80.0}}
    assert [r.rank for r in exam_table(subjects, scores, ids)] == [1, 1, 3]


def test_rank_changes_positive_means_progress():
    subjects = [SubjectFull(name="语文", full=100)]
    x, y = uuid4(), uuid4()
    prev = exam_table(subjects, {x: {"语文": 90.0}, y: {"语文": 80.0}}, [x, y])
    cur = exam_table(subjects, {x: {"语文": 70.0}, y: {"语文": 80.0}}, [x, y])
    assert rank_changes(cur, prev) == {x: -1, y: 1}
    assert rank_changes(cur, None) == {}


def test_system_prompt_for_homeroom(db):
    cls, bindings, _ = _who(db, TEACHER_USER_ID)
    teacher = db.get(User, UUID(TEACHER_USER_ID))
    p = system_prompt(db, teacher, bindings, cls)
    assert p.startswith("你是一位熟悉中国中小学教育的班主任助手")
    assert "5. 材料中形如「【学生07】」的编号各代表一位学生" in p
    assert p.endswith("当前老师：张老师，示例小学三年二班班主任；学段：小学。")


def test_system_prompt_lists_subjects_for_subject_teacher(db):
    cls, bindings, _ = _who(db, SUBJECT_USER_ID)
    teacher = db.get(User, UUID(SUBJECT_USER_ID))
    p = system_prompt(db, teacher, bindings, cls)
    assert p.endswith("当前老师：赵老师，示例小学三年二班任课老师，任教数学；学段：小学。")


def test_access_follows_permissions(db):
    _, _, home = _who(db, TEACHER_USER_ID)
    assert home.visible_subjects is None
    assert all(
        [home.family, home.learning, home.profile, home.exam, home.review, home.growth]
        + [home.attendance]
    )
    _, _, math = _who(db, SUBJECT_USER_ID)
    assert math.visible_subjects == frozenset({"数学"})
    assert not math.family and math.exam and math.learning
    _, _, assistant = _who(db, ASSISTANT_USER_ID)
    assert not (assistant.exam or assistant.family or assistant.learning or assistant.profile)
    assert assistant.review and assistant.growth and assistant.attendance


def test_class_context_lines(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    c = class_context(db, cls, access, TODAY)
    assert "【班级概况】" in c
    assert "学校：示例小学；班级：三年级 三年二班；学段：小学；学年：2026-2027，第 10 周" in c
    assert "人数：10（男 5，女 5）" in c
    assert "班干部：王小一（班长）、李小二（学习委员）、陈小五（体育委员）" in c
    assert "最近考试：期中考试（2026-10-30），平均分 236.1，及格率 90%，优秀率 50%" in c
    assert "各科得分率：语文 81.8%" in c
    assert "- 2026-10-28 王小一 谈话：近期上课有些走神" in c
    assert "近期成长记录：" in c


def test_class_context_omits_lines_without_permission(db):
    cls, _, access = _who(db, ASSISTANT_USER_ID)
    c = class_context(db, cls, access, TODAY)
    assert "最近考试" not in c and "标签" not in c
    assert "近期成长记录：" in c  # 副班主任有 growth.read


def test_class_context_without_class_roles(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    db.query(Enrollment).filter(Enrollment.class_id == cls.id).update({"class_role": None})
    assert "班干部：无" in class_context(db, cls, access, TODAY)


def test_exam_context_with_compare(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    mid, monthly = db.get(Exam, UUID(EXAM_IDS[1])), db.get(Exam, UUID(EXAM_IDS[0]))
    c = exam_context(db, cls, mid, monthly, access)
    assert "考试：期中考试（期中，2026-10-30）；参考人数 10；满分 300" in c
    assert "总分：平均 236.1，最高 289，最低 117，及格率 90%，优秀率 50%，标准差 47.7" in c
    assert "- 英语（满分 100）：平均 " in c and "不及格 0 人" in c
    assert "前 5 名：吴小八 289、王小一 278、李小二 270、林小十 256、刘小六 255" in c
    assert "对比「第一次月考」：总分得分率 79.7% → 78.7%（-1.0 个百分点）" in c
    assert "英语 79.1% → 82.4%（+3.3）" in c
    assert "进步 5 名及以上：无" in c and "退步 5 名及以上：无" in c
    assert "两科及以上不及格：无" in c  # 期中陈小五只有数学一科不及格(英语缺考)


def test_exam_context_without_compare_has_no_compare_lines(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    c = exam_context(db, cls, db.get(Exam, UUID(EXAM_IDS[1])), None, access)
    assert "对比" not in c and "进步 5 名" not in c and "退步 5 名" not in c
    assert "两科及以上不及格：无" in c


def test_two_failing_subjects_listed(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    monthly = db.get(Exam, UUID(EXAM_IDS[0]))
    c = exam_context(db, cls, monthly, None, access)
    assert "两科及以上不及格：陈小五" in c
    ((enr, count),) = failing_students(db, cls, monthly, access)
    assert enr.id == enrollment_of(db, STUDENT_IDS[4]) and count == 2


def test_exam_context_clipped_for_subject_teacher(db):
    cls, _, access = _who(db, SUBJECT_USER_ID)
    c = exam_context(db, cls, db.get(Exam, UUID(EXAM_IDS[1])), None, access)
    assert "数学" in c and "语文" not in c and "英语" not in c
    assert "两科及以上不及格" not in c  # 只能看到一科


def test_student_context_never_has_contacts(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    wang = db.get(Student, UUID(STUDENT_IDS[0]))
    wang.contacts = [{"name": "王建国", "phone": "13800000011", "relation": "父亲"}]
    db.flush()
    c = student_context(db, wang, db.get(Enrollment, enrollment_of(db, wang.id)), access, TODAY)
    assert "王建国" not in c and "13800000011" not in c and "父亲" not in c
    assert "【学生档案】" in c
    assert "姓名：王小一；性别：男；年龄：8 岁；职务：班长" in c
    assert "家庭：双亲家庭" in c


def test_student_context_scores_and_growth(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    wang = db.get(Student, UUID(STUDENT_IDS[0]))
    c = student_context(db, wang, db.get(Enrollment, enrollment_of(db, wang.id)), access, TODAY)
    assert "成绩：第一次月考 总分 273（第" in c and "期中考试 总分 278（第 2/10 名）" in c
    assert "最近一次考试各科：语文 93（班均 " in c and "英语 90（班均 " in c
    assert "- 2026-10-28 谈话：近期上课有些走神,约定每天整理错题" in c
    assert "考勤（本学年）：请假 0 天，缺勤 0 天，迟到 0 天" in c


def test_student_context_marks_absent_subject(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    chen = db.get(Student, UUID(STUDENT_IDS[4]))
    c = student_context(db, chen, db.get(Enrollment, enrollment_of(db, chen.id)), access, TODAY)
    assert "英语 缺考（班均 " in c


def test_student_context_clipped_for_subject_teacher(db):
    cls, _, access = _who(db, SUBJECT_USER_ID)
    wang = db.get(Student, UUID(STUDENT_IDS[0]))
    c = student_context(db, wang, db.get(Enrollment, enrollment_of(db, wang.id)), access, TODAY)
    assert "家庭：" not in c and "数学" in c and "语文" not in c and "英语" not in c
    assert "成绩：第一次月考 数学 90（第" in c


def test_student_context_hides_everything_for_assistant(db):
    cls, _, access = _who(db, ASSISTANT_USER_ID)
    wang = db.get(Student, UUID(STUDENT_IDS[0]))
    c = student_context(db, wang, db.get(Enrollment, enrollment_of(db, wang.id)), access, TODAY)
    assert "成绩" not in c and "家庭" not in c and "学习情况" not in c
    assert "近期成长记录：" in c


def test_regressed_students_threshold(db):
    cls, _, access = _who(db, TEACHER_USER_ID)
    mid = db.get(Exam, UUID(EXAM_IDS[1]))
    assert regressed_students(db, cls, mid, db.get(Exam, UUID(EXAM_IDS[0])), access) == []
    # 自造对比考试:期中第 7 名的张小三在对比考试里是第 1 名 → 退 6 名
    order = [2, 7, 0, 1, 9, 5, 3, 8, 6, 4]
    compare = Exam(
        class_id=cls.id,
        academic_year_id=cls.academic_year_id,
        name="摸底",
        exam_type="其他",
        date=date(2026, 9, 20),
        subjects=[{"name": "语文", "full": 100}],
    )
    db.add(compare)
    db.flush()
    for rank, idx in enumerate(order):
        db.add(
            Score(
                exam_id=compare.id,
                enrollment_id=enrollment_of(db, STUDENT_IDS[idx]),
                subject="语文",
                value=100 - rank,
            )
        )
    db.flush()
    got = regressed_students(db, cls, mid, compare, access)
    assert got == [(db.get(Enrollment, enrollment_of(db, STUDENT_IDS[2])), 6)]
    assert "退步 5 名及以上：张小三（-6）" in exam_context(db, cls, mid, compare, access)
