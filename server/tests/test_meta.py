"""`GET /meta`:任何已登录用户(含家长)都能拿到版本、校名与学校时区(L74 / L79)。"""

from sqlalchemy import text

from app.version import APP_VERSION
from tests.helpers import auth
from tests.seed_ids import SCHOOL_ID, TEACHER_USER_ID

META = "/api/v1/meta"
LI = "55555555-5555-5555-5555-555555555561"  # 李家长(纯家长账号)


def test_meta_for_parent(client, db, settings):
    res = client.get(META, headers=auth(settings, LI))
    assert res.status_code == 200, res.text
    assert res.json() == {
        "version": APP_VERSION,
        "school_name": "示例小学",
        "school_tz": "Asia/Shanghai",
    }
    assert client.get(META, headers=auth(settings, TEACHER_USER_ID)).json() == res.json()
    # 学校改了时区,下一次就是新值
    db.execute(text("UPDATE schools SET timezone = 'Asia/Urumqi' WHERE id = :s"), {"s": SCHOOL_ID})
    assert client.get(META, headers=auth(settings, LI)).json()["school_tz"] == "Asia/Urumqi"


def test_meta_requires_login(client):
    res = client.get(META)
    assert res.status_code == 401
