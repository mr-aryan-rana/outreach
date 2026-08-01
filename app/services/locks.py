"""Redis-backed lock so only one search job (dashboard button or the
orchestrator's own search phase) can run against DuckDuckGo at a time --
without this, both surfaces can independently launch a search loop,
multiplying real request volume against DDG beyond what any single loop's
internal delay/backoff assumes.

One operator drives this app, so a second concurrent attempt is rejected
outright (mirrors Orchestrator.start()'s existing
`if self.running: return False, "already running"` pattern) rather than
queued -- queueing would add real state/cleanup complexity for a scenario
that's just "you clicked twice".

Fails open on a Redis outage: losing the lock only means two search jobs
could in theory overlap (a soft degradation of DDG politeness, self-healing
once Redis is back), unlike the send-quota counter in sender.py where a
Redis outage must fail closed -- overshooting EMAIL_DAILY_LIMIT is a real
integrity problem, running one extra search job briefly is not."""

import redis

from app.database.redis_core import redis_client
from app.utils.config import settings
from app.logger import logger

SEARCH_LOCK_NAME = "outreach:lock:search"


class _NullLock:
    """Stand-in returned when Redis is unreachable at acquire time, so
    callers can treat 'proceeding without a lock' the same as 'got the
    lock' -- release/refresh are no-ops rather than raising."""

    def release(self) -> None:
        pass

    def extend(self, *args, **kwargs) -> None:
        pass


def acquire_search_lock() -> redis.lock.Lock | _NullLock | None:
    """Returns a lock object (real or null) if the caller may proceed, or
    None if another job genuinely holds the lock right now."""
    try:
        lock = redis_client.lock(SEARCH_LOCK_NAME, timeout=settings.SEARCH_LOCK_TTL_SEC)
        return lock if lock.acquire(blocking=False) else None
    except redis.exceptions.RedisError as e:
        logger.warning(f"search lock: Redis unavailable, proceeding without lock (fail-open): {e}")
        return _NullLock()


def release_search_lock(lock: "redis.lock.Lock | _NullLock") -> None:
    try:
        lock.release()
    except redis.exceptions.LockNotOwnedError:
        logger.warning("search lock: release attempted after TTL already expired")
    except redis.exceptions.RedisError as e:
        logger.warning(f"search lock: release failed, Redis unavailable: {e}")


def refresh_search_lock(lock: "redis.lock.Lock | _NullLock") -> None:
    try:
        lock.extend(settings.SEARCH_LOCK_TTL_SEC, replace_ttl=True)
    except redis.exceptions.LockError:
        logger.warning("search lock: refresh failed, TTL may have already expired")
    except redis.exceptions.RedisError as e:
        logger.warning(f"search lock: refresh failed, Redis unavailable: {e}")
