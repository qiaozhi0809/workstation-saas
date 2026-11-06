import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from tests.helpers import auth

URL = "/api/v1/admin/settings/security"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
VALID = {"totp_allowed": True, "password_min_length": 12, "password_max_age_days": 90}


def test_default_when_no_row(client, settings):
    r = client.get(URL, headers=auth(settings, PRINCIPAL))
    assert r.status_code == 200
    assert r.json() == {"totp_allowed": False, "password_min_length": 8, "password_max_age_days": 0}


def test_principal_can_save_and_read_back(client, settings, db):
    h = auth(settings, PRINCIPAL)
    r = client.put(URL, headers=h, json=VALID)
    assert r.status_code == 200 and r.json() == VALID
    assert client.get(URL, headers=h).json() == VALID
    row = db.scalars(select(AuditLog).where(AuditLog.action == "settings.security_update")).one()
    assert row.success is True and row.object_type == "school_setting"


def test_dean_forbidden(client, settings):
    h = auth(settings, DEAN)
    assert client.get(URL, headers=h).status_code == 403
    assert client.put(URL, headers=h, json=VALID).status_code == 403


@pytest.mark.parametrize(
    "patch",
    [
        {"password_min_length": 7},
        {"password_min_length": 33},
        {"password_max_age_days": 30},
        {"password_max_age_days": -1},
    ],
)
def test_invalid_values_rejected(client, settings, patch):
    r = client.put(URL, headers=auth(settings, PRINCIPAL), json={**VALID, **patch})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "BAD_REQUEST"


def test_boundaries_accepted(client, settings):
    h = auth(settings, PRINCIPAL)
    for n, d in ((8, 0), (32, 365), (16, 180)):
        body = {"totp_allowed": False, "password_min_length": n, "password_max_age_days": d}
        assert client.put(URL, headers=h, json=body).status_code == 200
