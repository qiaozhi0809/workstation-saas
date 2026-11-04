import csv
import io
from datetime import date

from sqlalchemy import select, text

from app.models import Attendance, Enrollment, Student
from app.models.audit import AuditLog
from tests.factories import make_class, make_student
from tests.helpers import auth, freeze
from tests.seed_ids import SCHOOL_ID

NOW = "2026-10-20T02:00:00+00:00"  # 学校时区 2026-10-20 10:00
G3 = "33333333-3333-3333-3333-333333333333"
G4 = "33333333-3333-3333-3333-333333333334"
C32 = "44444444-4444-4444-4444-444444444444"
C31 = "44444444-4444-4444-4444-444444444441"
C41 = "44444444-4444-4444-4444-444444444442"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD3 = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
TEACHER = "55555555-5555-5555-5555-555555555555"
BASE = "/api/v1/admin/reports/attendance"


def get_report(client, settings, user=PRINCIPAL, **params):
    return client.get(BASE, params=params, headers=auth(settings, user))


def get_detail(client, settings, class_id, user=PRINCIPAL, month="2026-10"):
    params = {"class_id": class_id, "month": month}
    return client.get(f"{BASE}/class", params=params, headers=auth(settings, user))


def get_export(client, settings, user=PRINCIPAL, **params):
    return client.get(f"{BASE}/export", params=params, headers=auth(settings, user))


def enrolled_since_september(db):
    """报表按进班日算:种子已把 entered_at 拨回开学日,这里仍显式写一遍,让用例不依赖种子细节。"""
    db.execute(text("UPDATE enrollments SET entered_at = '2026-08-31T16:00:00+00:00'"))
    db.flush()


def enrollment_of_mk(db, mk: str) -> Enrollment:
    return db.scalars(
        select(Enrollment)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Student.mk == mk)
    ).one()


def mark(db, mk: str, day: str, status: str) -> None:
    e = enrollment_of_mk(db, mk)
    db.add(
        Attendance(
            enrollment_id=e.id, class_id=e.class_id, date=date.fromisoformat(day), status=status
        )
    )
    db.flush()


def by_class(body) -> dict[str, dict]:
    return {c["class_name"]: c for c in body["classes"]}


