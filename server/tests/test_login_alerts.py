import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app import clock
from app.auth import login_log
from app.auth import service as auth_service
from app.domain.schools.service import school_tz
from app.models import LoginLog, Notice, NoticeRecipient, RoleBinding, School, SchoolSetting, User
from app.rbac.roles import Role
from app.ws.hub import CHANNEL
from tests.factories import make_admin
from tests.helpers import auth, freeze
from tests.seed_ids import SCHOOL_ID, TEACHER_USER_ID

API = "/api/v1"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
NIGHT = "2026-11-05T18:00:00+00:00"  # 上海 11-06 02:00
NOON = "2026-11-05T04:00:00+00:00"  # 上海 11-05 12:00
TITLE = "账号安全提醒"


def _login(client, name="teacher01", pw="dev123", ip="192.0.2.10"):
    c = TestClient(client.app, client=(ip, 50000))
    return c.post(f"{API}/auth/login", json={"login_name": name, "password": pw})


def _alerts(db, user_id):
    db.expire_all()
    return list(
        db.scalars(
            select(Notice)
            .join(NoticeRecipient, NoticeRecipient.notice_id == Notice.id)
            .where(NoticeRecipient.user_id == UUID(str(user_id)), Notice.from_user_id.is_(None))
            .order_by(Notice.created_at)
        )
    )


def _history(db, user_id, ip, n, now):
    for i in range(n):
        db.add(
            LoginLog(
                school_id=UUID(SCHOOL_ID),
                user_id=UUID(str(user_id)),
                login_name="teacher01",
                result="success",
                ip=ip,
                created_at=now - timedelta(days=i + 1),
            )
        )
    db.flush()


def test_night_login_alerts(client, db, monkeypatch):
    freeze(monkeypatch, NIGHT)
    assert _login(client).status_code == 200
    mine = _alerts(db, TEACHER_USER_ID)
    admin = _alerts(db, IT_ADMIN)
    assert len(mine) == 1 and len(admin) == 1
    for n in (mine[0], admin[0]):
        assert n.title == TITLE and n.from_user_id is None
        assert n.target == {"type": "system", "kind": "security"}
        assert n.target_label == "系统" and n.require_ack is False
    assert "2026-11-06 02:00" in mine[0].content and "192.0.2.10" in mine[0].content
    assert "凌晨时段" in mine[0].content and "请立即修改密码并联系信息中心" in mine[0].content
    teacher = db.get(User, UUID(TEACHER_USER_ID))
    assert f"{teacher.display_name}({teacher.login_name})" in admin[0].content
    assert "请立即修改" not in admin[0].content
    log = db.scalars(select(LoginLog).where(LoginLog.result == "success")).one()
    assert log.suspicious == ["night"]


def test_noon_login_no_alert(client, db, monkeypatch):
    freeze(monkeypatch, NOON)
    assert _login(client).status_code == 200
    assert _alerts(db, TEACHER_USER_ID) == [] and _alerts(db, IT_ADMIN) == []


def test_alert_publishes_notice_new(client, db, monkeypatch, redis_client):
    sub = redis_client.pubsub()
    sub.subscribe(CHANNEL)
    assert sub.get_message(timeout=2)["type"] == "subscribe"
    freeze(monkeypatch, NIGHT)
    _login(client)
    seen = []
    while (m := sub.get_message(timeout=0.3)) is not None:
        if m["type"] == "message":
            seen.append(json.loads(m["data"]))
    sub.close()
    events = [m for m in seen if m["event"].get("type") == "notice.new"]
    assert len(events) == 2  # 本人一条、信息中心一条
    assert {u for m in events for u in m["user_ids"]} == {TEACHER_USER_ID, IT_ADMIN}
    assert all(m["event"]["title"] == TITLE and m["event"]["from_name"] is None for m in events)


