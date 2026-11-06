import csv
import io
from urllib.parse import unquote
from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import Enrollment, Exam, Score, Student
from app.rbac.roles import Role
from tests.factories import bind, make_class, make_student, make_teacher_account
from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, GRADE_ID, TEACHER_USER_ID

PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD = "55555555-5555-5555-5555-555555555545"  # gradehead03:三年级
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
GRADE4_ID = "33333333-3333-3333-3333-333333333334"
CLASS_31 = "44444444-4444-4444-4444-444444444441"  # 三年一班(6 人);CLASS_ID 是三年二班(10 人)
CLASS_41 = "44444444-4444-4444-4444-444444444442"  # 四年一班
GE_API = "/api/v1/admin/grade-exams"
API = "/api/v1/admin/reports/scores"


def _create(client, settings, grade_id=GRADE_ID, user=DEAN):
    body = {
        "grade_id": grade_id,
        "name": "期中联考",
        "exam_type": "期中",
        "date": "2026-11-10",
        "subjects": [{"name": "语文", "full": 100}, {"name": "数学", "full": 100}],
    }
    r = client.post(GE_API, json=body, headers=auth(settings, user))
    assert r.status_code == 201, r.text
    return r.json()


def _enrollments(db, class_id):
    return list(
        db.scalars(
            select(Enrollment)
            .where(Enrollment.class_id == UUID(class_id), Enrollment.status == "active")
            .order_by(Enrollment.id)
        ).all()
    )


def _put(db, ge, class_id, idx, **subjects):
    """给 class_id 班第 idx 个在读学生录分;值为 None 表示缺考。"""
    exam = db.scalars(
        select(Exam).where(Exam.grade_exam_id == UUID(ge["id"]), Exam.class_id == UUID(class_id))
    ).one()
    enrollment = _enrollments(db, class_id)[idx]
    for subject, value in subjects.items():
        db.add(Score(exam_id=exam.id, enrollment_id=enrollment.id, subject=subject, value=value))
    db.flush()
    return enrollment


@pytest.fixture
def ge(client, db, settings):
    """三年二班(CLASS_ID,10 人)与三年一班(CLASS_31,6 人)的假分数,含缺考与同分。"""
    out = _create(client, settings)
    # 三年二班(CLASS_ID)
    _put(db, out, CLASS_ID, 0, 语文=90, 数学=80)  # 170
    _put(db, out, CLASS_ID, 1, 语文=90, 数学=80)  # 170,与上同分
    _put(db, out, CLASS_ID, 2, 语文=50, 数学=None)  # 50,数学缺考
    _put(db, out, CLASS_ID, 3, 语文=70)  # 70
    _put(db, out, CLASS_ID, 4, 语文=None, 数学=None)  # 全科缺考:无总分无名次
    # 三年一班(CLASS_31)
    _put(db, out, CLASS_31, 0, 语文=95, 数学=90)  # 185
    _put(db, out, CLASS_31, 1, 语文=60, 数学=85)  # 145
    return out


def _get(client, settings, path="", user=DEAN, **params):
    return client.get(API + path, params=params, headers=auth(settings, user))


def _stat(stats, subject):
    return next(s for s in stats if s["subject"] == subject)


