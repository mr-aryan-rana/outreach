import redis
from app.utils.config import settings

# Short connect/socket timeouts so a down Redis fails fast (a couple
# seconds) instead of hanging a request/startup for the OS-level TCP
# timeout (which can be 20s+) -- callers already have fail-open/fail-closed
# handling around every redis_client call, so failing fast just makes that
# handling responsive instead of a multi-second stall first.
redis_client = redis.from_url(
    settings.REDIS_URL, decode_responses=True,
    socket_connect_timeout=2, socket_timeout=2,
)

def get_redis():
    return redis_client
