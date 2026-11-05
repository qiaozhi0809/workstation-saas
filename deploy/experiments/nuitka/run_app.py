"""试验入口:源码版与 Nuitka 编译版共用同一个入口,保证对比公平。

用法:run_app.py [serve|migrate|seed]
"""

import os
import sys
from pathlib import Path

# 让 Nuitka 的 --follow-imports 能看到这些只在运行期按名字加载的模块
import app.cli  # noqa: F401  (app.cli 不在 app.main 的导入链上)
import uvicorn
from alembic import command
from alembic.config import Config

from app.config import get_settings
from app.main import create_app

HERE = Path(__file__).resolve().parent


def migrate() -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(HERE / "migrations"))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    command.upgrade(cfg, "head")


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if cmd == "migrate":
        migrate()
    elif cmd == "seed":
        print(app.cli.seed_dev())
    elif cmd == "serve":
        port = int(os.environ.get("PORT", "8080"))
        uvicorn.run(create_app(), host="0.0.0.0", port=port, log_level="warning")  # noqa: S104
    else:
        print(f"未知命令:{cmd}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