def test_summary_per_class_stats(client, settings, ge):
    r = _get(client, settings, grade_exam_id=ge["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["grade_exam"] == {
        "id": ge["id"],
        "name": "期中联考",
        "date": "2026-11-10",
        "grade_name": "三年级",
    }
    assert body["subjects"] == [{"name": "语文", "full": 100}, {"name": "数学", "full": 100}]
    assert [c["class_name"] for c in body["classes"]] == ["三年一班", "三年二班"]
    b, a = body["classes"]  # 三年一班(6 人,CLASS_31)在前,三年二班(10 人,CLASS_ID)在后
    assert a["class_id"] == CLASS_ID and b["class_id"] == CLASS_31
    assert [s["subject"] for s in a["subjects"]] == ["语文", "数学"]
    assert _stat(a["subjects"], "语文") == {
        "subject": "语文",
        "full": 100,
        "count": 4,
        "missing": 6,
        "avg": 75.0,
        "max": 90,
        "min": 50,
        "pass_rate": 0.75,
        "good_rate": 0.5,
    }
    assert _stat(a["subjects"], "数学") == {
        "subject": "数学",
        "full": 100,
        "count": 2,
        "missing": 8,
        "avg": 80.0,
        "max": 80,
        "min": 80,
        "pass_rate": 1.0,
        "good_rate": 0.0,
    }
    assert a["total"] == {"full": 200, "count": 4, "avg": 115.0, "max": 170, "min": 50}
    assert _stat(b["subjects"], "语文") == {
        "subject": "语文",
        "full": 100,
        "count": 2,
        "missing": 4,
        "avg": 77.5,
        "max": 95,
        "min": 60,
        "pass_rate": 1.0,
        "good_rate": 0.5,
    }
    assert _stat(b["subjects"], "数学")["avg"] == 87.5
    assert _stat(b["subjects"], "数学")["good_rate"] == 1.0
    assert b["total"] == {"full": 200, "count": 2, "avg": 165.0, "max": 185, "min": 145}


def test_classes_sorted_by_class_sort_key(client, db, settings):
    """L40:汇总里的班与学生行按班名数值排(三年三班在三年二班之后),不按码位。"""
    extra = make_class(db, "三年三班")
    make_student(db, extra, "新生", "S9301")
    out = _create(client, settings)
    body = _get(client, settings, grade_exam_id=out["id"]).json()
    assert [c["class_name"] for c in body["classes"]] == ["三年一班", "三年二班", "三年三班"]
    rows = _get(client, settings, "/students", grade_exam_id=out["id"]).json()["students"]
    assert [r["class_name"] for r in rows] == ["三年一班"] * 6 + ["三年二班"] * 10 + ["三年三班"]


def test_summary_grade_totals(client, settings, ge):
    grade = _get(client, settings, grade_exam_id=ge["id"]).json()["grade"]
    chinese = _stat(grade["subjects"], "语文")
    assert chinese["count"] == 6 and chinese["missing"] == 10
    assert chinese["avg"] == 75.8  # 455 / 6 保留一位小数
    assert (chinese["max"], chinese["min"]) == (95, 50)
    assert chinese["pass_rate"] == pytest.approx(5 / 6)
    assert chinese["good_rate"] == 0.5
    maths = _stat(grade["subjects"], "数学")
    assert maths["count"] == 4 and maths["missing"] == 12
    assert maths["avg"] == 83.8  # 335 / 4 = 83.75,半数向上
    assert maths["pass_rate"] == 1.0 and maths["good_rate"] == 0.5
    assert grade["total"] == {"full": 200, "count": 6, "avg": 131.7, "max": 185, "min": 50}


def test_summary_without_scores(client, settings):
    out = _create(client, settings)
    body = _get(client, settings, grade_exam_id=out["id"]).json()
    for stat in [*body["grade"]["subjects"], *body["classes"][0]["subjects"]]:
        assert stat["count"] == 0
        assert stat["avg"] is None and stat["max"] is None and stat["min"] is None
        assert stat["pass_rate"] is None and stat["good_rate"] is None
    assert body["classes"][0]["subjects"][0]["missing"] == 6
    assert body["grade"]["total"] == {
        "full": 200,
        "count": 0,
        "avg": None,
        "max": None,
        "min": None,
    }


def _rows(client, settings, ge, user=DEAN, **params):
    r = _get(client, settings, "/students", user=user, grade_exam_id=ge["id"], **params)
    assert r.status_code == 200, r.text
    return r.json()["students"]


def test_students_ranks_ties_and_nulls(client, db, settings, ge):
    rows = _rows(client, settings, ge, class_id=CLASS_ID)
    assert len(rows) == 10
    scored = [r for r in rows if r["total"] is not None]
    assert [r["total"] for r in scored] == [170, 170, 70, 50]
    assert [r["class_rank"] for r in scored] == [1, 1, 3, 4]  # 同分同名次
    assert [r["grade_rank"] for r in scored] == [2, 2, 5, 6]  # 三年一班 185 排在前
    assert all(r["total"] is None for r in rows[4:])
    assert all(r["class_rank"] is None and r["grade_rank"] is None for r in rows[4:])
    assert {r["class_name"] for r in rows} == {"三年二班"}
    cheater = next(r for r in rows if r["total"] == 50)
    assert cheater["scores"] == {"语文": 50, "数学": None}  # 缺考为 null
    all_absent = next(r for r in rows if r["total"] is None and r["scores"]["语文"] is None)
    assert all_absent["scores"] == {"语文": None, "数学": None}


def test_students_grade_wide_sorted_by_grade_rank(client, settings, ge):
    rows = _rows(client, settings, ge)
    assert len(rows) == 16
    ranks = [r["grade_rank"] for r in rows]
    assert ranks[:6] == [1, 2, 2, 4, 5, 6]
    assert all(r is None for r in ranks[6:])
    assert rows[0]["class_name"] == "三年一班" and rows[0]["total"] == 185
    assert rows[0]["class_rank"] == 1
    assert rows[3]["class_name"] == "三年一班" and rows[3]["class_rank"] == 2
    assert {"student_id", "name", "student_no", "class_id"} <= set(rows[0])


def test_students_filter_by_class_keeps_grade_rank(client, settings, ge):
    rows = _rows(client, settings, ge, class_id=CLASS_31)
    assert len(rows) == 6
    assert [(r["class_rank"], r["grade_rank"]) for r in rows[:2]] == [(1, 1), (2, 4)]


def test_grade_head_sees_own_grade_only(client, db, settings, ge):
    assert _get(client, settings, user=GRADE_HEAD, grade_exam_id=ge["id"]).status_code == 200
    other = _create(client, settings, GRADE4_ID)
    for path in ("", "/students", "/export"):
        r = _get(client, settings, path, user=GRADE_HEAD, grade_exam_id=other["id"])
        assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    denied = [a for a in audit_rows(db, other["id"]) if not a.success]
    assert len(denied) == 3 and all(a.object_type == "grade_exam" for a in denied)
    assert _get(client, settings, user=PRINCIPAL, grade_exam_id=other["id"]).status_code == 200


def _without_classes(client, db, settings, grade_id=GRADE_ID):
    """联考存在但没有任何关联班级考试(班级考试被清空)。"""
    out = _create(client, settings, grade_id)
    for exam in db.scalars(select(Exam).where(Exam.grade_exam_id == UUID(out["id"]))).all():
        db.delete(exam)
    db.flush()
    return out


def test_zero_class_grade_exam_gives_empty_report_to_grade_viewers(client, db, settings):
    out = _without_classes(client, db, settings)
    for uid in (PRINCIPAL, DEAN, GRADE_HEAD):
        body = _get(client, settings, user=uid, grade_exam_id=out["id"])
        assert body.status_code == 200, body.text
        data = body.json()
        assert data["classes"] == []
        assert data["grade"]["total"] == {
            "full": 200,
            "count": 0,
            "avg": None,
            "max": None,
            "min": None,
        }
        assert [s["subject"] for s in data["grade"]["subjects"]] == ["语文", "数学"]
        assert all(s["count"] == 0 and s["missing"] == 0 for s in data["grade"]["subjects"])
        assert _rows(client, settings, out, user=uid) == []
    exported = _get(client, settings, "/export", user=GRADE_HEAD, grade_exam_id=out["id"])
    assert exported.status_code == 200
    lines = exported.content.decode("utf-8-sig").splitlines()
    assert lines == ["班级,学号,姓名,语文,数学,总分,班级名次,年级名次"]


def test_zero_class_grade_exam_still_forbidden_outside_the_grade(client, db, settings):
    other = _without_classes(client, db, settings, GRADE4_ID)
    for path in ("", "/students", "/export"):
        r = _get(client, settings, path, user=GRADE_HEAD, grade_exam_id=other["id"])
        assert r.status_code == 403
    for uid in (TEACHER_USER_ID, IT_ADMIN):
        for path in ("", "/students", "/export"):
            r = _get(client, settings, path, user=uid, grade_exam_id=other["id"])
            assert r.status_code == 403


def test_teacher_and_it_admin_forbidden(client, settings, ge):
    for uid in (TEACHER_USER_ID, IT_ADMIN):
        for path in ("", "/students", "/export"):
            r = _get(client, settings, path, user=uid, grade_exam_id=ge["id"])
            assert r.status_code == 403


def test_unknown_grade_exam_is_404(client, settings):
    missing = "99999999-9999-9999-9999-999999999999"
    for path in ("", "/students", "/export"):
        assert _get(client, settings, path, grade_exam_id=missing).status_code == 404
    assert _get(client, settings).status_code == 400  # 缺参数:校验错误统一 400


def test_class_not_in_grade_exam_is_403(client, db, settings, ge):
    r = _get(client, settings, "/students", grade_exam_id=ge["id"], class_id=CLASS_41)
    assert r.status_code == 403
    gone = "99999999-9999-9999-9999-999999999999"
    r = _get(client, settings, "/students", grade_exam_id=ge["id"], class_id=gone)
    assert r.status_code == 403  # 不存在与不可见同口径,无 404
    assert len([a for a in audit_rows(db, ge["id"]) if not a.success]) == 2


def _partial_leader(db):
    """只绑到三年二班(CLASS_ID)的领导身份:可见班 ⊂ 联考关联班。"""
    user = make_teacher_account(db)
    bind(db, user.id, Role.grade_head, class_id=CLASS_ID)
    return str(user.id)


def test_partial_visibility_outputs_visible_only_ranks_over_all(client, db, settings, ge):
    uid = _partial_leader(db)
    body = _get(client, settings, user=uid, grade_exam_id=ge["id"]).json()
    assert [c["class_id"] for c in body["classes"]] == [CLASS_ID]
    # 全年级合计只算可见班,不泄露三年一班的分数
    assert body["grade"]["total"]["count"] == 4
    assert _stat(body["grade"]["subjects"], "语文")["count"] == 4
    rows = _rows(client, settings, ge, user=uid)
    assert len(rows) == 10 and {r["class_id"] for r in rows} == {CLASS_ID}
    # 年级名次仍按全部关联班排:三年一班 185 在前,所以最好的是 2 而不是 1
    assert rows[0]["grade_rank"] == 2
    hidden = _get(
        client, settings, "/students", user=uid, grade_exam_id=ge["id"], class_id=CLASS_31
    )
    assert hidden.status_code == 403
    assert [a.success for a in audit_rows(db, ge["id"]) if a.action != "exam.grade_create"] == [
        False
    ]


def test_export_csv(client, db, settings, ge):
    # 学号 / 姓名以 = 开头的单元格要防公式注入
    victim = _enrollments(db, CLASS_ID)[0]
    student = db.get(Student, victim.student_id)
    student.name = "=HYPERLINK(1)"
    db.flush()
    r = _get(client, settings, "/export", grade_exam_id=ge["id"])
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/csv; charset=utf-8"
    disposition = r.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert unquote(disposition.split("filename*=UTF-8''")[1]) == "期中联考-成绩汇总.csv"
    assert r.content.startswith(b"\xef\xbb\xbf")
    lines = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert lines[0] == ["班级", "学号", "姓名", "语文", "数学", "总分", "班级名次", "年级名次"]
    assert len(lines) == 1 + 16  # 表头 + 学生数
    by_name = {row[2]: row for row in lines[1:]}
    assert "=HYPERLINK(1)" not in by_name
    assert by_name["'=HYPERLINK(1)"][3:] == ["90", "80", "170", "1", "2"]
    absent = next(row for row in lines[1:] if row[5] == "50")
    assert absent[3:] == ["50", "", "50", "4", "6"]  # 缺考留空
    nobody = [row for row in lines[1:] if row[5] == ""]
    assert len(nobody) == 10 and all(row[6:] == ["", ""] for row in nobody)
    assert lines[1][0] == "三年一班"  # 与学生列表同序:年级名次
    rows = [a for a in audit_rows(db, ge["id"]) if a.action != "exam.grade_create"]
    assert [(a.action, a.object_type, a.success) for a in rows] == [
        ("score.export", "grade_exam", True)
    ]


def test_export_only_visible_classes(client, db, settings, ge):
    uid = _partial_leader(db)
    r = _get(client, settings, "/export", user=uid, grade_exam_id=ge["id"])
    assert r.status_code == 200
    lines = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert len(lines) == 1 + 10
    assert {row[0] for row in lines[1:]} == {"三年二班"}


def test_export_csv_unit():
    from app.domain.exams.schemas import SubjectFull
    from app.domain.reports.schemas import ScoreStudentRow
    from app.domain.reports.scores import _num, export_csv

    # CSV 数字与 JSON 同口径:一位小数、半数向上(round1),整数不带 .0,不截断有效数字
    assert (_num(0.25), _num(170.0), _num(3), _num(123456.7), _num(None)) == (
        "0.3",
        "170",
        "3",
        "123456.7",
        "",
    )
    row = ScoreStudentRow(
        student_id=UUID("00000000-0000-0000-0000-000000000001"),
        name="@x",
        student_no="-1+2",
        class_id=UUID("00000000-0000-0000-0000-000000000002"),
        class_name="一班",
        scores={"语文": 88.5},
        total=88.5,
        class_rank=1,
        grade_rank=None,
    )
    text = export_csv([row], [SubjectFull(name="语文", full=100)])
    assert text.startswith("﻿班级,学号,姓名,语文,总分,班级名次,年级名次\r\n")
    assert text.endswith("一班,'-1+2,'@x,88.5,88.5,1,\r\n")
