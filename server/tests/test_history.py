from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text

from app.ai.stats import exam_table
from app.domain.exams.schemas import SubjectFull
from app.domain.years.service import apply
from app.domain.years.suggest import suggest
from app.models import AcademicYear, Enrollment, Exam, Grade, SchoolClass, Score
from app.models.audit import AuditLog
from tests.factories import make_student
from tests.helpers import auth
from tests.seed_ids import CLASS_ID, EXAM_IDS, SCHOOL_ID, YEAR_ID

SCHOOL = UUID(SCHOOL_ID)
NOW = datetime(2027, 8, 20, 1, 0, tzinfo=UTC)
C31 = "44444444-4444-4444-4444-444444444441"
C41 = "44444444-4444-4444-4444-444444444442"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD3 = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
T01 = "55555555-5555-5555-5555-555555555555"
BASE = "/api/v1/admin/history"


def get(client, settings, path, user=PRINCIPAL, **params):
    return client.get(f"{BASE}{path}", params=params, headers=auth(settings, user))


def add_extra_students(db) -> dict[str, UUID]:
    """三年二班补三名学生,覆盖:已转出(有满分成绩)、转出且无学号、在读但没有任何成绩。"""
    out = {}
    out["transferred"] = make_student(
        db, UUID(CLASS_ID), "转出生", "S9001", student_no="2025099", gender="男"
    )
    out["no_no"] = make_student(db, UUID(CLASS_ID), "无学号生", "S9002")
    out["no_score"] = make_student(db, UUID(CLASS_ID), "无分生", "S9003", student_no="2026099")
    db.execute(
        text(
            "UPDATE enrollments SET status = 'transferred', left_at = now()"
            " WHERE student_id = ANY(cast(:ids as uuid[]))"
        ),
        {"ids": [out["transferred"], out["no_no"]]},
    )
    enr = db.scalars(select(Enrollment.id).where(Enrollment.student_id == out["transferred"])).one()
    for subject in ("语文", "数学", "英语"):
        db.execute(
            text(
                "INSERT INTO scores (exam_id, enrollment_id, subject, value)"
                " VALUES (:x, :e, :s, 100)"
            ),
            {"x": EXAM_IDS[0], "e": enr, "s": subject},
        )
    db.flush()
    return out


def class_sizes(db) -> dict[UUID, int]:
    """升级前每个班注册过的人数(所有状态)。"""
    rows = db.execute(text("SELECT class_id, count(*) FROM enrollments GROUP BY class_id")).all()
    return {cid: n for cid, n in rows}


def upgrade(db) -> None:
    plan = suggest(db, SCHOOL, "2027-2028", date(2027, 9, 1), date(2028, 7, 15))
    apply(db, SCHOOL, plan, now=NOW)


@pytest.fixture
def past(db):
    """完整种子 + 三名额外学生,升一次级;返回升级前每班人数与额外学生 id。"""
    extra = add_extra_students(db)
    sizes = class_sizes(db)
    upgrade(db)
    return {"sizes": sizes, "extra": extra}


def failed_audits(db, user, object_id) -> int:
    return len(
        db.scalars(
            select(AuditLog).where(
                AuditLog.user_id == UUID(user),
                AuditLog.action == "school.view",
                AuditLog.success.is_(False),
                AuditLog.object_id == str(object_id),
            )
        ).all()
    )


def test_no_past_years_initially(client, settings):
    r = get(client, settings, "/years")
    assert r.status_code == 200 and r.json() == []


def test_principal_sees_past_classes(client, settings, db, past):
    # 种子当前学年共 3 个班(三年二班、三年一班、四年一班),计划里写的 4 个以代码为准
    years = get(client, settings, "/years").json()
    assert [y["name"] for y in years] == ["2026-2027"]
    assert years[0]["id"] == YEAR_ID
    assert set(years[0]) == {"id", "name", "start_date", "end_date"}

    # 再补一个更早的往年,验证 start_date 倒序
    older = AcademicYear(
        school_id=SCHOOL,
        name="2025-2026",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 7, 15),
        is_active=False,
    )
    db.add(older)
    db.flush()
    years = get(client, settings, "/years").json()
    assert [y["name"] for y in years] == ["2026-2027", "2025-2026"]
    assert get(client, settings, "/years", user=DEAN).json() == years

    r = get(client, settings, "/classes", year_id=YEAR_ID)
    assert r.status_code == 200
    classes = r.json()
    assert [(c["grade_name"], c["class_name"]) for c in classes] == [
        ("三年级", "三年一班"),
        ("三年级", "三年二班"),
        ("四年级", "四年一班"),
    ]
    assert set(classes[0]) == {"class_id", "class_name", "grade_name", "homeroom_name", "students"}
    by_id = {c["class_id"]: c for c in classes}
    # 人数与升级前名单一致,三年二班含 2 名已转出学生
    assert {UUID(k): v["students"] for k, v in by_id.items()} == past["sizes"]
    assert by_id[CLASS_ID]["students"] == 13
    assert by_id[CLASS_ID]["homeroom_name"] == "张老师"
    assert by_id[C31]["homeroom_name"] == "孙老师"

    assert get(client, settings, "/classes", user=DEAN, year_id=YEAR_ID).json() == classes
    # 没有任何班的往年:空列表
    assert get(client, settings, "/classes", year_id=str(older.id)).json() == []


