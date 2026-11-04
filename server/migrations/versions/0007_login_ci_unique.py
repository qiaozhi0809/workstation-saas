"""case-insensitive unique login name per school"""

from pathlib import Path

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

_DIR = Path(__file__).parent


def _run(name: str) -> None:
    sql = (_DIR / name).read_text(encoding="utf-8")
    op.get_bind().exec_driver_sql(sql, execution_options={"no_parameters": True})


def upgrade() -> None:
    _run("0007_login_ci_unique.up.sql")


def downgrade() -> None:
    _run("0007_login_ci_unique.down.sql")