def test_new_network_needs_history(client, db, monkeypatch):
    freeze(monkeypatch, NOON)
    now = clock.utc_now()
    _history(db, TEACHER_USER_ID, "198.51.100.7", 2, now)
    assert _login(client, ip="203.0.113.9").status_code == 200  # 成功记录不足 3 条
    assert _alerts(db, TEACHER_USER_ID) == []
    # 现在 203.0.113.0/24 也进了历史,共 3 条成功记录
    assert _login(client, ip="203.0.113.77").status_code == 200  # 同网段:不提醒
    assert _alerts(db, TEACHER_USER_ID) == []
    assert _login(client, ip="198.51.100.200").status_code == 200  # 同网段:不提醒
    assert _alerts(db, TEACHER_USER_ID) == []
    assert _login(client, ip="192.0.2.50").status_code == 200  # 第 4 次起换了新网段
    mine = _alerts(db, TEACHER_USER_ID)
    assert len(mine) == 1 and "新的网络环境" in mine[0].content
    assert len(_alerts(db, IT_ADMIN)) == 1


def test_new_network_ignores_old_history(client, db, monkeypatch):
    freeze(monkeypatch, NOON)
    _history(db, TEACHER_USER_ID, "198.51.100.7", 3, clock.utc_now() - timedelta(days=100))
    assert _login(client, ip="192.0.2.50").status_code == 200
    assert _alerts(db, TEACHER_USER_ID) == []


def test_alert_recipients(client, db, monkeypatch):
    freeze(monkeypatch, NIGHT)
    # 本人就是信息中心:只收一条
    assert _login(client, name="itadmin01").status_code == 200
    assert len(_alerts(db, IT_ADMIN)) == 1
    # 冻结的、绑定已结束的信息中心不收
    frozen = make_admin(db, None, Role.it_admin.value)
    frozen.status = "frozen"
    ended = make_admin(db, None, Role.it_admin.value)
    db.query(RoleBinding).filter(RoleBinding.user_id == ended.id).update(
        {"ended_at": clock.utc_now()}
    )
    live = make_admin(db, None, Role.it_admin.value)
    db.flush()
    assert _login(client).status_code == 200
    assert len(_alerts(db, live.id)) == 1
    assert _alerts(db, frozen.id) == [] and _alerts(db, ended.id) == []
    assert len(_alerts(db, TEACHER_USER_ID)) == 1
    assert len(_alerts(db, IT_ADMIN)) == 2


def test_alert_does_not_leak_to_other_school_it_admin(client, db, monkeypatch):
    freeze(monkeypatch, NIGHT)
    other = School(name="别校")
    db.add(other)
    db.flush()
    stranger = make_admin(db, other.id, Role.it_admin.value)
    assert _login(client).status_code == 200
    assert _alerts(db, stranger.id) == []
    assert _alerts(db, TEACHER_USER_ID)[0].school_id == UUID(SCHOOL_ID)


def test_alert_dedup_per_day(client, db, monkeypatch, redis_client):
    freeze(monkeypatch, NIGHT)
    _login(client)
    _login(client)
    assert len(_alerts(db, TEACHER_USER_ID)) == 1 and len(_alerts(db, IT_ADMIN)) == 1
    key = f"ws:alert:{TEACHER_USER_ID}:192.0.2.0/24:2026-11-06"
    assert redis_client.exists(key) and 0 < redis_client.ttl(key) <= 2 * 86400
    _login(client, ip="198.51.100.4")  # 换网段重新提醒
    assert len(_alerts(db, TEACHER_USER_ID)) == 2
    freeze(monkeypatch, "2026-11-06T18:00:00+00:00")  # 次日同网段重新提醒
    _login(client)
    assert len(_alerts(db, TEACHER_USER_ID)) == 3


def test_failed_login_never_alerts(client, db, monkeypatch):
    freeze(monkeypatch, NIGHT)
    assert _login(client, pw="wrong").status_code == 401
    assert _login(client, name="nobody").status_code == 401
    assert _alerts(db, TEACHER_USER_ID) == [] and _alerts(db, IT_ADMIN) == []


def test_alert_without_school_settings_row(client, db, monkeypatch):
    db.execute(delete(SchoolSetting))
    db.flush()
    freeze(monkeypatch, NIGHT)
    assert _login(client).status_code == 200
    assert len(_alerts(db, TEACHER_USER_ID)) == 1


def test_inbox_shows_system_notice_with_null_sender(client, db, settings, monkeypatch):
    freeze(monkeypatch, NIGHT)
    _login(client)
    res = client.get(f"{API}/notices", headers=auth(settings, TEACHER_USER_ID))
    assert res.status_code == 200
    items = [i for i in res.json()["items"] if i["title"] == TITLE]
    assert len(items) == 1 and items[0]["from_name"] is None


