from sqlalchemy import func, select

from app.domain.timetable.importer import parse_csv
from app.models.timetable import Period, TimetableEntry
from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, SCHOOL_ID, TEACHER_USER_ID

IT_ADMIN = "55555555-5555-5555-5555-555555555546"
URL = "/api/v1/admin/timetable/import"
HEADER = "班级,星期,节次,科目,工号"


def _periods(db, n=3):
    from datetime import time
    from uuid import UUID

    for i in range(n):
        db.add(
            Period(
                school_id=UUID(SCHOOL_ID),
                no=i + 1,
                starts_at=time(8 + i, 0),
                ends_at=time(8 + i, 40),
            )
        )
    db.flush()


def _post(client, settings, raw: bytes, user=IT_ADMIN):
    return client.post(
        URL, headers={**auth(settings, user), "Content-Type": "text/csv"}, content=raw
    )


def _count(db):
    return db.scalar(select(func.count()).select_from(TimetableEntry))


def test_import_ok_gbk(client, settings, db):
    _periods(db)
    text = "\n".join(
        [
            HEADER,
            "三年二班,周一,1,数学,T003",
            "三年二班,星期二,2,语文,",
            "三年二班,3,1,英语,",
            "三年二班,周日,3,语文,T001",
        ]
    )
    res = _post(client, settings, text.encode("gbk"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body == {"ok": True, "written": 4, "errors": []}
    tt = client.get(f"/api/v1/classes/{CLASS_ID}/timetable", headers=auth(settings)).json()
    cells = {(c["weekday"], c["period_no"]): c for c in tt["cells"]}
    assert set(cells) == {(1, 1), (2, 2), (3, 1), (7, 3)}
    assert cells[(1, 1)]["teacher"]["name"] == "赵老师"
    assert cells[(2, 2)]["teacher"]["name"] == "张老师"  # 自动匹配班主任兼语文
    assert cells[(3, 1)]["teacher"] is None
    assert [r.action for r in audit_rows(db, SCHOOL_ID)].count("timetable.import") == 1
    # 再导入一次(UTF-8 带 BOM):整班替换
    res = _post(client, settings, f"﻿{HEADER}\n三年二班,周五,1,数学,T003".encode())
    assert res.json()["written"] == 1 and _count(db) == 1


def test_import_reports_rows_and_writes_nothing(client, settings, db):
    _periods(db)
    text = "\n".join(
        [
            HEADER,
            "三年二班,周一,1,数学,T003",
            "九九班,周一,1,数学,",
            "三年二班,周二,13,数学,",
            "三年二班,周一,1,语文,",
            "三年二班,周三,1,数学,X999",
        ]
    )
    res = _post(client, settings, text.encode())
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False and body["written"] == 0
    assert [e["line"] for e in body["errors"]] == [3, 4, 5, 6]
    assert len(body["errors"]) == 4
    assert _count(db) == 0


def test_import_subject_and_teacher_errors(client, settings, db):
    _periods(db)
    text = "\n".join(
        [
            HEADER,
            "三年二班,周一,1,体育课X,",
            "三年二班,周二,1,数学,T001",
            "三年二班,周八,1,数学,",
        ]
    )
    body = _post(client, settings, text.encode()).json()
    assert body["ok"] is False
    assert [e["line"] for e in body["errors"]] == [2, 3, 4]
    assert _count(db) == 0


def test_import_bad_header(client, settings, db):
    res = _post(client, settings, "班级,星期\n三年二班,周一".encode())
    assert res.status_code == 400 and res.json()["error"]["code"] == "BAD_REQUEST"


def test_import_requires_org_manage(client, settings, db):
    _periods(db)
    raw = f"{HEADER}\n三年二班,周一,1,数学,T003".encode()
    res = _post(client, settings, raw, user=TEACHER_USER_ID)
    assert res.status_code == 403
    assert _count(db) == 0
    parent = "55555555-5555-5555-5555-555555555561"
    assert _post(client, settings, raw, user=parent).status_code == 403


def test_parse_csv_decodes_and_marks_bad_cells():
    rows = parse_csv(f"{HEADER}\n三年二班,星期三,2,数学,\n三年二班,x,y,数学,T1\n".encode("gbk"))
    assert [(r.line, r.weekday, r.period_no, r.employee_no) for r in rows] == [
        (2, 3, 2, None),
        (3, 0, 0, "T1"),
    ]
