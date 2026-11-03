from sqlalchemy import func, select

from app.domain.accounts.importer import parse_csv
from app.models import User
from app.models.audit import AuditLog
from tests.helpers import auth

BASE = "/api/v1/admin/accounts"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
HEADER = "登录名,姓名,工号,科目,手机"


def _post(client, settings, tail, csv_text):
    return client.post(f"{BASE}/{tail}", headers=auth(settings, IT_ADMIN), json={"csv": csv_text})


def _count(db):
    return db.scalar(select(func.count()).select_from(User))


def test_preview_marks_errors(client, settings, db):
    before = _count(db)
    text = "\n".join(
        [
            HEADER,
            "imp_a,甲老师,T201,语文、数学,13800000031",
            "imp_a,乙老师,T202,英语,13800000032",
            "imp_c,丙老师,T203,英语,1380000",
            "imp_d,,T204,英语,13800000034",
            "teacher01,丁老师,T205,,",
            "x,戊老师,,,",
            "imp_f,己老师,,,",
        ]
    )
    res = _post(client, settings, "import/preview", text)
    assert res.status_code == 200
    rows = res.json()["rows"]
    assert [r["line"] for r in rows] == [2, 3, 4, 5, 6, 7, 8]
    assert [r["error"] for r in rows] == [
        None,
        "登录名重复",
        "手机号应为 11 位数字",
        "姓名不能为空",
        "登录名已被使用",
        "登录名格式不对",
        None,
    ]
    assert rows[0]["subjects"] == ["语文", "数学"]
    assert rows[6]["phone"] is None and rows[6]["employee_no"] is None
    assert _count(db) == before


def test_import_all_or_nothing(client, settings, db):
    before = _count(db)
    bad = f"{HEADER}\nimp_a,甲老师,,,\nimp_a,乙老师,,,"
    res = _post(client, settings, "import", bad)
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "IMPORT_INVALID"
    assert [r["line"] for r in err["details"]["rows"]] == [3]
    assert _count(db) == before

    good = f"{HEADER}\nimp_a,甲老师,T201,语文,13800000031\nimp_b,乙老师,,,"
    res = _post(client, settings, "import", good)
    assert res.status_code == 201
    created = res.json()["created"]
    assert [c["login_name"] for c in created] == ["imp_a", "imp_b"]
    assert all(len(c["temp_password"]) == 10 for c in created)
    assert len({c["temp_password"] for c in created}) == 2
    assert _count(db) == before + 2
    for c in created:
        login = client.post(
            "/api/v1/auth/login",
            json={"login_name": c["login_name"], "password": c["temp_password"]},
        )
        assert login.status_code == 200
        assert login.json()["user"]["must_change_password"] is True
    audit = db.scalars(select(AuditLog).where(AuditLog.action == "account.import")).one()
    assert audit.extra == {"count": 2}
    assert all(c["temp_password"] not in repr(audit.extra) for c in created)


def test_import_header_any_order():
    rows = parse_csv("姓名,登录名,手机,科目,工号\n甲老师,imp_a,13800000031,语文、数学,T1\n", set())
    assert len(rows) == 1
    r = rows[0]
    assert (r.login_name, r.display_name, r.phone, r.employee_no) == (
        "imp_a",
        "甲老师",
        "13800000031",
        "T1",
    )
    assert r.subjects == ["语文", "数学"] and r.error is None
    slash = parse_csv(f"{HEADER}\nimp_b,乙老师,,语文/英语,\n", set())
    assert slash[0].subjects == ["语文", "英语"]


def test_import_header_and_limit(client, settings, db):
    res = _post(client, settings, "import/preview", "登录名,姓名\nimp_a,甲")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "IMPORT_INVALID"
    big = HEADER + "\n" + "\n".join(f"imp_{n:04d},甲{n},,," for n in range(501))
    over = _post(client, settings, "import", big)
    assert over.status_code == 400
    assert over.json()["error"]["code"] == "IMPORT_INVALID"
    assert _post(client, settings, "import/preview", "").status_code == 400


def test_login_case_duplicates(client, settings, db):
    text = f"{HEADER}\nImp_A,甲,,,\nimp_a,乙,,,\nTEACHER01,丙,,,"
    rows = _post(client, settings, "import/preview", text).json()["rows"]
    assert [r["error"] for r in rows] == [None, "登录名重复", "登录名已被使用"]
    before = _count(db)
    res = _post(client, settings, "import", text)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "IMPORT_INVALID"
    assert _count(db) == before


def test_phone_non_ascii_digits_rejected():
    rows = parse_csv(f"{HEADER}\nimp_a,甲,,,١٣٨٠٠٠٠٠٠٢١\n", set())
    assert rows[0].error == "手机号应为 11 位数字"


def test_exactly_500_rows(client, settings, db, monkeypatch):
    from app.domain.accounts import service

    monkeypatch.setattr(service, "hash_password", lambda plain: "x")
    text = HEADER + "\n" + "\n".join(f"imp_{n:04d},甲{n},,," for n in range(500))
    assert len(_post(client, settings, "import/preview", text).json()["rows"]) == 500
    before = _count(db)
    res = _post(client, settings, "import", text)
    assert res.status_code == 201 and len(res.json()["created"]) == 500
    assert _count(db) == before + 500


def test_import_race_integrity_error_rolls_back_all(client, settings, db, monkeypatch):
    from app.domain.accounts import service

    monkeypatch.setattr(service, "_existing_logins", lambda db, school_id: set())
    before = _count(db)
    res = _post(client, settings, "import", f"{HEADER}\nimp_a,甲,,,\nteacher01,乙,,,")
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "IMPORT_INVALID"
    assert [(r["line"], r["error"]) for r in err["details"]["rows"]] == [(3, "登录名已被使用")]
    assert _count(db) == before
