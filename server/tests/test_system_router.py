"""`GET /admin/system/info` 的 last_backup 字段(L277):备份脚本写进 backup-last.json 的 `caddy`
("included" / "skipped")原样透传;旧脚本没写、或写了不认识的值 → null。"""

import json

from tests.helpers import auth

INFO = "/api/v1/admin/system/info"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
BASE = {"at": "2026-11-05T02:00:00Z", "file": "ws-backup-20261105.tar.gz", "size_bytes": 1234}


def _last_backup(client, s, payload):
    (s.log_dir / "backup-last.json").write_text(json.dumps(payload), encoding="utf-8")
    res = client.get(INFO, headers=auth(s, IT_ADMIN))
    assert res.status_code == 200, res.text
    return res.json()["last_backup"]


def test_last_backup_caddy_field(client, settings, tmp_path):
    s = settings.model_copy(update={"log_dir": tmp_path})
    client.app.state.settings = s
    assert _last_backup(client, s, {**BASE, "caddy": "included"}) == {**BASE, "caddy": "included"}
    assert _last_backup(client, s, {**BASE, "caddy": "skipped"})["caddy"] == "skipped"
    # 旧脚本没有这个键 → null;不认识的值也当未知,不让整条备份信息消失
    assert _last_backup(client, s, BASE) == {**BASE, "caddy": None}
    for odd in ("yes", 1, True, None, ["included"]):
        lb = _last_backup(client, s, {**BASE, "caddy": odd})
        assert lb["caddy"] is None and lb["size_bytes"] == 1234