def test_alert_failure_does_not_block_login(client, db, monkeypatch):
    freeze(monkeypatch, NIGHT)

    def boom(*_a, **_k):
        raise RuntimeError("redis down")

    monkeypatch.setattr(auth_service, "alert", boom)
    res = _login(client)
    assert res.status_code == 200
    assert res.json()["access_token"] and res.json()["refresh_token"]


def test_parent_night_login_notice_in_inbox(client, db, settings, monkeypatch):
    freeze(monkeypatch, NIGHT)
    res = _login(client, name="13800000061")
    assert res.status_code == 200
    parent_id = db.scalars(select(User.id).where(User.login_name == "13800000061")).one()
    assert len(_alerts(db, parent_id)) == 1
    # 令牌按真实时钟签发(登录时钟被冻结在过去,响应里的令牌已过期)
    inbox = client.get(f"{API}/notices", headers=auth(settings, parent_id))
    assert inbox.status_code == 200
    items = [i for i in inbox.json()["items"] if i["title"] == TITLE]
    assert len(items) == 1 and items[0]["from_name"] is None


# ---------- suspicious_reasons 边界 ----------


def _reasons(db, ip, now, user_id=TEACHER_USER_ID):
    user = db.get(User, UUID(user_id))
    return login_log.suspicious_reasons(db, user, ip, now, school_tz(db, user.school_id))


def _utc(h, m=0, day=5):
    return datetime(2026, 11, day, h, m, tzinfo=UTC)


def test_night_window_boundaries(db):
    # 上海 UTC+8:本地 00:00 = 前一日 UTC 16:00
    assert "night" in _reasons(db, None, _utc(16, 0, day=4))  # 00:00
    assert "night" in _reasons(db, None, _utc(20, 59, day=4))  # 04:59
    assert "night" not in _reasons(db, None, _utc(21, 0, day=4))  # 05:00
    assert "night" not in _reasons(db, None, _utc(15, 59, day=5))  # 23:59


def test_new_network_ipv6_uses_slash_64(db):
    now = _utc(4)
    _history(db, TEACHER_USER_ID, "2001:db8:1:2::1", 3, now)
    assert _reasons(db, "2001:db8:1:2:ffff::9", now) == []
    assert _reasons(db, "2001:db8:1:3::1", now) == ["new_network"]


def test_new_network_ignores_history_without_ip(db):
    now = _utc(4)
    _history(db, TEACHER_USER_ID, None, 3, now)
    assert _reasons(db, "192.0.2.50", now) == []  # 无 IP 的成功记录不计入历史


def test_new_network_null_ip_never_flagged(db):
    now = _utc(4)
    _history(db, TEACHER_USER_ID, "198.51.100.7", 3, now)
    assert _reasons(db, None, now) == []


def test_new_network_ipv4_mapped_ipv6_normalised(db):
    now = _utc(4)
    _history(db, TEACHER_USER_ID, "198.51.100.7", 3, now)
    assert _reasons(db, "::ffff:198.51.100.9", now) == []
    assert _reasons(db, "::ffff:192.0.2.9", now) == ["new_network"]
    assert login_log.network_of("::ffff:198.51.100.9") == "198.51.100.0/24"


def _history_at(db, ip, at):
    for _ in range(3):
        db.add(
            LoginLog(
                school_id=UUID(SCHOOL_ID),
                user_id=UUID(TEACHER_USER_ID),
                login_name="teacher01",
                result="success",
                ip=ip,
                created_at=at,
            )
        )
    db.flush()


def test_new_network_history_window_is_inclusive_at_90_days(db):
    now = _utc(4)
    _history_at(db, "198.51.100.7", now - timedelta(days=90))  # created_at >= now-90d:计入
    assert _reasons(db, "192.0.2.50", now) == ["new_network"]


def test_new_network_history_just_outside_90_days_ignored(db):
    now = _utc(4)
    _history_at(db, "198.51.100.7", now - timedelta(days=90, seconds=1))
    assert _reasons(db, "192.0.2.50", now) == []
