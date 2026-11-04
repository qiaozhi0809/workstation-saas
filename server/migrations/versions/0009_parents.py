"""parent link states, parent-visible comments"""

from pathlib import Path

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

_DIR = Path(__file__).parent


def _run(name: str) -> None:
    sql = (_DIR / name).read_text(encoding="utf-8")
    op.get_bind().exec_driver_sql(sql, execution_options={"no_parameters": True})


def upgrade() -> None:
    _run("0009_parents.up.sql")


def downgrade() -> None:
    _run("0009_parents.down.sql")