def test_roster_and_scores_readonly(client, settings, db, past):
    r = get(client, settings, f"/classes/{CLASS_ID}/students")
    assert r.status_code == 200
    students = r.json()["students"]
    assert set(r.json()) == {"students"}
    assert len(students) == 13
    # 正好四个键,不含家庭与档案字段
    assert all(set(s) == {"student_id", "name", "student_no", "status"} for s in students)
    # 学号顺序,学号为空的排后再按 mk
    assert [s["student_no"] for s in students] == [
        "2025099",
        *[f"2026{n:03d}" for n in range(1, 11)],
        "2026099",
        None,
    ]
    assert students[-1]["name"] == "无学号生"
    by_name = {s["name"]: s for s in students}
    assert by_name["转出生"]["status"] == "transferred"
    assert by_name["无学号生"]["status"] == "transferred"
    assert by_name["王小一"]["status"] == "promoted"
    assert by_name["无分生"]["status"] == "promoted"

    # 考试列表:日期倒序
    r = get(client, settings, f"/classes/{CLASS_ID}/exams")
    assert r.status_code == 200
    exams = r.json()
    assert [e["id"] for e in exams] == [EXAM_IDS[1], EXAM_IDS[0]]
    assert [e["date"] for e in exams] == ["2026-10-30", "2026-10-09"]
    assert set(exams[0]) == {"id", "name", "exam_type", "date", "subjects"}
    assert exams[0]["subjects"] == [
        {"name": "语文", "full": 100},
        {"name": "数学", "full": 100},
        {"name": "英语", "full": 100},
    ]

    # 成绩:口径与 exam_table 一致,参与排名的是该班全部 enrollment
    for exam_id in EXAM_IDS:
        r = get(client, settings, f"/exams/{exam_id}/scores")
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"exam", "students"}
        assert body["exam"]["id"] == exam_id

        subjects = [SubjectFull(**s) for s in body["exam"]["subjects"]]
        rows = db.execute(
            text(
                "SELECT e.id, e.student_id FROM enrollments e"
                " JOIN students s ON s.id = e.student_id"
                " WHERE e.class_id = :c ORDER BY s.mk"
            ),
            {"c": CLASS_ID},
        ).all()
        sid_of = {eid: sid for eid, sid in rows}
        scores: dict[UUID, dict[str, float | None]] = {}
        for eid, subject, value in db.execute(
            select(Score.enrollment_id, Score.subject, Score.value).where(
                Score.exam_id == UUID(exam_id)
            )
        ):
            scores.setdefault(eid, {})[subject] = value
        expect = exam_table(subjects, scores, [eid for eid, _ in rows])

        got = body["students"]
        assert len(got) == 13
        assert [(UUID(g["student_id"]), g["total"], g["class_rank"], g["scores"]) for g in got] == [
            (sid_of[r.enrollment_id], r.total, r.rank, r.subs) for r in expect
        ]
        assert all(
            set(g) == {"student_id", "name", "student_no", "scores", "total", "class_rank"}
            for g in got
        )
        # 没有任何成绩的在读学生排最后
        assert got[-1]["total"] is None and got[-1]["class_rank"] is None
        assert got[-1]["scores"] == {s.name: None for s in subjects}

    first = get(client, settings, f"/exams/{EXAM_IDS[0]}/scores").json()["students"]
    assert first[0]["name"] == "转出生" and first[0]["total"] == 300 and first[0]["class_rank"] == 1
    # 第二场:并列名次由 exam_table 决定,这里只核对有总分者名次升序
    second = get(client, settings, f"/exams/{EXAM_IDS[1]}/scores").json()["students"]
    ranks = [s["class_rank"] for s in second if s["class_rank"] is not None]
    assert ranks == sorted(ranks)
    assert len(ranks) == 10  # 3 名额外学生在第二场没有成绩

    # 只读:任何写方法都不存在
    h = auth(settings, PRINCIPAL)
    for path in ("/years", f"/classes/{CLASS_ID}/students", f"/exams/{EXAM_IDS[0]}/scores"):
        for method in ("post", "put", "patch", "delete"):
            r = getattr(client, method)(f"{BASE}{path}", headers=h)
            assert r.status_code == 405, (method, path)