def test_month_report_seed(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    res = get_report(client, settings, month="2026-10")
    assert res.status_code == 200
    body = res.json()
    assert (body["month"], body["scope_label"]) == ("2026-10", "全校")
    # 三个班 10-12 至 10-16 共 5 个已确认日;三年一班 6 人、三年二班 10 人、四年一班 6 人
    assert body["classes"] == [
        {
            "class_id": C31,
            "class_name": "三年一班",
            "grade_name": "三年级",
            "days": 5,
            "expected": 30,
            "present": 28,
            "leave": 1,
            "absent": 1,
            "late": 0,
            "rate": 28 / 30,
        },
        {
            "class_id": C32,
            "class_name": "三年二班",
            "grade_name": "三年级",
            "days": 5,
            "expected": 50,
            "present": 49,
            "leave": 1,
            "absent": 0,
            "late": 1,
            "rate": 49 / 50,
        },
        {
            "class_id": C41,
            "class_name": "四年一班",
            "grade_name": "四年级",
            "days": 5,
            "expected": 30,
            "present": 29,
            "leave": 0,
            "absent": 1,
            "late": 1,
            "rate": 29 / 30,
        },
    ]
    assert body["total"] == {
        "days": 15,
        "expected": 110,
        "present": 106,
        "leave": 2,
        "absent": 2,
        "late": 2,
        "rate": 106 / 110,
    }


def test_month_defaults_to_school_tz_current_month(client, db, settings, monkeypatch):
    enrolled_since_september(db)
    freeze(monkeypatch, "2026-10-31T16:30:00+00:00")  # 学校时区已是 11-01
    assert get_report(client, settings).json()["month"] == "2026-11"
    freeze(monkeypatch, "2026-10-31T15:30:00+00:00")  # 学校时区 10-31 23:30
    body = get_report(client, settings).json()
    assert (body["month"], body["total"]["days"]) == ("2026-10", 15)


def test_invalid_month_rejected(client, settings):
    for bad in ("2026-13", "2026-1", "202610", "abc"):
        assert get_report(client, settings, month=bad).status_code == 400
    assert get_detail(client, settings, C31, month="2026-00").status_code == 400
    assert get_export(client, settings, month="2026-13").status_code == 400


def test_month_year_out_of_range_rejected(client, settings):
    for bad in ("0000-01", "9999-12", "1969-12", "2101-01"):
        assert get_report(client, settings, month=bad).status_code == 400, bad
        assert get_detail(client, settings, C31, month=bad).status_code == 400, bad
        assert get_export(client, settings, month=bad).status_code == 400, bad
    assert get_report(client, settings, month="2100-12").status_code == 200
    assert get_report(client, settings, month="1970-01").status_code == 200


def test_expected_counts_daily_roster(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    # 三年一班 6 人。转入生:本地 10-14 00:30 进班(UTC 仍是 10-13);
    # 转出生 S0011:本地 10-15 00:30 离班(UTC 仍是 10-14)
    newcomer = make_student(db, C31, "转入生", "S9001", student_no="2026901")
    db.execute(
        text(
            "UPDATE enrollments SET entered_at = '2026-10-13T16:30:00+00:00' WHERE student_id = :s"
        ),
        {"s": newcomer},
    )
    db.execute(
        text(
            "UPDATE enrollments SET left_at = '2026-10-14T16:30:00+00:00', status = 'transferred'"
            " WHERE student_id = (SELECT id FROM students WHERE mk = 'S0011')"
        )
    )
    # 10-19 未确认(没有 attendance_days),其缺勤不计入
    mark(db, "S0013", "2026-10-19", "absent")
    body = get_report(client, settings, month="2026-10").json()
    c31 = by_class(body)["三年一班"]
    # 每天在读:10-12 6、10-13 6、10-14 7(转入当天算)、10-15 6(转出当天不算)、10-16 6
    assert (c31["days"], c31["expected"]) == (5, 6 + 6 + 7 + 6 + 6)
    assert (c31["leave"], c31["absent"], c31["late"]) == (1, 1, 0)
    assert c31["present"] == 31 - 2
    assert c31["rate"] == 29 / 31
    # 其他班不受影响
    assert by_class(body)["三年二班"]["expected"] == 50


def test_rate_null_when_no_days(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    mark(db, "S0001", "2026-11-02", "absent")  # 有记录但没确认:不算记录日
    body = get_report(client, settings, month="2026-11").json()
    assert len(body["classes"]) == 3
    for row in body["classes"]:
        assert (row["days"], row["expected"], row["present"]) == (0, 0, 0)
        assert (row["leave"], row["absent"], row["late"]) == (0, 0, 0)
        assert row["rate"] is None
    assert body["total"] == {
        "days": 0,
        "expected": 0,
        "present": 0,
        "leave": 0,
        "absent": 0,
        "late": 0,
        "rate": None,
    }


def test_class_detail_includes_left_students_sorted(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    # 三年一班是 S0011-S0016;种子里 S0012 缺勤 10-13、S0015 请假 10-15
    mark(db, "S0014", "2026-10-14", "absent")
    mark(db, "S0014", "2026-10-15", "absent")
    mark(db, "S0013", "2026-10-12", "absent")
    mark(db, "S0013", "2026-10-14", "late")
    mark(db, "S0011", "2026-10-12", "leave")
    mark(db, "S0016", "2026-10-19", "absent")  # 未确认日,不计
    db.execute(
        text(
            "UPDATE enrollments SET left_at = '2026-10-14T16:30:00+00:00', status = 'transferred'"
            " WHERE student_id = (SELECT id FROM students WHERE mk = 'S0011')"
        )
    )
    early = make_student(db, C31, "早转生", "S9002", student_no="2026902")
    late_in = make_student(db, C31, "晚转入生", "S9003", student_no="2026903")
    db.execute(
        text("UPDATE enrollments SET left_at = '2026-09-20T02:00:00+00:00' WHERE student_id = :s"),
        {"s": early},
    )
    db.execute(
        text(
            "UPDATE enrollments SET entered_at = '2026-11-02T02:00:00+00:00' WHERE student_id = :s"
        ),
        {"s": late_in},
    )
    body = get_detail(client, settings, C31).json()
    assert (body["month"], body["class_id"], body["class_name"], body["days"]) == (
        "2026-10",
        C31,
        "三年一班",
        5,
    )
    got = [
        (s["name"], s["student_no"], s["absent"], s["leave"], s["late"]) for s in body["students"]
    ]
    # 缺勤多到少,再请假、迟到,最后学号;已转出的 S0011 在列,9 月就离班的和 11 月才进班的不在
    assert got == [
        ("严小四", "2026014", 2, 0, 0),
        ("曹小三", "2026013", 1, 0, 1),
        ("孔小二", "2026012", 1, 0, 0),
        ("钱小一", "2026011", 0, 1, 0),
        ("华小五", "2026015", 0, 1, 0),
        ("金小六", "2026016", 0, 0, 0),
    ]
    assert all(set(s) >= {"student_id", "name", "student_no"} for s in body["students"])


def test_class_detail_forbidden_when_not_visible(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    # 年级组长看不到四年一班;不存在的班同样 403,不是 404
    for class_id in (C41, "44444444-4444-4444-4444-4444444444ff"):
        res = get_detail(client, settings, class_id, user=GRADE_HEAD3)
        assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN")
    rows = db.scalars(select(AuditLog).where(AuditLog.action == "school.view")).all()
    assert [(r.success, r.object_type, r.object_id) for r in rows] == [
        (False, "class", C41),
        (False, "class", "44444444-4444-4444-4444-4444444444ff"),
    ]


def test_grade_head_scope(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    body = get_report(client, settings, user=GRADE_HEAD3, month="2026-10").json()
    assert body["scope_label"] == "三年级"
    assert [c["class_name"] for c in body["classes"]] == ["三年一班", "三年二班"]
    assert body["total"] == {
        "days": 10,
        "expected": 80,
        "present": 77,
        "leave": 2,
        "absent": 1,
        "late": 1,
        "rate": 77 / 80,
    }
    # 别的年级过滤出来是空的,不泄露
    other = get_report(client, settings, user=GRADE_HEAD3, month="2026-10", grade_id=G4).json()
    assert other["classes"] == []
    assert other["total"]["rate"] is None
    assert get_detail(client, settings, C32, user=GRADE_HEAD3).status_code == 200


def test_grade_filter_and_dean(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    body = get_report(client, settings, user=DEAN, month="2026-10", grade_id=G4).json()
    assert body["scope_label"] == "全校"
    assert [c["class_name"] for c in body["classes"]] == ["四年一班"]
    assert body["total"]["expected"] == 30


def test_attendance_read_filter_applies(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    # 班主任不是领导身份:school.view 就进不来
    res = get_report(client, settings, user=TEACHER, month="2026-10")
    assert res.status_code == 403
    # 新建的班没有记录日,但领导能看到,days = 0
    make_class(db, "三年三班")
    body = get_report(client, settings, month="2026-10").json()
    assert by_class(body)["三年三班"]["days"] == 0
    assert by_class(body)["三年三班"]["rate"] is None


def test_it_admin_forbidden(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    for res in (
        get_report(client, settings, user=IT_ADMIN, month="2026-10"),
        get_detail(client, settings, C31, user=IT_ADMIN),
        get_export(client, settings, user=IT_ADMIN, month="2026-10"),
    ):
        assert (res.status_code, res.json()["error"]["code"]) == (403, "FORBIDDEN")
    actions = {r.action for r in db.scalars(select(AuditLog)).all()}
    assert "attendance.export" not in actions
    assert "school.view" in actions


def test_export_audited(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    res = get_export(client, settings, month="2026-10")
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/csv; charset=utf-8"
    assert "attendance-2026-10.csv" in res.headers["content-disposition"]
    assert res.content.startswith(b"\xef\xbb\xbf")
    lines = res.content.decode("utf-8-sig").splitlines()
    assert lines == [
        "年级,班级,记录天数,应到人次,实到人次,请假,缺勤,迟到,出勤率",
        "三年级,三年一班,5,30,28,1,1,0,93.3%",
        "三年级,三年二班,5,50,49,1,0,1,98.0%",
        "四年级,四年一班,5,30,29,0,1,1,96.7%",
        "合计,,15,110,106,2,2,2,96.4%",
    ]
    rows = db.scalars(select(AuditLog).where(AuditLog.action == "attendance.export")).all()
    assert len(rows) == 1
    audit = rows[0]
    assert (str(audit.user_id), audit.success, audit.object_type, audit.object_id) == (
        PRINCIPAL,
        True,
        "school",
        SCHOOL_ID,
    )
    assert audit.extra == {"month": "2026-10", "grade_id": None}

    res = get_export(client, settings, user=GRADE_HEAD3, month="2026-10", grade_id=G3)
    lines = res.content.decode("utf-8-sig").splitlines()
    assert [ln.split(",")[1] for ln in lines] == ["班级", "三年一班", "三年二班", ""]
    rows = db.scalars(select(AuditLog).where(AuditLog.action == "attendance.export")).all()
    assert [r.extra for r in rows if r.user_id is not None and str(r.user_id) == GRADE_HEAD3] == [
        {"month": "2026-10", "grade_id": G3}
    ]


def test_export_empty_rate_cell(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    lines = get_export(client, settings, month="2026-11").content.decode("utf-8-sig").splitlines()
    assert lines[1] == "三年级,三年一班,0,0,0,0,0,0,"
    assert lines[-1] == "合计,,0,0,0,0,0,0,"


def test_export_neutralizes_formula_cells(client, db, settings, monkeypatch):
    freeze(monkeypatch, NOW)
    enrolled_since_september(db)
    make_class(db, '=HYPERLINK("x")')
    make_class(db, "@cmd")
    make_class(db, "+1")
    make_class(db, "-1")
    db.flush()
    text_ = get_export(client, settings, month="2026-10").content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text_)))
    names = [r[1] for r in rows]
    assert '\'=HYPERLINK("x")' in names
    assert {"'@cmd", "'+1", "'-1"} <= set(names)
    assert not any(n.startswith(("=", "@", "+", "-")) for n in names)
    assert "三年一班" in names  # 普通名字不加前缀
    assert all(not r[8].startswith("'") for r in rows[1:])  # 百分比 / 数字格不加
