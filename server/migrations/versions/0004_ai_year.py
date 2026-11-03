"""ai chats, growth records, comments, school settings, year upgrades"""

from pathlib import Path

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

_DIR = Path(__file__).parent


def _run(name: str) -> None:
    sql = (_DIR / name).read_text(encoding="utf-8")
    op.get_bind().exec_driver_sql(sql, execution_options={"no_parameters": True})


def upgrade() -> None:
    _run("0004_ai_year.up.sql")


def downgrade() -> None:
    _run("0004_ai_year.down.sql")
