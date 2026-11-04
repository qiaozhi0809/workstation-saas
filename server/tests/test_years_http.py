"""学年升级 HTTP 端点:suggest → preview → 执行 → latest → 回滚,权限、错误映射与响应字段。"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from tests.helpers import audit_rows, auth
from tests.seed_ids import CLASS_ID, TEACHER_IDS, TEACHER_USER_ID, YEAR_ID

PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
GRADE_HEAD = "55555555-5555-5555-5555-555555555545"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
API = "/api/v1/admin/years/upgrade"
NEW_YEAR = {"name": "2027-2028", "start_date": "2027-09-01", "end_date": "2028-07-15"}


def _suggest(client, settings, actor=DEAN):
    res = client.post(f"{API}/suggest", json=NEW_YEAR, headers=auth(settings, actor))
    assert res.status_code == 200, res.text
    return res.json()


def _post(client, settings, path, body=None, actor=DEAN):
    return client.post(f"{API}{path}", json=body, headers=auth(settings, actor))


def _rollback(client, settings, actor=DEAN):
    return client.post(f"{API}/rollback", headers=auth(settings, actor))


def _latest(client, settings, actor=DEAN):
    res = client.get(f"{API}/latest", headers=auth(settings, actor))
    assert res.status_code == 200, res.text
    return res.json()


def _error(res, status, code):
    assert res.status_code == status, res.text
    err = res.json()["error"]
    assert err["code"] == code
    return err


def test_full_flow_suggest_preview_apply_latest_rollback(client, db, settings):
    assert _latest(client, settings) is None
    plan = _suggest(client, settings)
    assert plan["version"] == 1 and plan["from_year_id"] == YEAR_ID
    assert {c["from_name"] for c in plan["classes"]} == {"三年二班", "三年一班", "四年一班"}
    # 组长按跟届规则预填:三年级组长 → 新学年四年级
    assert [(g["grade_name"], g["user_ids"]) for g in plan["grade_heads"]] == [
        ("四年级", [GRADE_HEAD])
    ]

    pv = _post(client, settings, "/preview", plan)
    assert pv.status_code == 200, pv.text
    body = pv.json()
    assert body["new_year"] == "2027-2028" and body["new_classes"] == []
    assert {c["to_label"] for c in body["classes"]} == {
        "四年级 四年二班",
        "四年级 四年一班",
        "五年级 五年一班",
    }

    done = _post(client, settings, "", plan)
    assert done.status_code == 201, done.text
    ids = done.json()
    assert set(ids) == {"upgrade_id", "new_year_id"}
    assert (
        db.execute(text("SELECT name FROM academic_years WHERE is_active")).scalar_one()
        == "2027-2028"
    )

    latest = _latest(client, settings)
    assert latest["id"] == ids["upgrade_id"] and latest["rolled_back"] is False
    assert (latest["from_year_name"], latest["to_year_name"]) == ("2026-2027", "2027-2028")
    assert latest["executed_at"]

    res = _rollback(client, settings)
    assert res.status_code == 200 and res.json() == {"ok": True}
    assert (
        db.execute(text("SELECT name FROM academic_years WHERE is_active")).scalar_one()
        == "2026-2027"
    )
    latest = _latest(client, settings)
    assert latest["id"] == ids["upgrade_id"] and latest["rolled_back"] is True
    assert latest["to_year_name"] == "2027-2028"  # 新学年行已删,名字取自存档的方案

    err = _error(_rollback(client, settings), 409, "UPGRADE_NOTHING_TO_ROLLBACK")
    assert err["message"]


def test_audit_records_actor_and_http_channel(client, db, settings):
    done = _post(client, settings, "", _suggest(client, settings)).json()
    assert _rollback(client, settings).status_code == 200
    rows = {r.action: r for r in audit_rows(db, done["new_year_id"])}
    for action in ("year.upgrade", "year.rollback"):
        row = rows[action]
        assert row.success and row.user_id == UUID(DEAN)
        assert row.extra["via"] == "http"


@pytest.mark.parametrize(
    "actor,ok",
    [
        (PRINCIPAL, True),
        (DEAN, True),
        (IT_ADMIN, False),
        (GRADE_HEAD, False),
        (TEACHER_USER_ID, False),
    ],
)
def test_permissions(client, settings, actor, ok):
    res = client.post(f"{API}/suggest", json=NEW_YEAR, headers=auth(settings, actor))
    assert (res.status_code == 200) == ok, res.text
    if not ok:
        assert _error(res, 403, "FORBIDDEN")
        assert client.get(f"{API}/latest", headers=auth(settings, actor)).status_code == 403
        assert _rollback(client, settings, actor).status_code == 403
        plan = _suggest(client, settings)
        assert _post(client, settings, "/preview", plan, actor).status_code == 403
        assert _post(client, settings, "", plan, actor).status_code == 403


def test_requires_login(client):
    assert client.post(f"{API}/suggest", json=NEW_YEAR).status_code == 401
    assert client.get(f"{API}/latest").status_code == 401


def test_apply_twice_is_stale(client, settings):
    plan = _suggest(client, settings)
    assert _post(client, settings, "", plan).status_code == 201
    _error(_post(client, settings, "", plan), 409, "UPGRADE_PLAN_STALE")
    _error(_post(client, settings, "/preview", plan), 409, "UPGRADE_PLAN_STALE")


def _bad(client, settings, plan, **details):
    err = _error(_post(client, settings, "/preview", plan), 400, "UPGRADE_PLAN_INVALID")
    for k, v in details.items():
        assert err["details"][k] == v, err
    # 执行也是同样的错误,且不留下任何东西
    err2 = _error(_post(client, settings, "", plan), 400, "UPGRADE_PLAN_INVALID")
    assert err2["details"] == err["details"]


def test_invalid_plan_details(client, db, settings):
    plan = _suggest(client, settings)
    plan["classes"][0]["to_name"] = None
    _bad(client, settings, plan, section="classes", index=0, field="to_name")

    plan = _suggest(client, settings)
    plan["students"] = [{"enrollment_id": str(uuid4()), "action": "leave"}]
    _bad(client, settings, plan, section="students", index=0, field="enrollment_id")

    plan = _suggest(client, settings)
    plan["new_classes"] = [{"grade_name": "四年级", "name": plan["classes"][0]["to_name"]}]
    plan["classes"] = sorted(plan["classes"], key=lambda c: c["from_name"])
    clash = next(c for c in plan["classes"] if c["to_grade_name"] == "四年级")
    plan["new_classes"][0]["name"] = clash["to_name"]
    _bad(client, settings, plan, section="new_classes", index=0, field="name")

    plan = _suggest(client, settings)
    plan["grade_heads"] = [{"grade_name": "九年级", "user_ids": [DEAN]}]
    _bad(client, settings, plan, section="grade_heads", index=0, field="grade_name")
    plan["grade_heads"] = [{"grade_name": "四年级", "user_ids": [str(uuid4())]}]
    _bad(client, settings, plan, section="grade_heads", index=0, field="user_ids")

    assert db.execute(text("SELECT count(*) FROM year_upgrades")).scalar_one() == 0


def test_structural_errors_map_to_plan_invalid(client, settings):
    """pydantic 结构校验失败也要给出 section/index/field,向导才能跳到对应行并标红。"""
    plan = _suggest(client, settings)
    good = {"grade_name": "四年级", "name": "四年三班", "seat_rows": 7, "seat_cols": 4}
    bad = {"grade_name": "四年级", "name": "四年四班", "desk_size": 2, "seat_cols": 3}
    plan["new_classes"] = [good, bad]
    _bad(client, settings, plan, section="new_classes", index=1, field="seat_cols")

    plan = _suggest(client, settings)
    plan["students"] = [{"enrollment_id": str(uuid4()), "action": "repeat"}]
    _bad(client, settings, plan, section="students", index=0, field="to")

    plan = _suggest(client, settings)
    plan["new_year"]["end_date"] = "2020-01-01"
    res = _post(client, settings, "/preview", plan)
    err = _error(res, 400, "UPGRADE_PLAN_INVALID")
    assert err["details"]["section"] == "new_year"

    # 同一条校验在执行端点上也一样
    plan = _suggest(client, settings)
    plan["new_classes"] = [bad]
    res = _post(client, settings, "", plan)
    err = _error(res, 400, "UPGRADE_PLAN_INVALID")
    assert (err["details"]["section"], err["details"]["field"]) == ("new_classes", "seat_cols")


def test_bad_request_body_is_400(client, settings):
    res = _post(client, settings, "/preview", {"version": 2})
    _error(res, 400, "BAD_REQUEST")
    res = _post(
        client,
        settings,
        "/suggest",
        {"name": "x", "start_date": "2028-01-01", "end_date": "2027-01-01"},
    )
    _error(res, 400, "BAD_REQUEST")


def test_suggest_without_active_year_is_409(client, db, settings):
    db.execute(text("UPDATE academic_years SET is_active = false"))
    _error(
        client.post(f"{API}/suggest", json=NEW_YEAR, headers=auth(settings, DEAN)),
        409,
        "NO_ACTIVE_YEAR",
    )


def test_rollback_has_data_details_pass_through(client, db, settings):
    done = _post(client, settings, "", _suggest(client, settings)).json()
    db.execute(
        text("UPDATE classes SET seat_version = 2 WHERE academic_year_id = :y"),
        {"y": done["new_year_id"]},
    )
    n = db.execute(
        text("SELECT count(*) FROM classes WHERE academic_year_id = :y"), {"y": done["new_year_id"]}
    ).scalar_one()
    err = _error(_rollback(client, settings), 409, "UPGRADE_HAS_DATA")
    assert err["details"] == {"seats": n}
    assert _latest(client, settings)["rolled_back"] is False


def test_responses_carry_every_field(client, db, settings):
    plan = _suggest(client, settings)
    assert plan["students"] == [] and plan["new_classes"] == []
    assert "grade_heads" in plan
    for c in plan["classes"]:
        assert set(c) >= {
            "from_class_id", "from_name", "action", "to_grade_name", "to_name",
            "homeroom_teacher_id", "teacher_name", "keep_teachers",
        }  # fmt: skip
        assert c["keep_teachers"] is True

    # 往返:原样回传后再取 preview,字段齐全(包括 null)
    pv = _post(client, settings, "/preview", plan).json()
    assert set(pv) == {"new_year", "classes", "new_classes", "warnings"}
    for row in pv["classes"]:
        assert set(row) == {
            "from_name", "action", "to_label", "teacher_name", "follow",
            "repeat_in", "repeat_out", "leave", "graduate",
        }  # fmt: skip

    # 含一个只给最少字段的新建班:存档的方案(也就是回给前端的形状)里座位字段齐全
    plan["new_classes"] = [{"grade_name": "一年级", "name": "一年一班"}]
    pv = _post(client, settings, "/preview", plan).json()
    assert pv["new_classes"] == ["一年级 一年一班(班主任 未定)"]
    assert any(r["action"] == "new" and r["teacher_name"] is None for r in pv["classes"])
    done = _post(client, settings, "", plan).json()
    stored = db.execute(
        text("SELECT plan FROM year_upgrades WHERE id = :i"), {"i": done["upgrade_id"]}
    ).scalar_one()
    assert stored["students"] == [] and stored["grade_heads"] is not None
    assert stored["new_classes"][0] == {
        "grade_name": "一年级", "name": "一年一班", "homeroom_teacher_id": None,
        "seat_rows": 7, "seat_cols": 4, "desk_size": 2, "seat_layout": "auto",
    }  # fmt: skip


def test_grade_heads_prefill_is_applied_and_explicit_list_wins(client, db, settings):
    plan = _suggest(client, settings)
    plan["grade_heads"] = [{"grade_name": "五年级", "user_ids": [DEAN]}]
    done = _post(client, settings, "", plan).json()
    rows = db.execute(
        text(
            "SELECT b.user_id, g.name FROM role_bindings b"
            " JOIN grades g ON g.id::text = b.scope->>'grade_id'"
            " WHERE b.role_type = 'grade_head' AND b.academic_year_id = :y AND b.ended_at IS NULL"
        ),
        {"y": done["new_year_id"]},
    ).all()
    assert [(str(r.user_id), r.name) for r in rows] == [(DEAN, "五年级")]


def test_teacher_id_normalisation(client, db, settings):
    """班主任可以传 users.id(选人接口只给这个),也可以传 teachers.id,结果一样。"""

    def run(value):
        plan = _suggest(client, settings)
        for c in plan["classes"]:
            if c["from_class_id"] == CLASS_ID:
                c["homeroom_teacher_id"] = value
        plan["new_classes"] = [
            {"grade_name": "一年级", "name": "一年一班", "homeroom_teacher_id": value}
        ]
        pv = _post(client, settings, "/preview", plan)
        assert pv.status_code == 200, pv.text
        done = _post(client, settings, "", plan)
        assert done.status_code == 201, done.text
        homerooms = db.execute(
            text(
                "SELECT name, homeroom_teacher_id FROM classes WHERE academic_year_id = :y"
                " ORDER BY name"
            ),
            {"y": done.json()["new_year_id"]},
        ).all()
        stored = db.execute(
            text("SELECT plan FROM year_upgrades WHERE id = :i"), {"i": done.json()["upgrade_id"]}
        ).scalar_one()
        assert _rollback(client, settings).status_code == 200
        return pv.json(), [(r.name, str(r.homeroom_teacher_id)) for r in homerooms], stored

    by_user = run(TEACHER_USER_ID)
    by_teacher = run(TEACHER_IDS["teacher01"])
    assert by_user == by_teacher
    pv, homerooms, stored = by_user
    assert ("一年一班", TEACHER_IDS["teacher01"]) in homerooms
    assert ("四年二班", TEACHER_IDS["teacher01"]) in homerooms
    assert stored["new_classes"][0]["homeroom_teacher_id"] == TEACHER_IDS["teacher01"]
    assert {r["teacher_name"] for r in pv["classes"] if r["to_label"].endswith("一年一班")} == {
        "张老师"
    }


def test_unknown_homeroom_id_still_rejected(client, settings):
    plan = _suggest(client, settings)
    plan["classes"][0]["homeroom_teacher_id"] = str(uuid4())
    err = _error(_post(client, settings, "/preview", plan), 400, "UPGRADE_PLAN_INVALID")
    assert err["details"]["field"] == "homeroom_teacher_id"
