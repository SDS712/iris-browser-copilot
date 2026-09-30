"""Per-IP sliding-window rate limits. One server instance, so memory is enough.

Only hashed IPs are kept (see app.logging.hash_ip).
"""

import bisect
import math
import time
from collections import deque
from collections.abc import Callable

from app.errors import ErrorCode, IrisError

HOUR = 3600
DAY = 24 * HOUR

LIMITS: dict[str, tuple[tuple[int, int], ...]] = {
    "voice_token": ((HOUR, 10), (DAY, 30)),
    "pages": ((HOUR, 120),),
    "site_trust": ((HOUR, 30),),
    "web_lookup": ((HOUR, 60),),
    "tools": ((HOUR, 200),),
}


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._hits: dict[tuple[str, str], deque[float]] = {}

    def hit(self, bucket: str, ip_hash: str) -> None:
        """Count one request, or raise rate_limited if any window for the bucket is full."""
        windows = LIMITS[bucket]
        now = self.clock()
        hits = self._hits.setdefault((bucket, ip_hash), deque())
        longest = max(window for window, _ in windows)
        while hits and hits[0] <= now - longest:
            hits.popleft()
        for window, limit in windows:
            start = bisect.bisect_right(hits, now - window)
            if len(hits) - start >= limit:
                retry_after = hits[start] + window - now
                raise IrisError(ErrorCode.RATE_LIMITED, retry_after_seconds=math.ceil(retry_after))
        hits.append(now)

    def sweep(self) -> None:
        now = self.clock()
        longest = {bucket: max(w for w, _ in windows) for bucket, windows in LIMITS.items()}
        for key in list(self._hits):
            hits = self._hits[key]
            if not hits or hits[-1] <= now - longest[key[0]]:
                del self._hits[key]
