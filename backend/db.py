import os
from contextlib import asynccontextmanager
from urllib.parse import unquote, urlparse

import asyncmy

_pool = None


def _dsn() -> dict:
    u = urlparse(os.environ["DATABASE_URL"])
    return {
        "host": u.hostname,
        "port": u.port or 2881,
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
        "db": (u.path or "/").lstrip("/"),
    }


@asynccontextmanager
async def lifespan_pool():
    global _pool
    if os.getenv("DATABASE_URL"):
        # Generous pool: this UI fires several independent GET requests per
        # tab (and each expanded ticket card adds its own), so quick
        # navigation can briefly want more than the default minsize=1/maxsize=10.
        _pool = await asyncmy.create_pool(**_dsn(), autocommit=True, minsize=2, maxsize=30)
    yield
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()


def pool():
    return _pool
