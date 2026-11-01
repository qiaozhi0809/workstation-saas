"""initial schema"""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

_DIR = Path(__file__).parent


def _run(name: str) -> None:
    sql = (_DIR / name).read_text(encoding="utf-8")
    op.get_bind().exec_driver_sql(sql, execution_options={"no_parameters": True})


def upgrade() -> None:
    _run("0001_init.up.sql")


def downgrade() -> None:
    _run("0001_init.down.sql")
