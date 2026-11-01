import argparse
from pathlib import Path

from sqlalchemy import create_engine, text

from app.config import get_settings

SEED_SCHOOL_ID = "11111111-1111-1111-1111-111111111111"
SEED_SQL = Path(__file__).parent / "seed" / "dev_seed.sql"


def seed_dev() -> str:
    engine = create_engine(get_settings().database_url)
    try:
        with engine.begin() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM schools WHERE id = :id"), {"id": SEED_SCHOOL_ID}
            ).first()
            if exists:
                return "already seeded"
            conn.exec_driver_sql(
                SEED_SQL.read_text(encoding="utf-8"), execution_options={"no_parameters": True}
            )
            return "seeded"
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-dev", help="insert the dev seed data if absent")
    parser.parse_args()
    print(seed_dev())


if __name__ == "__main__":
    main()
