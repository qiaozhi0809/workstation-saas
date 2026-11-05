import os
from datetime import UTC, datetime

APP_VERSION: str = os.environ.get("WS_APP_VERSION", "0.0.0-dev")
STARTED_AT: datetime = datetime.now(UTC)