def test_grade_head_sees_none(client, settings, db, past):
    r = get(client, settings, "/classes", user=GRADE_HEAD3, year_id=YEAR_ID)
    assert r.status_code == 200 and r.json() == []
    assert get(client, settings, "/years", user=GRADE_HEAD3).status_code == 200

    assert (
        get(client, settings, f"/classes/{CLASS_ID}/students", user=GRADE_HEAD3).status_code == 403
    )
    assert failed_audits(db, GRADE_HEAD3, CLASS_ID) == 1
    assert get(client, settings, f"/classes/{CLASS_ID}/exams", user=GRADE_HEAD3).status_code == 403
    assert failed_audits(db, GRADE_HEAD3, CLASS_ID) == 2
    r = get(client, settings, f"/exams/{EXAM_IDS[0]}/scores", user=GRADE_HEAD3)
    assert r.status_code == 403
    assert failed_audits(db, GRADE_HEAD3, CLASS_ID) == 3


def test_current_year_class_forbidden(client, settings, db, past):
    current = db.scalars(
        select(SchoolClass).where(SchoolClass.school_id == SCHOOL, SchoolClass.active.is_(True))
    ).all()
    assert current
    cur = next(c for c in current if c.name == "四年二班")
    cur_year = cur.academic_year_id
    assert str(cur_year) != YEAR_ID

    assert get(client, settings, f"/classes/{cur.id}/students").status_code == 403
    assert failed_audits(db, PRINCIPAL, cur.id) == 1
    assert get(client, settings, f"/classes/{cur.id}/exams").status_code == 403
    assert failed_audits(db, PRINCIPAL, cur.id) == 2

    # 当前学年班里的考试:考试存在,走班级判定,同样 403 + 审计
    exam = Exam(
        class_id=cur.id,
        academic_year_id=cur_year,
        name="新学年测验",
        exam_type="周测",
        date=date(2027, 10, 1),
        subjects=[{"name": "语文", "full": 100}],
    )
    db.add(exam)
    db.flush()
    exam_id = exam.id
    assert get(client, settings, f"/exams/{exam_id}/scores").status_code == 403
    assert failed_audits(db, PRINCIPAL, cur.id) == 3 or failed_audits(db, PRINCIPAL, exam_id) == 1

    # 学年参数:当前学年、随机 uuid 都是 404 YEAR_NOT_FOUND
    for year_id in (cur_year, uuid4()):
        r = get(client, settings, "/classes", year_id=str(year_id))
        assert r.status_code == 404 and r.json()["error"]["code"] == "YEAR_NOT_FOUND"

    # 不存在的班 / 考试:403 + 审计
    ghost = uuid4()
    assert get(client, settings, f"/classes/{ghost}/students").status_code == 403
    assert get(client, settings, f"/classes/{ghost}/exams").status_code == 403
    assert failed_audits(db, PRINCIPAL, ghost) == 2
    ghost_exam = uuid4()
    assert get(client, settings, f"/exams/{ghost_exam}/scores").status_code == 403
    assert failed_audits(db, PRINCIPAL, ghost_exam) == 1


def test_other_school_isolated(client, settings, db, past):
    other_id = db.execute(
        text("INSERT INTO schools (name) VALUES ('别校') RETURNING id")
    ).scalar_one()
    year = AcademicYear(
        school_id=other_id,
        name="2025-2026",
        start_date=date(2025, 9, 1),
        end_date=date(2026, 7, 15),
        is_active=False,
    )
    db.add(year)
    db.flush()
    grade = Grade(school_id=other_id, academic_year_id=year.id, name="三年级", display_order=3)
    db.add(grade)
    db.flush()
    cls = SchoolClass(
        school_id=other_id,
        academic_year_id=year.id,
        grade_id=grade.id,
        name="别校一班",
        active=False,
    )
    db.add(cls)
    db.flush()

    r = get(client, settings, "/classes", year_id=str(year.id))
    assert r.status_code == 404 and r.json()["error"]["code"] == "YEAR_NOT_FOUND"
    assert [y["name"] for y in get(client, settings, "/years").json()] == ["2026-2027"]
    assert get(client, settings, f"/classes/{cls.id}/students").status_code == 403
    assert failed_audits(db, PRINCIPAL, cls.id) == 1


def test_teacher_and_it_admin_forbidden(client, settings, db, past):
    for user in (T01, IT_ADMIN):
        for path, params in (
            ("/years", {}),
            ("/classes", {"year_id": YEAR_ID}),
            (f"/classes/{CLASS_ID}/students", {}),
            (f"/classes/{CLASS_ID}/exams", {}),
            (f"/exams/{EXAM_IDS[0]}/scores", {}),
        ):
            r = get(client, settings, path, user=user, **params)
            assert r.status_code == 403, (user, path)
    assert db.scalars(
        select(AuditLog).where(
            AuditLog.user_id == UUID(IT_ADMIN),
            AuditLog.action == "school.view",
            AuditLog.success.is_(False),
        )
    ).all()
